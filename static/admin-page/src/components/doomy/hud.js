/**
 * Doomy HUD Module
 * Renders the bottom dashboard HUD, health indicators, armor levels, ammo indicators,
 * damage flash screens, pickup flashes, and crosshair overlays.
 */

export class HUD {
  constructor(player) {
    this.player = player;
    this.damageFlash = 0;
    this.pickupFlash = 0;
  }

  triggerDamageFlash() {
    this.damageFlash = 0.5; // seconds
  }

  triggerPickupFlash() {
    this.pickupFlash = 0.25;
  }

  update(dt) {
    if (this.damageFlash > 0) {
      this.damageFlash -= dt;
      if (this.damageFlash < 0) this.damageFlash = 0;
    }
    if (this.pickupFlash > 0) {
      this.pickupFlash -= dt;
      if (this.pickupFlash < 0) this.pickupFlash = 0;
    }
  }

  // Draw HUD dashboard panels
  draw(ctx, width, height, currentWepDef) {
    // 1. Draw Hit Screen Flashes
    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(229, 62, 62, ${this.damageFlash * 0.5})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (this.pickupFlash > 0) {
      ctx.fillStyle = `rgba(236, 201, 75, ${this.pickupFlash * 0.4})`;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Draw Crosshair (Small white dot/cross)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 4, height / 2);
    ctx.lineTo(width / 2 + 4, height / 2);
    ctx.moveTo(width / 2, height / 2 - 4);
    ctx.lineTo(width / 2, height / 2 + 4);
    ctx.stroke();

    // 3. Draw Bottom Status Bar (Doom-style dashboard)
    const hudH = 40;
    const hudY = height - hudH;

    // Background
    ctx.fillStyle = '#0f172a'; // slate 900
    ctx.fillRect(0, hudY, width, hudH);
    ctx.strokeStyle = '#334155'; // border
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hudY);
    ctx.lineTo(width, hudY);
    ctx.stroke();

    // Status Boxes
    const boxW = Math.floor(width / 4);

    // Box 1: AMMO
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(2, hudY + 4, boxW - 4, hudH - 8);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '7px monospace';
    ctx.fillText('AMMO', 8, hudY + 12);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px monospace';
    const ammoReserves = currentWepDef.ammoType ? this.player.ammo[currentWepDef.ammoType] : '∞';
    ctx.fillText(String(ammoReserves), 8, hudY + 30);

    // Box 2: HEALTH
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(boxW + 2, hudY + 4, boxW - 4, hudH - 8);
    ctx.fillStyle = '#ef4444'; // Red health text
    ctx.font = '7px monospace';
    ctx.fillText('HEALTH', boxW + 8, hudY + 12);
    
    // Draw face emoticon depending on health bracket
    let face = '🙂';
    if (this.player.isDead) face = '💀';
    else if (this.player.health < 25) face = '😰';
    else if (this.player.health < 50) face = '🤕';
    else if (this.player.health < 75) face = '😐';
    else if (this.player.health > 150) face = '😎';

    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${this.player.health}%`, boxW + 8, hudY + 30);
    ctx.font = '14px sans-serif';
    ctx.fillText(face, boxW + boxW - 20, hudY + 28);

    // Box 3: ARMOR
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(boxW * 2 + 2, hudY + 4, boxW - 4, hudH - 8);
    ctx.fillStyle = '#10b981'; // Green armor text
    ctx.font = '7px monospace';
    ctx.fillText('ARMOR', boxW * 2 + 8, hudY + 12);
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`${this.player.armor}%`, boxW * 2 + 8, hudY + 30);

    // Box 4: ARSENAL/WEAPON
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(boxW * 3 + 2, hudY + 4, boxW - 4, hudH - 8);
    ctx.fillStyle = '#f59e0b';
    ctx.font = '7px monospace';
    ctx.fillText('WEAPON', boxW * 3 + 8, hudY + 12);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(currentWepDef.name.toUpperCase(), boxW * 3 + 8, hudY + 26);
  }
}
export default HUD;
