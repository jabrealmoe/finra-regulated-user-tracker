/**
 * Doomy Textures Module
 * Procedurally generates 64x64 textures and billboard sprites to stay 100% self-contained
 * without relying on external assets, keeping bundles small and complying with strict CSP.
 */

const TEXTURE_SIZE = 64;

// Generate procedural textures once on load
let textures = null;

export function getTextures() {
  if (textures) return textures;

  textures = {
    walls: [],
    items: {},
    enemies: {},
    weapons: {}
  };

  // Helper to create a temporary 64x64 canvas
  const createCtx = () => {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    return canvas.getContext('2d');
  };

  // 1. WALL TEXTURES
  
  // Wall 0: Empty/Fallback
  const ctx0 = createCtx();
  ctx0.fillStyle = '#111';
  ctx0.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  textures.walls.push(ctx0.canvas);

  // Wall 1: Classic Red-Grey Bricks
  const ctx1 = createCtx();
  ctx1.fillStyle = '#5c2c2c'; // dark red base
  ctx1.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx1.strokeStyle = '#2b1414'; // grout
  ctx1.lineWidth = 1;
  const brickH = 8;
  const brickW = 16;
  for (let y = 0; y < TEXTURE_SIZE; y += brickH) {
    ctx1.beginPath();
    ctx1.moveTo(0, y);
    ctx1.lineTo(TEXTURE_SIZE, y);
    ctx1.stroke();
    
    // offset vertical joints
    const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
    for (let x = -brickW; x < TEXTURE_SIZE + brickW; x += brickW) {
      ctx1.beginPath();
      ctx1.moveTo(x + offset, y);
      ctx1.lineTo(x + offset, y + brickH);
      ctx1.stroke();
    }
  }
  // add brick highlights/shading
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * TEXTURE_SIZE;
    const y = Math.random() * TEXTURE_SIZE;
    ctx1.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.15)';
    ctx1.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 2 + 1);
  }
  textures.walls.push(ctx1.canvas);

  // Wall 2: Mossy Blue Stone Wall
  const ctx2 = createCtx();
  ctx2.fillStyle = '#2d3748'; // dark slate
  ctx2.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  // stone tiles
  ctx2.strokeStyle = '#1a202c';
  ctx2.lineWidth = 2;
  const stoneSize = 32;
  for (let y = 0; y <= TEXTURE_SIZE; y += stoneSize) {
    ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(TEXTURE_SIZE, y); ctx2.stroke();
    for (let x = 0; x <= TEXTURE_SIZE; x += stoneSize) {
      ctx2.beginPath(); ctx2.moveTo(x, y); ctx2.lineTo(x, y + stoneSize); ctx2.stroke();
    }
  }
  // Green moss
  ctx2.fillStyle = 'rgba(72,187,120,0.4)';
  for (let i = 0; i < 15; i++) {
    ctx2.beginPath();
    ctx2.arc(Math.random() * TEXTURE_SIZE, Math.random() * TEXTURE_SIZE, Math.random() * 6 + 2, 0, Math.PI * 2);
    ctx2.fill();
  }
  textures.walls.push(ctx2.canvas);

  // Wall 3: Metal Tech Wall / Door
  const ctx3 = createCtx();
  ctx3.fillStyle = '#718096'; // grey metal
  ctx3.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  // horizontal panels
  ctx3.fillStyle = '#4a5568';
  ctx3.fillRect(4, 4, TEXTURE_SIZE - 8, TEXTURE_SIZE - 8);
  ctx3.fillStyle = '#2d3748';
  ctx3.fillRect(8, 8, TEXTURE_SIZE - 16, TEXTURE_SIZE - 16);
  // brass trim
  ctx3.fillStyle = '#d69e2e';
  ctx3.fillRect(16, 24, 32, 16);
  ctx3.fillStyle = '#1a202c';
  ctx3.fillRect(20, 28, 24, 8);
  textures.walls.push(ctx3.canvas);

  // Wall 4: Radioactive Hazards / Yellow Stripes
  const ctx4 = createCtx();
  ctx4.fillStyle = '#1a202c';
  ctx4.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  ctx4.fillStyle = '#ecc94b'; // yellow stripes
  ctx4.beginPath();
  for (let offset = -TEXTURE_SIZE; offset < TEXTURE_SIZE * 2; offset += 24) {
    ctx4.moveTo(offset, 0);
    ctx4.lineTo(offset + 12, 0);
    ctx4.lineTo(offset + 12 - TEXTURE_SIZE, TEXTURE_SIZE);
    ctx4.lineTo(offset - TEXTURE_SIZE, TEXTURE_SIZE);
    ctx4.closePath();
  }
  ctx4.fill();
  textures.walls.push(ctx4.canvas);


  // 2. ITEM SPRITES
  
  // Health potion (blue vial)
  const ctxH = createCtx();
  ctxH.fillStyle = 'rgba(0,0,0,0)'; // transparent base
  ctxH.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  // Glass bottle
  ctxH.fillStyle = '#90cdf4';
  ctxH.fillRect(24, 20, 16, 32);
  ctxH.fillRect(28, 12, 8, 8);
  // Liquid (blue)
  ctxH.fillStyle = '#3182ce';
  ctxH.fillRect(26, 26, 12, 24);
  // Cork
  ctxH.fillStyle = '#b7791f';
  ctxH.fillRect(28, 8, 8, 4);
  textures.items.health = ctxH.canvas;

  // Armor vest (green armor)
  const ctxA = createCtx();
  ctxA.fillStyle = 'rgba(0,0,0,0)';
  // Chest plate
  ctxA.fillStyle = '#38a169';
  ctxA.beginPath();
  ctxA.moveTo(16, 16);
  ctxA.lineTo(48, 16);
  ctxA.lineTo(52, 32);
  ctxA.lineTo(44, 48);
  ctxA.lineTo(20, 48);
  ctxA.lineTo(12, 32);
  ctxA.closePath();
  ctxA.fill();
  // collar trim
  ctxA.fillStyle = '#ecc94b';
  ctxA.fillRect(24, 16, 16, 6);
  textures.items.armor = ctxA.canvas;

  // Ammo Box (bullets - grey/brown box)
  const ctxAm = createCtx();
  ctxAm.fillStyle = 'rgba(0,0,0,0)';
  ctxAm.fillStyle = '#8a5c38';
  ctxAm.fillRect(16, 24, 32, 24);
  ctxAm.fillStyle = '#ecc94b'; // Bullet tips showing
  ctxAm.fillRect(20, 20, 24, 4);
  ctxAm.fillStyle = '#4a5568'; // buckle
  ctxAm.fillRect(30, 26, 4, 12);
  textures.items.ammo = ctxAm.canvas;

  // Level Exit Portal (Red swirling gate)
  const ctxEx = createCtx();
  ctxEx.fillStyle = 'rgba(0,0,0,0)';
  const grad = ctxEx.createRadialGradient(32, 32, 2, 32, 32, 28);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.3, '#f56565');
  grad.addColorStop(0.8, '#9b2c2c');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctxEx.fillStyle = grad;
  ctxEx.beginPath();
  ctxEx.arc(32, 32, 30, 0, Math.PI * 2);
  ctxEx.fill();
  textures.items.exit = ctxEx.canvas;


  // 3. ENEMY BILLBOARD SPRITES (IMP & ZOMBIEMAN)

  // Melee Imp (dark brown spiky demon)
  const createImp = (state) => {
    const ctx = createCtx();
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    
    // Legs
    ctx.fillStyle = '#4a2c2c';
    ctx.fillRect(20, 44, 8, 16);
    ctx.fillRect(36, 44, 8, 16);

    // Torso
    ctx.fillStyle = '#5c3a21'; // brown
    ctx.fillRect(16, 20, 32, 26);

    // Spikes (grey)
    ctx.fillStyle = '#cbd5e0';
    ctx.fillRect(12, 18, 4, 4);
    ctx.fillRect(48, 18, 4, 4);
    ctx.fillRect(14, 28, 4, 4);
    ctx.fillRect(46, 28, 4, 4);

    // Head
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(24, 8, 16, 14);
    // Glowing red eyes
    ctx.fillStyle = '#e53e3e';
    ctx.fillRect(27, 12, 3, 2);
    ctx.fillRect(34, 12, 3, 2);

    if (state === 'attack') {
      // Arms reaching forward with red fireball
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(8, 16, 12, 8);
      ctx.fillRect(44, 16, 12, 8);
      // Fireball in front
      const fireGrad = ctx.createRadialGradient(32, 28, 1, 32, 28, 10);
      fireGrad.addColorStop(0, '#fff');
      fireGrad.addColorStop(0.5, '#ed8936');
      fireGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fireGrad;
      ctx.beginPath();
      ctx.arc(32, 28, 10, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'pain') {
      // Flinching face / lighter color
      ctx.fillStyle = '#fc8181';
      ctx.fillRect(24, 8, 16, 14);
    } else if (state === 'death') {
      // Fallen, collapsing shape
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      ctx.fillStyle = '#3f2211';
      ctx.fillRect(12, 36, 40, 24);
      ctx.fillStyle = '#9b2c2c'; // blood splash
      ctx.fillRect(18, 30, 28, 8);
    }
    return ctx.canvas;
  };

  textures.enemies.imp = {
    walk: createImp('walk'),
    attack: createImp('attack'),
    pain: createImp('pain'),
    death: createImp('death')
  };

  // Gunner/Zombieman (green armor zombie carrying pistol)
  const createZombie = (state) => {
    const ctx = createCtx();
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

    // Leggings
    ctx.fillStyle = '#2f3e46';
    ctx.fillRect(20, 44, 8, 16);
    ctx.fillRect(36, 44, 8, 16);

    // Torso (decaying green vest)
    ctx.fillStyle = '#386641';
    ctx.fillRect(16, 20, 32, 26);

    // Head (grey/pale skin)
    ctx.fillStyle = '#cad2c5';
    ctx.fillRect(24, 8, 16, 14);
    // Red glowing visor/eyes
    ctx.fillStyle = '#e53e3e';
    ctx.fillRect(26, 12, 12, 2);

    // Arm holding pistol
    ctx.fillStyle = '#cad2c5';
    ctx.fillRect(36, 28, 14, 6);
    ctx.fillStyle = '#1a202c'; // Gun barrel
    ctx.fillRect(48, 26, 8, 4);

    if (state === 'attack') {
      // Muzzle flash on barrel
      ctx.fillStyle = '#ecc94b';
      ctx.beginPath();
      ctx.arc(58, 28, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'pain') {
      ctx.fillStyle = '#feb2b2';
      ctx.fillRect(24, 8, 16, 14);
    } else if (state === 'death') {
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      ctx.fillStyle = '#2f3e46';
      ctx.fillRect(10, 40, 44, 20);
      ctx.fillStyle = '#9b2c2c';
      ctx.fillRect(14, 34, 30, 8);
    }

    return ctx.canvas;
  };

  textures.enemies.zombie = {
    walk: createZombie('walk'),
    attack: createZombie('attack'),
    pain: createZombie('pain'),
    death: createZombie('death')
  };

  return textures;
}
