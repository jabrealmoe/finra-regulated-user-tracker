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
      ref={containerRef} 
      tabIndex={0}
      className="flex flex-col items-center justify-center mb-6 w-full outline-none"
    >
      {/* Header Panel */}
      <div 
        className="flex items-center justify-between mb-2" 
        style={{ width: '100%', maxWidth: '648px', padding: '0 8px' }}
      >
        <div className="flex space-x-8">
          <div>
            <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Engine</span>
            <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold' }}>3D DDA Raycaster</span>
          </div>
          <div>
            <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mission</span>
            <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 'bold' }}>Find the Red Portal</span>
          </div>
        </div>
        <button 
          onClick={handleMuteToggle}
          className={`p-2 rounded-full transition-colors ${!muted ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-600 hover:bg-slate-500'}`}
          style={{ border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title={muted ? "Unmute sounds" : "Mute sounds"}
        >
          {muted ? <VolumeX className="w-4 h-4 text-white" /> : <Volume2 className="w-4 h-4 text-white" />}
        </button>
      </div>

      {/* 3D Canvas Box */}
      <div className="relative rounded-xl overflow-hidden shadow-2xl border-4 border-slate-700 bg-black">
        <canvas 
          ref={canvasRef} 
          width={320} 
          height={240}
          className="block"
          style={{ 
            width: '640px',
            height: '480px',
            background: '#060713',
            imageRendering: 'pixelated', // Keep pixel art chunky scaling
            cursor: gameState === 'playing' ? 'crosshair' : 'default'
          }}
        />

        {gameState === 'title' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{ background: 'rgba(6, 7, 19, 0.94)' }}>
            <h1 className="text-4xl font-bold text-red-500 mb-2" style={{ fontFamily: 'monospace', textShadow: '3px 3px 0 #991b1b', letterSpacing: '0.1em' }}>
              DOOMY
            </h1>
            <button 
              className="px-8 py-3 bg-red-600 text-white font-bold text-lg rounded-lg hover:bg-red-500 transition-all transform hover:scale-105 shadow-lg mb-6"
              style={{ border: 'none', cursor: 'pointer' }}
              onClick={startGame}
            >
              🔥 ENTER COMPLEX
            </button>
            <div style={{ color: '#94a3b8', fontSize: '11px', lineHeight: '1.5', fontFamily: 'monospace' }}>
              WASD / ARROWS • WALK & STRAFE<br />
              MOUSE • LOOK & ROTATE<br />
              SPACEBAR / CLICK • FIRE WEAPON<br />
              E KEY • INTERACT / OPEN DOORS<br />
              KEYS 1-4 • CHANGE WEAPONS
            </div>
          </div>
        )}

        {gameState === 'playing' && !isPointerLocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{ background: 'rgba(6, 7, 19, 0.75)' }}>
            <span className="text-white font-bold text-sm tracking-widest" style={{ fontFamily: 'monospace' }}>
              CLICK CANVAS TO LOCK MOUSE & PLAY
            </span>
          </div>
        )}

        {gameState === 'gameover' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{ background: 'rgba(0, 0, 0, 0.95)' }}>
            <div className="text-red-500 font-bold text-4xl mb-4" style={{ fontFamily: 'monospace', textShadow: '2px 2px 0 #7f1d1d' }}>YOU DIED</div>
            <button 
              className="px-8 py-3 bg-red-600 text-white font-bold text-lg rounded-lg hover:bg-red-500 transition-all transform hover:scale-105 shadow-lg"
              style={{ border: 'none', cursor: 'pointer' }}
              onClick={startGame}
            >
              🔄 TRY AGAIN
            </button>
          </div>
        )}

        {gameState === 'win' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center" style={{ background: 'rgba(6, 7, 19, 0.95)' }}>
            <div className="text-yellow-400 font-bold text-3xl mb-2" style={{ fontFamily: 'monospace', textShadow: '2px 2px 0 #854d0e' }}>
              MISSION ACCOMPLISHED
            </div>
            <div className="mb-6" style={{ color: '#cbd5e1', fontSize: '13px' }}>
              YOU ESCAPED THE COMPLEX VIA THE EXIT PORTAL!
            </div>
            <button 
              className="px-8 py-3 bg-yellow-500 text-black font-bold text-lg rounded-lg hover:bg-yellow-400 transition-all transform hover:scale-105 shadow-lg"
              style={{ border: 'none', cursor: 'pointer' }}
              onClick={startGame}
            >
              🎮 REPLAY MISSION
            </button>
          </div>
        )}
      </div>

      {/* Controls description panel */}
      <div className="text-slate-400 text-xs mt-2 font-mono text-center" style={{ maxWidth: '640px', lineHeight: '1.5' }}>
        <strong>Movement Controls</strong>: Move with <kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>W</kbd>/<kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>S</kbd> (or <kbd>↑</kbd>/<kbd>↓</kbd>), Strafe with <kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>A</kbd>/<kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>D</kbd>, Turn with mouse rotation (or Q/E/Arrows).<br />
        <strong>Actions</strong>: Shoot with <kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>Spacebar</kbd> / Left-Click, Open doors with <kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>E</kbd>, Switch weapons with <kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>1</kbd>-<kbd style={{ background: '#334155', padding: '2px 4px', borderRadius: '3px' }}>4</kbd> keys.
      </div>
    </div>
  );
};

export default DoomyGame;
