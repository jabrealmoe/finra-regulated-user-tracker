import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Player } from './doomy/player';
import { WeaponSystem, WEAPON_DEFS } from './doomy/weapons';
import { HUD } from './doomy/hud';
import { EntitySystem } from './doomy/entities';
import { InputHandler } from './doomy/input';
import { Engine } from './doomy/engine';
import { ITEM_SPAWNS, ENEMY_SPAWNS } from './doomy/level';
import { setMute, getMuted } from './doomy/audio';

const DoomyGame = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [gameState, setGameState] = useState('title'); // 'title', 'playing', 'gameover', 'win'
  const [muted, setMutedState] = useState(getMuted());
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const engineRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Setup pointerlock change listener for UI updates
    const handlePointerLock = () => {
      setIsPointerLocked(document.pointerLockElement === canvasRef.current);
    };

    document.addEventListener('pointerlockchange', handlePointerLock);
    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLock);
      cleanupGame();
    };
  }, []);

  const startGame = () => {
    cleanupGame();
    setGameState('playing');

    const canvas = canvasRef.current;
    if (!canvas) return;

    // 1. Initialize self-contained game objects
    const player = new Player();
    const weaponSystem = new WeaponSystem(player);
    
    // Inject custom damage trigger in hud to flash screen
    const hud = new HUD(player);
    player.takeDamage = ((originalTakeDamage) => {
      return function (amount) {
        originalTakeDamage.call(this, amount);
        hud.triggerDamageFlash();
      };
    })(player.takeDamage);

    player.pickupItem = ((originalPickupItem) => {
      return function (type) {
        const success = originalPickupItem.call(this, type);
        if (success) {
          hud.triggerPickupFlash();
        }
        return success;
      };
    })(player.pickupItem);

    const entities = new EntitySystem(player);
    entities.spawnItems(ITEM_SPAWNS);
    entities.spawnEnemies(ENEMY_SPAWNS);

    const input = new InputHandler(canvas);
    inputRef.current = input;

    // 2. Initialize and run Raycast Engine
    const engine = new Engine(
      canvas,
      player,
      weaponSystem,
      hud,
      entities,
      (nextState) => {
        setGameState(nextState);
        cleanupGame();
      }
    );

    engine.input = input;
    engineRef.current = engine;
    engine.start();

    // Focus container and request lock
    if (containerRef.current) {
      containerRef.current.focus();
    }
    setTimeout(() => {
      canvas.requestPointerLock();
    }, 100);
  };

  const cleanupGame = () => {
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
    if (inputRef.current) {
      inputRef.current.destroy();
      inputRef.current = null;
    }
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  };

  const handleMuteToggle = (e) => {
    e.stopPropagation();
    const nextMute = !muted;
    setMutedState(nextMute);
    setMute(nextMute);
  };

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
            <div className="pacman-score-label" style={{ color: '#ef4444' }}>ENGINE</div>
            <div className="pacman-score-val" style={{ fontSize: '10px' }}>3D DDA RAYCASTER</div>
          </div>
          <div className="pacman-score-box">
            <div className="pacman-score-label" style={{ color: '#ef4444' }}>MISSION</div>
            <div className="pacman-score-val" style={{ fontSize: '10px' }}>FIND THE RED PORTAL</div>
          </div>
        </div>
        <button 
          onClick={handleMuteToggle}
          className="pacman-sound-toggle"
          title={muted ? "Unmute sounds" : "Mute sounds"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <div className="pacman-canvas-wrapper" style={{ borderColor: '#ef4444' }}>
        <canvas 
          ref={canvasRef} 
          width={320} 
          height={240}
          style={{ 
            display: 'block', 
            background: '#060713',
            imageRendering: 'pixelated', // Nearest-neighbor scaling
            cursor: gameState === 'playing' ? 'crosshair' : 'default'
          }}
        />

        {gameState === 'title' && (
          <div className="pacman-overlay" style={{ background: 'rgba(6, 7, 19, 0.9)' }}>
            <div className="pacman-title" style={{ color: '#ef4444', textShadow: '0 0 12px rgba(239,68,68,0.6)' }}>
              DOOMY
            </div>
            <button className="pacman-start-btn" style={{ background: '#ef4444' }} onClick={startGame}>
              PLAY MISSION
            </button>
            <div className="pacman-instructions" style={{ fontSize: '10px', lineHeight: '1.4' }}>
              WASD / ARROWS • WALK & STRAFE<br />
              MOUSE • LOOK & ROTATE<br />
              SPACEBAR / CLICK • FIRE WEAPON<br />
              E KEY • INTERACT / OPEN DOORS<br />
              KEYS 1-4 • CHANGE WEAPONS
            </div>
          </div>
        )}

        {gameState === 'playing' && !isPointerLocked && (
          <div className="pacman-overlay" style={{ background: 'rgba(6, 7, 19, 0.75)' }}>
            <div className="pacman-instructions" style={{ fontSize: '13px', fontWeight: 'bold' }}>
              CLICK CANVAS TO LOCK MOUSE & PLAY
            </div>
          </div>
        )}

        {gameState === 'gameover' && (
          <div className="pacman-overlay" style={{ background: 'rgba(0, 0, 0, 0.92)' }}>
            <div className="pacman-gameover" style={{ color: '#ef4444', fontSize: '24px' }}>YOU DIED</div>
            <button className="pacman-start-btn" style={{ background: '#ef4444' }} onClick={startGame}>
              TRY AGAIN
            </button>
          </div>
        )}

        {gameState === 'win' && (
          <div className="pacman-overlay" style={{ background: 'rgba(6, 7, 19, 0.95)' }}>
            <div className="pacman-title" style={{ color: '#ecc94b', fontSize: '20px', textShadow: '0 0 8px rgba(236,201,75,0.5)' }}>
              LEVEL COMPLETE
            </div>
            <div className="pacman-instructions" style={{ marginBottom: '16px', color: '#a0aec0' }}>
              YOU ESCAPED THE COMPLEX!
            </div>
            <button className="pacman-start-btn" style={{ background: '#ecc94b', color: '#1a202c' }} onClick={startGame}>
              REPLAY MISSION
            </button>
          </div>
        )}
      </div>

      <div className="pacman-footer">
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase' }}>
          © 1993 id Software Clone
        </div>
      </div>
    </div>
  );
};

export default DoomyGame;
