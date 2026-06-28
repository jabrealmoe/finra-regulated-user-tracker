/**
 * Doomy Weapons Module
 * Configures the Doom weapons arsenal, ammunition usage, animated sprite frames,
 * hitscan bullet spread calculations, and camera muzzle flash / shake triggers.
 */

import { playSound } from './audio';

export const WEAPON_DEFS = {
  fist: {
    name: 'Fist',
    ammoType: null,
    ammoCost: 0,
    fireDelay: 0.4, // seconds
    range: 1.5,
    damage: 25,
    spread: 0,
    shakes: 4,
    flash: false,
    sound: 'fist_miss'
  },
  pistol: {
    name: 'Pistol',
    ammoType: 'bullets',
    ammoCost: 1,
    fireDelay: 0.35,
    range: 16.0,
    damage: 15,
    spread: 0.02,
    shakes: 3,
    flash: true,
    sound: 'pistol'
  },
  shotgun: {
    name: 'Shotgun',
    ammoType: 'shells',
    ammoCost: 1,
    fireDelay: 0.85,
    range: 12.0,
    damage: 12, // per pellet
    pellets: 7,
    spread: 0.12, // high spread
    shakes: 10,
    flash: true,
    sound: 'shotgun'
  },
  chaingun: {
    name: 'Chaingun',
    ammoType: 'bullets',
    ammoCost: 1,
    fireDelay: 0.12,
    range: 14.0,
    damage: 12,
    spread: 0.06,
    shakes: 5,
    flash: true,
    sound: 'chaingun'
  }
};

export class WeaponSystem {
  constructor(player) {
    this.player = player;
    this.fireCooldown = 0;
    this.frameIndex = 0;
    this.animState = 'idle'; // 'idle', 'fire', 'recoil'
    this.flashActive = false;
    this.screenShake = 0;
  }

  update(input, dt) {
    if (this.fireCooldown > 0) {
      this.fireCooldown -= dt;
    }

    if (this.screenShake > 0) {
      this.screenShake -= dt * 30;
      if (this.screenShake < 0) this.screenShake = 0;
    }

    const currentWep = WEAPON_DEFS[this.player.getActiveWeapon()];

    // Handle Animation Cycles
    if (this.animState === 'fire') {
      this.frameIndex += dt * 15;
      if (this.frameIndex >= 3) {
        if (currentWep.name === 'Shotgun') {
          // Play shotgun pump sound on reload frame
          this.animState = 'pump';
          this.frameIndex = 0;
        } else {
          this.animState = 'idle';
          this.frameIndex = 0;
        }
      }
    } else if (this.animState === 'pump') {
      this.frameIndex += dt * 8;
      if (this.frameIndex >= 2) {
        this.animState = 'idle';
        this.frameIndex = 0;
      }
    } else {
      // Idle bobbing
      this.frameIndex = 0;
    }

    // 1. Fire Weapon Trigger
    if (input.consumeFire() && this.fireCooldown <= 0) {
      this.fire(currentWep);
    }
  }

  fire(wep) {
    // Check Ammo
    if (wep.ammoType) {
      if (this.player.ammo[wep.ammoType] < wep.ammoCost) {
        // click dry fire
        playSound('fist_miss');
        this.fireCooldown = 0.4;
        return;
      }
      this.player.ammo[wep.ammoType] -= wep.ammoCost;
    }

    // Trigger States
    playSound(wep.sound);
    this.fireCooldown = wep.fireDelay;
    this.animState = 'fire';
    this.frameIndex = 0;
    this.flashActive = wep.flash;
    this.screenShake = wep.shakes;

    // Reset muzzle flash shortly
    setTimeout(() => {
      this.flashActive = false;
    }, 80);

    // 2. Perform Hitscan Raycasts to detect hits against enemies
    // The engine's update loop will pick up this request and intersect with active enemies.
    this.pendingShot = {
      wepType: this.player.getActiveWeapon(),
      damage: wep.damage,
      pellets: wep.pellets || 1,
      spread: wep.spread,
      range: wep.range
    };
  }

  // Draw weapon sprite on canvas center
  drawWeapon(ctx, width, height, walkBobY) {
    const active = this.player.getActiveWeapon();
    const midX = width / 2;
    const baseY = height - 40 + walkBobY;

    ctx.save();
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';

    switch (active) {
      case 'fist': {
        // Melee knuckles drawing
        ctx.fillStyle = '#cad2c5'; // skin
        ctx.strokeStyle = '#4a2c2c'; // shadows
        
        const offset = this.animState === 'fire' ? -40 : 0;

        // Draw left fist bobbing
        ctx.beginPath();
        ctx.arc(midX - 80, baseY + 60 + offset, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw right fist punching forward
        ctx.fillStyle = '#cad2c5';
        ctx.beginPath();
        ctx.arc(midX + 60, baseY + 40 + (offset * 1.5), 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'pistol': {
        // Draw gun grip and barrel extending from bottom-center
        const offset = this.animState === 'fire' ? 15 : 0;

        ctx.fillStyle = '#2d3748'; // gun metal
        ctx.fillRect(midX - 12, baseY - 60 + offset, 24, 60); // barrel
        
        ctx.fillStyle = '#1a202c'; // slide guard
        ctx.fillRect(midX - 8, baseY - 50 + offset, 16, 16);

        // Hands wrapping gun
        ctx.fillStyle = '#e2e8f0'; // skin pale
        ctx.beginPath();
        ctx.arc(midX, baseY + 5, 20, 0, Math.PI * 2);
        ctx.fill();

        // Muzzle Flash
        if (this.flashActive) {
          ctx.fillStyle = '#ecc94b';
          ctx.beginPath();
          ctx.arc(midX, baseY - 65 + offset, 16, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'shotgun': {
        // Heavy double barrel shotgun
        const isFiring = this.animState === 'fire';
        const isPumping = this.animState === 'pump';
        const recoil = isFiring ? 30 : isPumping ? 10 : 0;

        // Draw wood stock
        ctx.strokeStyle = '#7b3f00';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(midX, baseY + 20);
        ctx.lineTo(midX, baseY - 20 + recoil);
        ctx.stroke();

        // Draw double metal barrel
        ctx.strokeStyle = '#4a5568';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(midX - 6, baseY - 20 + recoil);
        ctx.lineTo(midX - 6, baseY - 90 + recoil);
        ctx.moveTo(midX + 6, baseY - 20 + recoil);
        ctx.lineTo(midX + 6, baseY - 90 + recoil);
        ctx.stroke();

        // Hands
        ctx.fillStyle = '#cad2c5';
        ctx.beginPath();
        ctx.arc(midX - 12, baseY - 10 + recoil, 12, 0, Math.PI * 2);
        ctx.arc(midX + 16, baseY - 15 + recoil, 12, 0, Math.PI * 2);
        ctx.fill();

        if (this.flashActive) {
          ctx.fillStyle = '#ed8936'; // orange glow
          ctx.beginPath();
          ctx.arc(midX, baseY - 100 + recoil, 24, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }

      case 'chaingun': {
        // Rotational barrels
        const isFiring = this.animState === 'fire';
        const rotationShift = isFiring ? (Math.sin(Date.now() / 20) * 8) : 0;

        ctx.fillStyle = '#1a202c';
        // barrel base
        ctx.fillRect(midX - 18, baseY - 30, 36, 40);

        // draw 3 rotating tubes
        ctx.fillStyle = '#718096';
        ctx.fillRect(midX - 12 + rotationShift / 2, baseY - 80, 6, 50);
        ctx.fillRect(midX - 2 + rotationShift / 2, baseY - 85, 6, 55);
        ctx.fillRect(midX + 8 + rotationShift / 2, baseY - 80, 6, 50);

        // Muzzle Flash
        if (this.flashActive) {
          ctx.fillStyle = '#f6e05e';
          ctx.beginPath();
          ctx.arc(midX + rotationShift / 2, baseY - 90, 20, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }

    ctx.restore();
  }
}
