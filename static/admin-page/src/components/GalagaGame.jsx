import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const GalagaGame = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Game UI State
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [highScore, setHighScore] = useState(() => {
    try {
      return parseInt(localStorage.getItem('galaga_high_score') || '0', 10);
    } catch {
      return 0;
    }
  });
  const [lives, setLives] = useState(3);

  // App Logic State
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);

  const audioContextRef = useRef(null);

  // Play retro synthesised sound effects using Web Audio API
  const playSound = (type) => {
    if (!musicEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = audioContextRef.current || new AudioContext();
      audioContextRef.current = ctx;

      const now = ctx.currentTime;
      if (type === 'laser') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'explosion') {
        const bufferSize = ctx.sampleRate * 0.25; // 0.25 seconds
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, now);
        filter.frequency.linearRampToValueAtTime(100, now + 0.25);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
        noise.stop(now + 0.25);
      } else if (type === 'player_explosion') {
        // Multi-frequency noise explosion
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(300, now);
        osc1.frequency.linearRampToValueAtTime(40, now + 0.5);
        osc2.frequency.setValueAtTime(150, now);
        osc2.frequency.linearRampToValueAtTime(20, now + 0.5);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.5);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.5);
        osc2.stop(now + 0.5);
      } else if (type === 'level_up') {
        const melody = [330, 392, 659, 784]; // E4, G4, E5, G5
        melody.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, now + idx * 0.1);
          gain.gain.setValueAtTime(0.08, now + idx * 0.1);
          gain.gain.linearRampToValueAtTime(0.001, now + idx * 0.1 + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.1);
          osc.stop(now + idx * 0.1 + 0.15);
        });
      }
    } catch (e) {
      console.error('Audio playback failed', e);
    }
  };

  const handleStartGame = () => {
    setScore(0);
    setLevel(1);
    setLives(3);
    setGameOver(false);
    setGameStarted(true);
    playSound('level_up');
  };

  useEffect(() => {
    if (gameStarted && containerRef.current) {
      containerRef.current.focus();
    }
  }, [gameStarted]);

  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId;
    let keys = {};

    // Game variables
    const playerWidth = 32;
    const playerHeight = 24;
    let playerX = canvas.width / 2 - playerWidth / 2;
    const playerY = canvas.height - 40;
    const playerSpeed = 6;

    let lasers = []; // Player projectiles
    let enemyLasers = []; // Enemy projectiles
    let enemies = [];
    let stars = [];

    // Initialize stars for background
    for (let i = 0; i < 40; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: Math.random() * 2 + 1,
        size: Math.random() * 1.5 + 0.5,
      });
    }

    // Initialize enemy fleet
    const createEnemies = (lvl) => {
      const rows = 4;
      const cols = 8;
      const xSpacing = 40;
      const ySpacing = 30;
      const xOffset = (canvas.width - (cols - 1) * xSpacing - 24) / 2;
      const yOffset = 50;

      const newEnemies = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          newEnemies.push({
            x: xOffset + c * xSpacing,
            y: yOffset + r * ySpacing,
            width: 24,
            height: 20,
            type: r === 0 ? 'commander' : r < 3 ? 'interceptor' : 'drone',
            alive: true,
            phase: Math.random() * Math.PI * 2, // for oscillating movement
          });
        }
      }
      return newEnemies;
    };

    enemies = createEnemies(level);

    let enemyDirection = 1;
    let enemySpeed = 1.2 + level * 0.2;
    let lastShotTime = 0;

    const handleKeyDown = (e) => {
      keys[e.key] = true;
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault(); // prevent scrolling
        const now = Date.now();
        if (now - lastShotTime > 300) {
          lasers.push({
            x: playerX + playerWidth / 2 - 2,
            y: playerY,
            width: 4,
            height: 12,
            speed: 8,
          });
          playSound('laser');
          lastShotTime = now;
        }
      }
    };

    const handleKeyUp = (e) => {
      keys[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Main Game Loop
    const update = () => {
      ctx.fillStyle = '#060713';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 1. Draw Starfield
      ctx.fillStyle = '#ffffff';
      stars.forEach((star) => {
        ctx.fillRect(star.x, star.y, star.size, star.size);
        star.y += star.speed;
        if (star.y > canvas.height) {
          star.y = 0;
          star.x = Math.random() * canvas.width;
        }
      });

      // 2. Update Player position
      if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
        playerX = Math.max(10, playerX - playerSpeed);
      }
      if (keys['ArrowRight'] || keys['d'] || keys['D']) {
        playerX = Math.min(canvas.width - playerWidth - 10, playerX + playerSpeed);
      }

      // Draw Player Spaceship (Classic fighter design)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Tip
      ctx.moveTo(playerX + playerWidth / 2, playerY);
      // Right wing
      ctx.lineTo(playerX + playerWidth, playerY + playerHeight);
      ctx.lineTo(playerX + playerWidth * 0.75, playerY + playerHeight * 0.75);
      // Bottom fuselage
      ctx.lineTo(playerX + playerWidth * 0.25, playerY + playerHeight * 0.75);
      // Left wing
      ctx.lineTo(playerX, playerY + playerHeight);
      ctx.closePath();
      ctx.stroke();

      // Draw thruster fire (animated)
      if (Math.random() > 0.3) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(playerX + playerWidth * 0.4, playerY + playerHeight * 0.85);
        ctx.lineTo(playerX + playerWidth * 0.5, playerY + playerHeight * 1.1);
        ctx.lineTo(playerX + playerWidth * 0.6, playerY + playerHeight * 0.85);
        ctx.closePath();
        ctx.fill();
      }

      // 3. Update & Draw Player Lasers
      ctx.fillStyle = '#38bdf8';
      lasers = lasers.filter((laser) => {
        ctx.fillRect(laser.x, laser.y, laser.width, laser.height);
        laser.y -= laser.speed;
        return laser.y > 0;
      });

      // 4. Update & Draw Enemies
      let changeDir = false;
      let aliveCount = 0;

      enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        aliveCount++;

        // Swarm horizontal oscillation
        enemy.x += enemyDirection * enemySpeed;
        enemy.phase += 0.05;

        // Individual hover bobbing
        const yOffset = Math.sin(enemy.phase) * 2;

        if (enemy.x > canvas.width - enemy.width - 15 || enemy.x < 15) {
          changeDir = true;
        }

        // Draw enemies using vector wireframe lines to match 80s arcade feel
        if (enemy.type === 'commander') {
          ctx.strokeStyle = '#f43f5e'; // Rose pink
          ctx.beginPath();
          ctx.moveTo(enemy.x + enemy.width / 2, enemy.y + yOffset);
          ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height * 0.5 + yOffset);
          ctx.lineTo(enemy.x + enemy.width * 0.75, enemy.y + enemy.height + yOffset);
          ctx.lineTo(enemy.x + enemy.width * 0.25, enemy.y + enemy.height + yOffset);
          ctx.lineTo(enemy.x, enemy.y + enemy.height * 0.5 + yOffset);
          ctx.closePath();
          ctx.stroke();
        } else if (enemy.type === 'interceptor') {
          ctx.strokeStyle = '#a855f7'; // Purple
          ctx.beginPath();
          ctx.moveTo(enemy.x + enemy.width / 2, enemy.y + enemy.height + yOffset);
          ctx.lineTo(enemy.x + enemy.width, enemy.y + yOffset);
          ctx.lineTo(enemy.x + enemy.width * 0.5, enemy.y + enemy.height * 0.4 + yOffset);
          ctx.lineTo(enemy.x, enemy.y + yOffset);
          ctx.closePath();
          ctx.stroke();
        } else {
          ctx.strokeStyle = '#eab308'; // Yellow drone
          ctx.beginPath();
          ctx.arc(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2 + yOffset, enemy.width / 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Enemy shooting logic (probability increases with level)
        if (Math.random() < 0.002 * level) {
          enemyLasers.push({
            x: enemy.x + enemy.width / 2 - 1.5,
            y: enemy.y + enemy.height,
            width: 3,
            height: 10,
            speed: 4 + level * 0.3,
          });
        }
      });

      if (changeDir) {
        enemyDirection *= -1;
        // Move enemies down slightly on direction change
        enemies.forEach((enemy) => {
          enemy.y += 8;
        });
      }

      // Check level complete
      if (aliveCount === 0) {
        setLevel((prev) => {
          const next = prev + 1;
          enemies = createEnemies(next);
          enemySpeed = 1.2 + next * 0.2;
          playSound('level_up');
          return next;
        });
      }

      // 5. Update & Draw Enemy Lasers
      ctx.fillStyle = '#f43f5e';
      enemyLasers = enemyLasers.filter((laser) => {
        ctx.fillRect(laser.x, laser.y, laser.width, laser.height);
        laser.y += laser.speed;

        // Collision with player
        if (
          laser.x > playerX &&
          laser.x < playerX + playerWidth &&
          laser.y > playerY &&
          laser.y < playerY + playerHeight
        ) {
          setLives((prevLives) => {
            const nextLives = prevLives - 1;
            playSound('player_explosion');
            if (nextLives <= 0) {
              setGameOver(true);
              setHighScore((prevHigh) => {
                const currentScore = score; // capture current score
                if (currentScore > prevHigh) {
                  try {
                    localStorage.setItem('galaga_high_score', currentScore.toString());
                  } catch {}
                  return currentScore;
                }
                return prevHigh;
              });
            } else {
              // Reset player position temporarily
              playerX = canvas.width / 2 - playerWidth / 2;
            }
            return nextLives;
          });
          return false; // remove laser
        }
        return laser.y < canvas.height;
      });

      // 6. Projectile-Enemy Collisions
      lasers.forEach((laser, lIdx) => {
        enemies.forEach((enemy) => {
          if (!enemy.alive) return;
          if (
            laser.x > enemy.x &&
            laser.x < enemy.x + enemy.width &&
            laser.y > enemy.y &&
            laser.y < enemy.y + enemy.height
          ) {
            enemy.alive = false;
            lasers.splice(lIdx, 1);
            playSound('explosion');
            setScore((prevScore) => {
              const points = enemy.type === 'commander' ? 150 : enemy.type === 'interceptor' ? 80 : 50;
              return prevScore + points;
            });
          }
        });
      });

      // Check if enemies reached bottom
      enemies.forEach((enemy) => {
        if (enemy.alive && enemy.y + enemy.height >= playerY) {
          setGameOver(true);
        }
      });

      if (!gameOver) {
        animationId = requestAnimationFrame(update);
      }
    };

    update();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameStarted, gameOver, level, score]);

  return (
    <div 
      className="pacman-container" 
      ref={containerRef} 
      tabIndex={0}
      style={{ outline: 'none' }}
    >
      <div className="pacman-header">
        <div className="pacman-score-panel">
          <div className="pacman-score-box">
            <div className="pacman-score-label">1UP SCORE</div>
            <div className="pacman-score-val">{score.toString().padStart(6, '0')}</div>
          </div>
          <div className="pacman-score-box">
            <div className="pacman-score-label">HIGH SCORE</div>
            <div className="pacman-score-val">{highScore.toString().padStart(6, '0')}</div>
          </div>
          <div className="pacman-score-box">
            <div className="pacman-score-label">LEVEL</div>
            <div className="pacman-score-val">{level}</div>
          </div>
        </div>
        <button 
          onClick={() => setMusicEnabled(!musicEnabled)}
          className="pacman-sound-toggle"
          title={musicEnabled ? "Mute sounds" : "Unmute sounds"}
        >
          {musicEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      </div>

      <div className="pacman-canvas-wrapper" style={{ borderColor: '#f43f5e' }}>
        <canvas 
          ref={canvasRef} 
          width={400} 
          height={380}
          style={{ display: 'block', background: '#060713' }}
        />

        {!gameStarted && (
          <div className="pacman-overlay">
            <div className="pacman-title" style={{ color: '#f43f5e', textShadow: '0 0 10px rgba(244,63,94,0.5)' }}>GALAGA</div>
            <button className="pacman-start-btn" style={{ background: '#f43f5e' }} onClick={handleStartGame}>
              PLAY GAME
            </button>
            <div className="pacman-instructions">
              ARROW / A-D KEYS TO MOVE • SPACEBAR TO SHOOT
            </div>
          </div>
        )}

        {gameStarted && gameOver && (
          <div className="pacman-overlay">
            <div className="pacman-gameover">GAME OVER</div>
            <button className="pacman-start-btn" style={{ background: '#f43f5e' }} onClick={handleStartGame}>
              PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      <div className="pacman-footer">
        <div className="pacman-lives">
          {Array.from({ length: Math.max(0, lives) }).map((_, i) => (
            <span key={i} className="pacman-life-icon" style={{ borderBottomColor: '#38bdf8' }} />
          ))}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase' }}>
          © 1981 Midway Clone
        </div>
      </div>
    </div>
  );
};

export default GalagaGame;
