/**
 * Doomy Engine Module
 * Implements the core 3D DDA Raycaster, distance shading, billboard sprite projection,
 * Z-Buffer depth checks, hitscan shooting intersection, doors/exit interactions, and delta-time loop.
 */

import { MAP, MAP_WIDTH, MAP_HEIGHT } from './level';
import { getTextures } from './textures';
import { playSound } from './audio';

export class Engine {
  constructor(canvas, player, weaponSystem, hud, entitySystem, onStateChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.player = player;
    this.weapons = weaponSystem;
    this.hud = hud;
    this.entities = entitySystem;
    this.onStateChange = onStateChange;

    this.textures = getTextures();

    this.zBuffer = new Float32Array(canvas.width);
    this.animationFrameId = null;
    this.lastTime = Date.now();
    this.isRunning = false;

    // Door animation timers
    this.activeDoors = {};

    this.loop = this.loop.bind(this);
  }

  start() {
    this.isRunning = true;
    this.lastTime = Date.now();
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  loop() {
    if (!this.isRunning) return;

    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000.0); // cap dt at 100ms
    this.lastTime = now;

    this.update(dt);
    this.render();

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  update(dt) {
    const prevFired = !!this.weapons.pendingShot;

    // Update Player & Weapons
    this.player.update(this.input, dt);
    this.weapons.update(this.input, dt);
    this.hud.update(dt);

    const playerFiredThisFrame = !prevFired && !!this.weapons.pendingShot;

    // Update Entities
    this.entities.update(dt, playerFiredThisFrame);

    // Update Doors State (automatic closing timer)
    Object.keys(this.activeDoors).forEach((key) => {
      this.activeDoors[key] -= dt;
      if (this.activeDoors[key] <= 0) {
        const [gx, gy] = key.split(',').map(Number);
        if (MAP[gy][gx] === 8) { // if open, check if player/enemies blocked it
          const blockingEntity = this.isCellOccupied(gx, gy);
          if (!blockingEntity) {
            MAP[gy][gx] = 9; // close door
            playSound('door');
            delete this.activeDoors[key];
          } else {
            this.activeDoors[key] = 1.0; // delay close check
          }
        }
      }
    });

    // Check Interact triggers (E key / Spacebar)
    if (this.input.consumeUse()) {
      this.handleInteract();
    }

    // Check Exit Portal touch trigger
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);
    if (MAP[py] && MAP[py][px] === 99) {
      this.stop();
      this.onStateChange('win');
    }

    // Handle weapon hit registration (Hitscan shooting)
    if (this.weapons.pendingShot) {
      this.processWeaponShot(this.weapons.pendingShot);
      this.weapons.pendingShot = null;
    }

    if (this.player.isDead) {
      this.stop();
      this.onStateChange('gameover');
    }
  }

  isCellOccupied(gx, gy) {
    // Is player inside cell?
    if (Math.floor(this.player.x) === gx && Math.floor(this.player.y) === gy) return true;
    // Any enemy inside cell?
    return this.entities.enemies.some(e => e.state !== 'dead' && Math.floor(e.x) === gx && Math.floor(e.y) === gy);
  }

  handleInteract() {
    // Check grid cell directly in front of the player
    const checkDist = 1.2;
    const checkX = this.player.x + this.player.dirX * checkDist;
    const checkY = this.player.y + this.player.dirY * checkDist;
    const gx = Math.floor(checkX);
    const gy = Math.floor(checkY);

    if (gx >= 0 && gx < MAP_WIDTH && gy >= 0 && gy < MAP_HEIGHT) {
      const tile = MAP[gy][gx];
      if (tile === 9) { // Closed door
        MAP[gy][gx] = 8; // open door
        playSound('door');
        this.activeDoors[`${gx},${gy}`] = 4.0; // Close automatically after 4s
      }
    }
  }

  processWeaponShot(shot) {
    // Fist is melee, others are hitscan (with optional spread pellets)
    if (shot.wepType === 'fist') {
      // Melee check
      let target = null;
      let targetDist = shot.range;

      this.entities.enemies.forEach((enemy) => {
        if (enemy.state === 'dead' || enemy.state === 'death') return;
        const dx = enemy.x - this.player.x;
        const dy = enemy.y - this.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist <= targetDist) {
          // Check angle offset
          const angleToEnemy = Math.atan2(dy, dx);
          const playerAngle = Math.atan2(this.player.dirY, this.player.dirX);
          let diff = Math.abs(angleToEnemy - playerAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;

          if (diff < 0.4) { // within punching arc
            target = enemy;
            targetDist = dist;
          }
        }
      });

      if (target) {
        this.entities.damageEnemy(target, shot.damage);
        playSound('fist_hit');
      }
    } else {
      // Hitscan Gun
      for (let p = 0; p < shot.pellets; p++) {
        // Apply random spread offset
        const spreadAngle = (Math.random() * 2 - 1) * shot.spread;
        
        // Rotate firing direction vector
        const cosS = Math.cos(spreadAngle);
        const sinS = Math.sin(spreadAngle);
        const rayDirX = this.player.dirX * cosS - this.player.dirY * sinS;
        const rayDirY = this.player.dirX * sinS + this.player.dirY * cosS;

        this.processHitscanRay(rayDirX, rayDirY, shot.damage, shot.range);
      }
    }
  }

  processHitscanRay(rayDirX, rayDirY, damage, maxRange) {
    // Find closest wall intersection
    // DDA variables
    let mapX = Math.floor(this.player.x);
    let mapY = Math.floor(this.player.y);

    const deltaDistX = Math.abs(1 / rayDirX);
    const deltaDistY = Math.abs(1 / rayDirY);

    let stepX, stepY;
    let sideDistX, sideDistY;

    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (this.player.x - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1.0 - this.player.x) * deltaDistX;
    }

    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (this.player.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1.0 - this.player.y) * deltaDistY;
    }

    let hit = false;
    let side = 0; // 0=vertical, 1=horizontal
    let wallDist = maxRange;

    // Run DDA
    for (let i = 0; i < 30; i++) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (mapX < 0 || mapX >= MAP_WIDTH || mapY < 0 || mapY >= MAP_HEIGHT) break;

      const tile = MAP[mapY][mapX];
      if (tile !== 0 && tile !== 8 && tile !== 99) { // Solid wall/door hit
        hit = true;
        break;
      }
    }

    if (hit) {
      if (side === 0) wallDist = (mapX - this.player.x + (1 - stepX) / 2) / rayDirX;
      else wallDist = (mapY - this.player.y + (1 - stepY) / 2) / rayDirY;
    }

    // Check if any enemy intersects along the vector before the wall hit
    let closestEnemy = null;
    let closestEnemyDist = wallDist;

    this.entities.enemies.forEach((enemy) => {
      if (enemy.state === 'dead' || enemy.state === 'death') return;

      // Project enemy coordinates relative to player vector
      const vX = enemy.x - this.player.x;
      const vY = enemy.y - this.player.y;
      
      // dot product projects onto ray direction
      const projection = vX * rayDirX + vY * rayDirY;
      
      if (projection > 0 && projection < closestEnemyDist) {
        // Calculate perpendicular distance to ray vector
        const perpDist = Math.abs(vX * -rayDirY + vY * rayDirX);
        if (perpDist < enemy.radius) {
          closestEnemy = enemy;
          closestEnemyDist = projection;
        }
      }
    });

    if (closestEnemy) {
      this.entities.damageEnemy(closestEnemy, damage);
    }
  }

  render() {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Draw Flat Ceiling & Floor
    this.ctx.fillStyle = '#1e293b'; // Slate dark gray ceiling
    this.ctx.fillRect(0, 0, width, height / 2);

    this.ctx.fillStyle = '#451a03'; // Dark brown floor
    this.ctx.fillRect(0, height / 2, width, height / 2);

    // Apply distance fog gradient on floor/ceiling
    const horizonGrad = this.ctx.createLinearGradient(0, height * 0.25, 0, height * 0.75);
    horizonGrad.addColorStop(0, 'rgba(6, 7, 19, 1)'); // Dark fog at horizon
    horizonGrad.addColorStop(0.48, 'rgba(6, 7, 19, 0.95)');
    horizonGrad.addColorStop(0.5, 'rgba(6, 7, 19, 0.95)');
    horizonGrad.addColorStop(0.52, 'rgba(6, 7, 19, 0.95)');
    horizonGrad.addColorStop(1, 'rgba(6, 7, 19, 0)');
    this.ctx.fillStyle = horizonGrad;
    this.ctx.fillRect(0, 0, width, height);

    const muzzleMuzzleFlashLightBoost = this.weapons.flashActive ? 1.4 : 1.0;

    // 2. WALL RAYCASTING (DDA)
    for (let x = 0; x < width; x++) {
      // Calculate ray position and direction
      const cameraX = 2 * x / width - 1; // x-coordinate in camera space
      const rayDirX = this.player.dirX + this.player.planeX * cameraX;
      const rayDirY = this.player.dirY + this.player.planeY * cameraX;

      let mapX = Math.floor(this.player.x);
      let mapY = Math.floor(this.player.y);

      // length of ray from one x or y-side to next x or y-side
      const deltaDistX = Math.abs(1 / rayDirX);
      const deltaDistY = Math.abs(1 / rayDirY);

      let stepX, stepY;
      let sideDistX, sideDistY;

      // calculate step and initial sideDist
      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (this.player.x - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1.0 - this.player.x) * deltaDistX;
      }

      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (this.player.y - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1.0 - this.player.y) * deltaDistY;
      }

      let hit = 0;
      let side = 0; // 0=vertical, 1=horizontal

      // perform DDA
      while (hit === 0) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        if (mapX < 0 || mapX >= MAP_WIDTH || mapY < 0 || mapY >= MAP_HEIGHT) {
          break;
        }

        const tile = MAP[mapY][mapX];
        if (tile !== 0 && tile !== 8 && tile !== 99) { // hit wall/door/portal
          hit = tile;
        }
      }

      if (hit === 0) continue;

      // Calculate perpendicular wall distance (corrects fisheye distortion)
      let perpWallDist;
      if (side === 0) perpWallDist = (mapX - this.player.x + (1 - stepX) / 2) / rayDirX;
      else perpWallDist = (mapY - this.player.y + (1 - stepY) / 2) / rayDirY;

      this.zBuffer[x] = perpWallDist;

      // Calculate height of line to draw on screen
      const lineHeight = Math.floor(height / (perpWallDist || 0.01));

      // Calculate lowest and highest pixel to fill in current stripe
      let drawStart = -lineHeight / 2 + height / 2;
      let drawEnd = lineHeight / 2 + height / 2;

      // SAMPLING TEXTURES
      const textureIdx = Math.min(this.textures.walls.length - 1, hit);
      const wallTexCanvas = this.textures.walls[textureIdx];

      // Calculate exact value where wall was hit (x coordinate)
      let wallX;
      if (side === 0) wallX = this.player.y + perpWallDist * rayDirY;
      else wallX = this.player.x + perpWallDist * rayDirX;
      wallX -= Math.floor(wallX);

      // x coordinate on the texture
      let texX = Math.floor(wallX * 64);
      if (side === 0 && rayDirX > 0) texX = 64 - texX - 1;
      if (side === 1 && rayDirY < 0) texX = 64 - texX - 1;

      // Render textured column
      this.ctx.drawImage(
        wallTexCanvas,
        texX, 0, 1, 64, // src
        x, drawStart, 1, drawEnd - drawStart // dest
      );

      // Distance light falloff (fog/shading)
      const maxShadeDist = 12.0;
      let lightFactor = 1.0 - (perpWallDist / maxShadeDist);
      if (lightFactor < 0.05) lightFactor = 0.05;
      
      // apply muzzle flash boost
      lightFactor = Math.min(1.0, lightFactor * muzzleMuzzleFlashLightBoost);

      // Add darker tint for horizontal (y-side) walls to create pseudo-3D shading
      const shadowFactor = side === 1 ? 0.6 : 1.0;
      const opacity = 1.0 - (lightFactor * shadowFactor);

      if (opacity > 0) {
        this.ctx.fillStyle = `rgba(6, 7, 19, ${opacity})`; // blend with dark background fog
        this.ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
      }
    }

    // 3. SPRITE RAYCASTING (ENEMIES & ITEMS)
    const activeSprites = [];
    
    // Collect active items
    this.entities.items.forEach(item => {
      if (item.active) {
        activeSprites.push({
          x: item.x,
          y: item.y,
          canvas: this.textures.items[item.type] || this.textures.items.health,
          item: true
        });
      }
    });

    // Collect active enemies
    this.entities.enemies.forEach(enemy => {
      if (enemy.state !== 'dead') {
        const stateKey = (enemy.state === 'death') ? 'death' : (enemy.state === 'pain') ? 'pain' : (enemy.state === 'attack') ? 'attack' : 'walk';
        const canvas = this.textures.enemies[enemy.type][stateKey];
        activeSprites.push({
          x: enemy.x,
          y: enemy.y,
          canvas,
          item: false
        });
      }
    });

    // Sort sprites by distance from player (Painters algorithm)
    activeSprites.forEach(s => {
      s.dist = Math.pow(this.player.x - s.x, 2) + Math.pow(this.player.y - s.y, 2);
    });
    activeSprites.sort((a, b) => b.dist - a.dist);

    activeSprites.forEach(sprite => {
      // translate sprite position relative to player camera plane
      const spriteX = sprite.x - this.player.x;
      const spriteY = sprite.y - this.player.y;

      const invDet = 1.0 / (this.player.planeX * this.player.dirY - this.player.dirX * this.player.planeY);

      const transformX = invDet * (this.player.dirY * spriteX - this.player.dirX * spriteY);
      const transformY = invDet * (-this.player.planeY * spriteX + this.player.planeX * spriteY); // depth

      if (transformY <= 0.1) return; // behind screen

      const spriteScreenX = Math.floor((width / 2) * (1 + transformX / transformY));

      // Calculate width and height of sprite on screen
      const spriteHeight = Math.abs(Math.floor(height / transformY));
      let drawStartY = -spriteHeight / 2 + height / 2;
      let drawEndY = spriteHeight / 2 + height / 2;

      const spriteWidth = Math.abs(Math.floor(height / transformY));
      let drawStartX = Math.floor(-spriteWidth / 2 + spriteScreenX);
      let drawEndX = Math.floor(spriteWidth / 2 + spriteScreenX);

      // Loop through every vertical column of the sprite on screen
      for (let stripe = drawStartX; stripe < drawEndX; stripe++) {
        if (stripe < 0 || stripe >= width) continue;

        // check depth buffer (is sprite behind wall?)
        if (transformY < this.zBuffer[stripe]) {
          const texX = Math.floor(256 * (stripe - (-spriteWidth / 2 + spriteScreenX)) * 64 / spriteWidth) / 256;
          
          if (texX >= 0 && texX < 64) {
            // Draw column
            this.ctx.drawImage(
              sprite.canvas,
              texX, 0, 1, 64, // src
              stripe, drawStartY, 1, drawEndY - drawStartY // dest
            );

            // Shading fog on sprite
            const maxShadeDist = 12.0;
            let lightFactor = 1.0 - (transformY / maxShadeDist);
            if (lightFactor < 0.05) lightFactor = 0.05;
            lightFactor = Math.min(1.0, lightFactor * muzzleMuzzleFlashLightBoost);
            const opacity = 1.0 - lightFactor;

            if (opacity > 0) {
              this.ctx.fillStyle = `rgba(6, 7, 19, ${opacity})`;
              this.ctx.fillRect(stripe, drawStartY, 1, drawEndY - drawStartY);
            }
          }
        }
      }
    });

    // 4. DRAW WEAPON SPRITE
    const currentWepDef = this.weapons.player.getActiveWeapon();
    this.weapons.drawWeapon(this.ctx, width, height, this.player.bobY);

    // 5. DRAW HUD
    this.hud.draw(this.ctx, width, height, this.weapons.player.weapons[this.player.activeWeaponIdx]);
  }
}
export default Engine;
