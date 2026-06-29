/**
 * Doomy Level Module
 * Defines the 2D grid map layout, walls (different tiles), doors, secret triggers,
 * and spawn points for items and enemies.
 */

export const MAP_WIDTH = 16;
export const MAP_HEIGHT = 16;

// 16x16 classic Doom-like map with 3 rooms connected by corridors.
// 0 = empty floor
// 1 = Red Brick Wall
// 2 = Mossy Stone Wall
// 3 = Metal Panel Wall
// 4 = Hazard Yellow/Black Wall
// 9 = Horizontal sliding door (close automatically after delay)
// 99 = Level Exit Portal
export const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,1,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,9,0,0,0,0,0,0,0,0,0,0,1], // Spawn room (Top Left)
  [1,0,0,0,1,0,0,0,2,2,3,2,2,0,0,1],
  [1,1,1,1,1,0,0,0,2,0,0,0,2,0,0,1],
  [1,0,0,0,0,0,0,0,2,0,0,0,9,0,0,1], // Tech Room (Center Right)
  [1,0,0,0,0,0,0,0,2,0,0,0,2,0,0,1],
  [1,1,4,4,1,1,1,1,2,2,2,2,2,0,0,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,9,0,0,0,0,0,0,0,1], // Corridor connects Spawn to bottom
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
  [1,3,3,9,3,3,3,3,1,1,4,4,1,1,1,1],
  [1,0,0,0,0,0,3,0,0,0,0,0,0,0,0,1], // Hazard Room (Bottom Left)
  [1,0,0,0,0,0,3,0,0,0,0,0,0,0,99,1], // Exit Portal (Bottom Right)
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
];

// Initial Player Spawn
export const PLAYER_SPAWN = {
  x: 2.5,
  y: 2.5,
  dirX: 1.0,
  dirY: 0.0,
  planeX: 0.0,
  planeY: 0.66 // field of view factor
};

// Spawn points for items (health, armor, ammo)
// Items are represented as objects with coordinate locations and types.
export const ITEM_SPAWNS = [
  // Spawn Room
  { x: 1.5, y: 1.5, type: 'health' },
  { x: 1.5, y: 3.5, type: 'ammo' },

  // Tech Room
  { x: 10.5, y: 5.5, type: 'armor' },
  { x: 9.5, y: 4.5, type: 'health' },
  { x: 11.5, y: 4.5, type: 'ammo' },

  // Bottom Hazard Corridors
  { x: 2.5, y: 14.5, type: 'health' },
  { x: 9.5, y: 13.5, type: 'ammo' },
  { x: 12.5, y: 12.5, type: 'armor' }
];

// Spawn points for enemies (imp, zombie)
export const ENEMY_SPAWNS = [
  // Tech Room guard
  { x: 10.5, y: 6.5, type: 'imp' },

  // Corridor patrol
  { x: 6.5, y: 2.5, type: 'zombie' },

  // Bottom Hazard Room guards
  { x: 2.5, y: 12.5, type: 'imp' },
  { x: 5.5, y: 13.5, type: 'zombie' },

  // Guarding the exit portal
  { x: 11.5, y: 14.5, type: 'imp' },
  { x: 13.5, y: 12.5, type: 'zombie' }
];
