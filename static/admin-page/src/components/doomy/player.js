/**
 * Doomy Player Module
 * Manages player states: WASD movement, wall-sliding collision, mouse look,
 * health, armor, weapon switching, and walk bobbing.
 */

import { PLAYER_SPAWN, MAP } from './level';
import { playSound } from './audio';

export class Player {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = PLAYER_SPAWN.x;
    this.y = PLAYER_SPAWN.y;
    this.dirX = PLAYER_SPAWN.dirX;
    this.dirY = PLAYER_SPAWN.dirY;
    this.planeX = PLAYER_SPAWN.planeX;
    this.planeY = PLAYER_SPAWN.planeY;

    this.health = 100;
    this.armor = 0;
    this.ammo = {
      bullets: 50,
      shells: 10
    };

    this.weapons = ['fist', 'pistol', 'shotgun', 'chaingun'];
    this.activeWeaponIdx = 1; // start with pistol
    this.isDead = false;

    // View bobbing
    this.bobTime = 0;
    this.bobY = 0;
    this.isWalking = false;
  }

  update(input, dt) {
    if (this.isDead) return;

    const moveSpeed = 4.2 * dt; // units per second
    const rotSpeed = 2.5 * dt; // radians per second
    const mouseSensitivity = 0.0015;

    let moveX = 0;
    let moveY = 0;
    this.isWalking = false;

    // 1. Keyboard movements
    // Forward / Backward
    if (input.keys['w'] || input.keys['arrowup']) {
      moveX += this.dirX * moveSpeed;
      moveY += this.dirY * moveSpeed;
      this.isWalking = true;
    }
    if (input.keys['s'] || input.keys['arrowdown']) {
      moveX -= this.dirX * moveSpeed;
      moveY -= this.dirY * moveSpeed;
      this.isWalking = true;
    }

    // Strafing (A/D)
    if (input.keys['a']) {
      // Perpendicular vector
      moveX -= -this.dirY * moveSpeed;
      moveY -= this.dirX * moveSpeed;
      this.isWalking = true;
    }
    if (input.keys['d']) {
      moveX += -this.dirY * moveSpeed;
      moveY += this.dirX * moveSpeed;
      this.isWalking = true;
    }

    // 2. Wall-sliding Collision Detection
    const collisionRadius = 0.3; // padding from walls
    
    // Check X axis movement
    const targetX = this.x + moveX;
    const signX = moveX > 0 ? 1 : -1;
    const checkGridX = Math.floor(targetX + signX * collisionRadius);
    const checkGridY_forX = Math.floor(this.y);

    if (this.isPassable(checkGridX, checkGridY_forX)) {
      this.x = targetX;
    }

    // Check Y axis movement
    const targetY = this.y + moveY;
    const signY = moveY > 0 ? 1 : -1;
    const checkGridY = Math.floor(targetY + signY * collisionRadius);
    const checkGridX_forY = Math.floor(this.x);

    if (this.isPassable(checkGridX_forY, checkGridY)) {
      this.y = targetY;
    }

    // 3. Camera Rotation (Mouse + Keyboard Q/E or ArrowLeft/Right)
    let angle = 0;
    
    // Mouse turning
    const mouseRot = input.getMouseRotation();
    if (mouseRot !== 0) {
      angle -= mouseRot * mouseSensitivity;
    }

    // Keyboard turning
    if (input.keys['arrowleft'] || input.keys['q']) {
      angle += rotSpeed;
    }
    if (input.keys['arrowright'] || input.keys['e']) {
      angle -= rotSpeed;
    }

    if (angle !== 0) {
      // Rotate direction vector
      const oldDirX = this.dirX;
      this.dirX = this.dirX * Math.cos(angle) - this.dirY * Math.sin(angle);
      this.dirY = oldDirX * Math.sin(angle) + this.dirY * Math.cos(angle);
      
      // Rotate camera plane vector
      const oldPlaneX = this.planeX;
      this.planeX = this.planeX * Math.cos(angle) - this.planeY * Math.sin(angle);
      this.planeY = oldPlaneX * Math.sin(angle) + this.planeY * Math.cos(angle);
    }

    // 4. View Bobbing calculations
    if (this.isWalking) {
      this.bobTime += dt * 14;
      this.bobY = Math.sin(this.bobTime) * 8; // vertical displacement in pixels
    } else {
      this.bobY = Math.sin(Date.now() / 200) * 1.5; // gentle idle breathing bob
    }

    // 5. Weapon Switching
    if (input.keys['1']) this.activeWeaponIdx = 0; // Fist
    if (input.keys['2']) this.activeWeaponIdx = 1; // Pistol
    if (input.keys['3']) this.activeWeaponIdx = 2; // Shotgun
    if (input.keys['4']) this.activeWeaponIdx = 3; // Chaingun
  }

  isPassable(gridX, gridY) {
    if (gridX < 0 || gridX >= MAP[0].length || gridY < 0 || gridY >= MAP.length) {
      return false;
    }
    const tile = MAP[gridY][gridX];
    // 0 = empty floor, 8 = open door, 99 = exit portal
    return tile === 0 || tile === 8 || tile === 99;
  }

  takeDamage(amount) {
    if (this.isDead) return;

    // Armor absorbs 50% of damage
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed;
      amount -= absorbed;
    }

    this.health -= amount;
    playSound('player_pain');

    if (this.health <= 0) {
      this.health = 0;
      this.isDead = true;
      playSound('enemy_death'); // player dying is heavy low growl
    }
  }

  pickupItem(type) {
    if (this.isDead) return false;

    let pickedUp = false;

    if (type === 'health' && this.health < 200) {
      this.health = Math.min(200, this.health + 25);
      pickedUp = true;
    } else if (type === 'armor' && this.armor < 200) {
      this.armor = Math.min(200, this.armor + 50);
      pickedUp = true;
    } else if (type === 'ammo') {
      this.ammo.bullets = Math.min(200, this.ammo.bullets + 30);
      this.ammo.shells = Math.min(50, this.ammo.shells + 8);
      pickedUp = true;
    }

    if (pickedUp) {
      playSound('pickup');
    }
    return pickedUp;
  }

  getActiveWeapon() {
    return this.weapons[this.activeWeaponIdx];
  }
}
export default Player;
