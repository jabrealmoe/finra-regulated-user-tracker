/**
 * Doomy Entities Module
 * Manages collectibles, enemy behaviors, AI state machines (idle/alert/chase/attack/pain/death),
 * pathing toward the player, and collision checks.
 */

import { playSound } from './audio';
import { MAP } from './level';

const MAX_ACTIVE_ENEMIES = 8; // Performance cap for iframe sandbox

export class EntitySystem {
  constructor(player) {
    this.player = player;
    this.items = [];
    this.enemies = [];
    this.enemyCap = MAX_ACTIVE_ENEMIES;
  }

  spawnItems(spawns) {
    this.items = spawns.map((s, idx) => ({
      id: `item_${idx}`,
      x: s.x,
      y: s.y,
      type: s.type,
      active: true,
      radius: 0.35
    }));
  }

  spawnEnemies(spawns) {
    this.enemies = spawns.slice(0, this.enemyCap).map((s, idx) => ({
      id: `enemy_${idx}`,
      x: s.x,
      y: s.y,
      type: s.type, // 'imp' or 'zombie'
      health: s.type === 'imp' ? 60 : 40,
      state: 'idle', // 'idle', 'chase', 'attack', 'pain', 'death', 'dead'
      animTimer: 0,
      attackCooldown: Math.random() * 2, // staggered initial attacks
      radius: 0.35,
      alerted: false
    }));
  }

  update(dt, playerFired) {
    // 1. Update Collectible Pickups
    this.items.forEach((item) => {
      if (!item.active) return;

      // Distance to player
      const dx = this.player.x - item.x;
      const dy = this.player.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < item.radius + 0.3) {
        // Player collides with item
        const success = this.player.pickupItem(item.type);
        if (success) {
          item.active = false;
        }
      }
    });

    // 2. Update Enemy AI State Machine
    this.enemies.forEach((enemy) => {
      if (enemy.state === 'dead') return;

      // Distance and vector to player
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Handle Death State transition
      if (enemy.state === 'death') {
        enemy.animTimer += dt;
        if (enemy.animTimer >= 0.5) {
          enemy.state = 'dead';
        }
        return;
      }

      // Wake up nearby enemies if player shoots
      if (playerFired && dist < 12.0) {
        this.alertEnemy(enemy);
      }

      // Check sight line to wake up
      if (enemy.state === 'idle' && dist < 8.0) {
        // Basic LoS check: check if there's no solid wall between player and enemy
        if (this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y)) {
          this.alertEnemy(enemy);
        }
      }

      // Chase Player state
      if (enemy.state === 'chase') {
        enemy.attackCooldown -= dt;

        // Path toward player (simple ray vector chasing with collision checks)
        const moveSpeed = (enemy.type === 'imp' ? 1.5 : 1.2) * dt;
        const dirX = dx / dist;
        const dirY = dy / dist;

        const nextX = enemy.x + dirX * moveSpeed;
        const nextY = enemy.y + dirY * moveSpeed;

        // Slide along walls
        if (this.isTilePassable(nextX, enemy.y)) {
          enemy.x = nextX;
        }
        if (this.isTilePassable(enemy.x, nextY)) {
          enemy.y = nextY;
        }

        // Trigger Attack check
        const attackRange = enemy.type === 'imp' ? 1.6 : 8.0; // imps are melee/close, zombies shoot
        if (dist <= attackRange && enemy.attackCooldown <= 0) {
          if (enemy.type === 'imp' || this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y)) {
            this.triggerAttack(enemy);
          }
        }
      }

      // Attack Animation State
      if (enemy.state === 'attack') {
        enemy.animTimer += dt;
        if (enemy.animTimer >= 0.4) {
          // Perform damage hit
          if (enemy.type === 'imp') {
            if (dist < 1.8) {
              this.player.takeDamage(12);
            }
          } else {
            // Zombie hitscan shot (low damage, slightly spread)
            if (this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y)) {
              this.player.takeDamage(8);
              playSound('pistol'); // gun shot sound
            }
          }
          enemy.state = 'chase';
          enemy.attackCooldown = 1.5 + Math.random() * 1.5; // attack frequency
        }
      }

      // Pain state (flinch on hit)
      if (enemy.state === 'pain') {
        enemy.animTimer += dt;
        if (enemy.animTimer >= 0.25) {
          enemy.state = 'chase';
        }
      }
    });
  }

  alertEnemy(enemy) {
    if (enemy.state !== 'idle') return;
    enemy.state = 'chase';
    playSound('enemy_alert');
  }

  triggerAttack(enemy) {
    enemy.state = 'attack';
    enemy.animTimer = 0;
  }

  damageEnemy(enemy, damage) {
    if (enemy.state === 'death' || enemy.state === 'dead') return;

    this.alertEnemy(enemy); // alert them if they were sleeping
    enemy.health -= damage;

    if (enemy.health <= 0) {
      enemy.state = 'death';
      enemy.animTimer = 0;
      playSound('enemy_death');
    } else {
      // 50% chance of pain state trigger
      if (Math.random() > 0.5) {
        enemy.state = 'pain';
        enemy.animTimer = 0;
        playSound('enemy_pain');
      }
    }
  }

  isTilePassable(x, y) {
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);
    if (gridX < 0 || gridX >= MAP[0].length || gridY < 0 || gridY >= MAP.length) return false;
    const tile = MAP[gridY][gridX];
    return tile === 0 || tile === 8;
  }

  // Raycast Line of Sight checker
  hasLineOfSight(x1, y1, x2, y2) {
    let t = 0;
    const steps = 25;
    for (let i = 0; i <= steps; i++) {
      t = i / steps;
      const checkX = x1 + (x2 - x1) * t;
      const checkY = y1 + (y2 - y1) * t;
      const gridX = Math.floor(checkX);
      const gridY = Math.floor(checkY);
      
      if (gridX >= 0 && gridX < MAP[0].length && gridY >= 0 && gridY < MAP.length) {
        const tile = MAP[gridY][gridX];
        if (tile !== 0 && tile !== 8 && tile !== 99) {
          return false; // wall block
        }
      }
    }
    return true;
  }
}
export default EntitySystem;
