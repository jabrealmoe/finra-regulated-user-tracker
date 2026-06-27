import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const PacManGame = () => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // Game UI State
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  
  // App Logic State
  const [gameStarted, setGameStarted] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  
  const audioContextRef = useRef(null);

  const playIntroMusic = () => {
    if (!musicEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const now = ctx.currentTime;
      
      // Ms. Pac-Man Intro Melody (approx)
      const melody = [
        // Measure 1
        { freq: 493.88, start: 0.0, duration: 0.1 }, // B4
        { freq: 987.77, start: 0.1, duration: 0.1 }, // B5
        { freq: 739.99, start: 0.2, duration: 0.1 }, // F#5
        { freq: 622.25, start: 0.3, duration: 0.1 }, // D#5
        { freq: 987.77, start: 0.4, duration: 0.1 }, // B5
        { freq: 739.99, start: 0.5, duration: 0.1 }, // F#5
        { freq: 622.25, start: 0.6, duration: 0.25 }, // D#5

        // Measure 2 (Key Change)
        { freq: 523.25, start: 0.9, duration: 0.1 }, // C5
        { freq: 1046.50, start: 1.0, duration: 0.1 }, // C6
        { freq: 783.99, start: 1.1, duration: 0.1 }, // G5
        { freq: 659.25, start: 1.2, duration: 0.1 }, // E5
        { freq: 1046.50, start: 1.3, duration: 0.1 }, // C6
        { freq: 783.99, start: 1.4, duration: 0.1 }, // G5
        { freq: 659.25, start: 1.5, duration: 0.25 }, // E5

        // Measure 3
        { freq: 493.88, start: 1.8, duration: 0.1 }, // B4
        { freq: 987.77, start: 1.9, duration: 0.1 }, // B5
        { freq: 739.99, start: 2.0, duration: 0.1 }, // F#5
        { freq: 622.25, start: 2.1, duration: 0.1 }, // D#5
        { freq: 987.77, start: 2.2, duration: 0.1 }, // B5
        { freq: 739.99, start: 2.3, duration: 0.1 }, // F#5
        { freq: 622.25, start: 2.4, duration: 0.25 }, // D#5
        
        // Measure 4 (Ending)
        { freq: 622.25, start: 2.7, duration: 0.08 }, // D#5
        { freq: 659.25, start: 2.78, duration: 0.08 }, // E5
        { freq: 698.46, start: 2.86, duration: 0.08 }, // F5
        { freq: 698.46, start: 2.94, duration: 0.4 }, // F5 (hold)
      ];

      melody.forEach(note => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = note.freq;
        osc.type = 'triangle'; 
        osc.connect(gain);
        gain.connect(ctx.destination);
        const startTime = now + note.start;
        osc.start(startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + note.duration);
        osc.stop(startTime + note.duration);
      });
    } catch (e) {
      console.error("Audio playback failed", e);
    }
  };

  const handleStartGame = () => {
    playIntroMusic();
    setTimeout(() => {
        setScore(0);
        setLevel(1);
        setLives(3);
        setGameStarted(true);
    }, 3200);
  };

  useEffect(() => {
    if (gameStarted && containerRef.current) {
      containerRef.current.focus();
    }
  }, [gameStarted]);

  useEffect(() => {
    if (!gameStarted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // ============================================
    // CONFIGURATION & STATE MACHINE
    // ============================================
    const TILE_SIZE = 32;
    const COLS = 28;
    const MOVE_FRAMES = 8;
    
    // States
    const STATE_READY = 0;
    const STATE_PLAY = 1;
    const STATE_DYING = 2;
    const STATE_GAMEOVER = 3;
    const STATE_FROZEN = 4; // New state for pre-death pause

    let gameState = STATE_READY;
    let stateEndTime = Date.now() + 2200; // Initial READY delay
    
    let gameStateScore = 0; 
    let gameLives = 3; 

    // Map: 1=Wall, 0=Dot, 2=PowerPellet, 3=Empty, 4=GhostHouse
    const MAP_TEMPLATE = [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
      [1,2,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,2,1],
      [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,0,1],
      [1,0,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,0,1],
      [1,0,0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,0,1,1,1,1,1,3,1,1,3,1,1,1,1,1,0,1,1,1,1,1,1],
      [3,3,3,3,3,1,0,1,1,1,1,1,3,1,1,3,1,1,1,1,1,0,1,3,3,3,3,3],
      [3,3,3,3,3,1,0,1,1,3,3,3,3,3,3,3,3,3,3,1,1,0,1,3,3,3,3,3],
      [1,1,1,1,1,1,0,1,1,3,1,1,4,4,4,4,1,1,3,1,1,0,1,1,1,1,1,1],
      [3,3,3,3,3,3,0,3,3,3,1,4,4,4,4,4,4,1,3,3,3,0,3,3,3,3,3,3],
      [1,1,1,1,1,1,0,1,1,3,1,1,1,1,1,1,1,1,3,1,1,0,1,1,1,1,1,1],
      [3,3,3,3,3,1,0,1,1,3,3,3,3,3,3,3,3,3,3,1,1,0,1,3,3,3,3,3],
      [3,3,3,3,3,1,0,1,1,3,1,1,1,1,1,1,1,1,3,1,1,0,1,3,3,3,3,3],
      [1,1,1,1,1,1,0,1,1,3,1,1,1,1,1,1,1,1,3,1,1,0,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
      [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,0,1,1,1,1,1,0,1,1,1,1,0,1],
      [1,2,0,0,1,1,0,0,0,0,0,0,0,3,3,0,0,0,0,0,0,0,1,1,0,0,2,1],
      [1,1,1,0,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,0,1,1,1],
      [1,1,1,0,1,1,0,1,1,0,1,1,1,1,1,1,1,1,0,1,1,0,1,1,0,1,1,1],
      [1,0,0,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0,0,0,1],
      [1,0,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,0,1],
      [1,0,1,1,1,1,1,1,1,1,1,1,0,1,1,0,1,1,1,1,1,1,1,1,1,1,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
    ];

    let mapLayout = JSON.parse(JSON.stringify(MAP_TEMPLATE));
    const ROWS = mapLayout.length;
    canvas.width = COLS * TILE_SIZE;
    canvas.height = ROWS * TILE_SIZE;

    // Track pellets
    let pelletsRemaining = 0;
    const countPellets = () => {
        let count = 0;
        for(let r=0; r<ROWS; r++){
            for(let c=0; c<COLS; c++){
                if(mapLayout[r][c] === 0 || mapLayout[r][c] === 2) count++;
            }
        }
        return count;
    };
    pelletsRemaining = countPellets();

    // ============================================
    // NAV MESH & VALIDATION
    // ============================================

    const isWall = (tx, ty) => {
      if (ty < 0 || ty >= ROWS) return true;
      if (tx < 0 || tx >= COLS) return false;
      return mapLayout[ty][tx] === 1;
    };

    const canEnter = (tx, ty) => !isWall(tx, ty);

    const findNearestValidTile = (startX, startY) => {
      if (canEnter(startX, startY)) return { x: startX, y: startY };
      const visited = new Set();
      const queue = [[startX, startY, 0]];
      while (queue.length > 0) {
        const [x, y] = queue.shift();
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (canEnter(x, y)) return { x, y };
        [[0,-1], [0,1], [-1,0], [1,0]].forEach(([dx, dy]) => {
          const nx = x + dx; const ny = y + dy;
          if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) {
            queue.push([nx, ny, 0]);
          }
        });
      }
      return { x: 14, y: 21 }; // Default safe spot
    };

    const getValidSpawn = (preferredX, preferredY) => findNearestValidTile(preferredX, preferredY);

    // ============================================
    // ENTITIES & RESET
    // ============================================

    const pacmanSpawn = getValidSpawn(14, 21);
    const ghostConfigs = [
       { x: 14, y: 11, color: '#ef4444', dx: 1, dy: 0 },
       { x: 13, y: 13, color: '#f472b6', dx: 0, dy: -1 },
       { x: 14, y: 13, color: '#22d3d3', dx: 0, dy: -1 },
       { x: 15, y: 13, color: '#fb923c', dx: 0, dy: 1 }
    ];

    let pacman = { ...pacmanSpawn, dx: 0, dy: 0, nextDx: 0, nextDy: 0, progress: 0, moveFrames: MOVE_FRAMES, mouth: 0.2, mouthDir: 1, angle: 0 };
    let ghosts = [];

    const resetEntities = () => {
        pacman.tileX = pacmanSpawn.x;
        pacman.tileY = pacmanSpawn.y;
        pacman.dx = 0; pacman.dy = 0; pacman.nextDx = 0; pacman.nextDy = 0;
        pacman.progress = 0;
        pacman.mouth = 0.2;
        pacman.mouthDir = 1;
        pacman.angle = 0;

        ghosts = ghostConfigs.map(c => {
             const spawn = getValidSpawn(c.x, c.y);
             return {
                 tileX: spawn.x, tileY: spawn.y,
                 dx: c.dx, dy: c.dy,
                 progress: 0,
                 moveFrames: Math.floor(MOVE_FRAMES * 1.2),
                 color: c.color
             };
        });
    };
    
    // Initialize
    resetEntities();

    const advanceLevel = () => {
        mapLayout = JSON.parse(JSON.stringify(MAP_TEMPLATE));
        pelletsRemaining = countPellets();
        resetEntities();
        // Reset to READY state for new level
        gameState = STATE_READY;
        stateEndTime = Date.now() + 2000;
        setLevel(p => p + 1);
    };

    const handleGameOver = () => {
        setGameStarted(false);
        setHighScore(prev => Math.max(prev, gameStateScore));
    };

    // ============================================
    // AUDIO FX
    // ============================================
    
    const playDeathSound = () => {
      if (!musicEnabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = audioContextRef.current || new AudioContext();
        audioContextRef.current = ctx; // Ensure we keep the reference
        
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle'; // Smoother sound
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        // Descending pitch "Whoop-whoop-whoop" style
        osc.frequency.setValueAtTime(400, now);
        // Step down
        for (let i = 0; i < 10; i++) {
             osc.frequency.linearRampToValueAtTime(400 - (i * 40), now + (i * 0.1));
             gain.gain.setValueAtTime(0.1, now + (i * 0.1));
             gain.gain.linearRampToValueAtTime(0.05, now + (i * 0.1) + 0.05); // quick pulse
             gain.gain.linearRampToValueAtTime(0.1, now + (i * 0.1) + 0.1);
        }
        
        // Final fade
        gain.gain.linearRampToValueAtTime(0, now + 1.5);
        osc.start(now);
        osc.stop(now + 1.6);
        
      } catch (e) {
        console.error("Audio playback failed", e);
      }
    };

    // ============================================
    // UPDATE LOGIC
    // ============================================

    const updatePacman = () => {
       // Collision check
       if (isWall(pacman.tileX, pacman.tileY)) {
           const safe = findNearestValidTile(pacman.tileX, pacman.tileY);
           pacman.tileX = safe.x; pacman.tileY = safe.y;
           return;
       }
       
       if (pacman.progress > 0) {
           pacman.progress--;
           return;
       }

       // Turn logic
       if (pacman.nextDx || pacman.nextDy) {
           if (canEnter(pacman.tileX + pacman.nextDx, pacman.tileY + pacman.nextDy)) {
               pacman.dx = pacman.nextDx; pacman.dy = pacman.nextDy;
               pacman.nextDx = 0; pacman.nextDy = 0;
           }
       }

       if (pacman.dx || pacman.dy) {
           if (canEnter(pacman.tileX + pacman.dx, pacman.tileY + pacman.dy)) {
               pacman.tileX += pacman.dx;
               pacman.tileY += pacman.dy;
               pacman.progress = pacman.moveFrames;
               
               // Tunnel
               if (pacman.tileX <= 0) pacman.tileX = COLS - 1;
               else if (pacman.tileX >= COLS - 1) pacman.tileX = 0;
           } else {
               pacman.dx = 0; pacman.dy = 0;
           }
       }
    };

    const updateGhost = (ghost) => {
       if (ghost.progress > 0) {
           ghost.progress--;
           return;
       }
       
       const options = [];
       // Simple AI: Don't reverse immediately unless stuck
       [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dx, dy]) => {
           if (dx === -ghost.dx && dy === -ghost.dy) return; // inverse
           if (canEnter(ghost.tileX + dx, ghost.tileY + dy)) options.push({dx, dy});
       });

       if (options.length === 0) {
           ghost.dx = -ghost.dx; ghost.dy = -ghost.dy; // Reverse
       } else {
           // Go straight preference
           const straight = options.find(o => o.dx === ghost.dx && o.dy === ghost.dy);
           if (straight && Math.random() > 0.25) {
               // keep going
           } else {
               const choice = options[Math.floor(Math.random() * options.length)];
               ghost.dx = choice.dx; ghost.dy = choice.dy;
           }
       }

       if (canEnter(ghost.tileX + ghost.dx, ghost.tileY + ghost.dy)) {
           ghost.tileX += ghost.dx;
           ghost.tileY += ghost.dy;
           ghost.progress = ghost.moveFrames;
           if (ghost.tileX <= 0) ghost.tileX = COLS - 1;
           else if (ghost.tileX >= COLS - 1) ghost.tileX = 0;
       }
    };

    const getRenderPos = (char) => {
       const t = 1 - (char.progress / char.moveFrames);
       const prevX = (char.tileX - char.dx) * TILE_SIZE + TILE_SIZE/2;
       const prevY = (char.tileY - char.dy) * TILE_SIZE + TILE_SIZE/2;
       const currX = char.tileX * TILE_SIZE + TILE_SIZE/2;
       const currY = char.tileY * TILE_SIZE + TILE_SIZE/2;
       
       // Handle tunnel wrap interpolation
       if (Math.abs(currX - prevX) > TILE_SIZE * 2) return { x: currX, y: currY };

       return {
           x: prevX + (currX - prevX) * t,
           y: prevY + (currY - prevY) * t
       };
    };

    const render = () => {
        // Clear
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Map
        for(let r=0; r<ROWS; r++){
            for(let c=0; c<COLS; c++){
                const t = mapLayout[r][c];
                const x = c * TILE_SIZE;
                const y = r * TILE_SIZE;
                if (t === 1) {
                    ctx.fillStyle = '#1e3a8a';
                    ctx.fillRect(x+1, y+1, TILE_SIZE-2, TILE_SIZE-2);
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x+4, y+4, TILE_SIZE-8, TILE_SIZE-8);
                } else if (t === 0) {
                    ctx.fillStyle = '#fca5a5';
                    ctx.beginPath();
                    ctx.arc(x+TILE_SIZE/2, y+TILE_SIZE/2, 3, 0, Math.PI*2);
                    ctx.fill();
                } else if (t === 2) {
                    ctx.fillStyle = '#fca5a5';
                    ctx.beginPath();
                    ctx.arc(x+TILE_SIZE/2, y+TILE_SIZE/2, 8, 0, Math.PI*2);
                    ctx.fill();
                }
            }
        }

        // Pacman
        const pPos = getRenderPos(pacman);
        ctx.save();
        ctx.translate(pPos.x, pPos.y);
        
        if (gameState === STATE_DYING) {
             // Death Animation: Spin and Shrink
             // Calculate animation progress (0 to 1)
             const totalDuration = 1500;
             const elapsed = Math.max(0, totalDuration - (stateEndTime - Date.now() - 500)); // -500 buffer
             const progress = Math.min(1, elapsed / 1200);
             
             // Spin effect
             ctx.rotate(progress * Math.PI * 4);
             
             // Dissolve/Shrink effect (opening mouth all the way)
             const startMouth = 0.2;
             const endMouth = 2; // Full circle vanish
             const currentMouth = startMouth + (endMouth - startMouth) * progress;
             
             ctx.fillStyle = 'yellow';
             ctx.beginPath();
             // Draw arc that shrinks as mouth widens
             if (currentMouth < 1) {
                 ctx.arc(0, 0, TILE_SIZE*0.4 * (1-progress*0.5), currentMouth*Math.PI, (2-currentMouth)*Math.PI);
                 ctx.lineTo(0,0);
                 ctx.fill();
             } else {
                 // POP effect at end?
                 if (progress > 0.9) {
                     ctx.fillStyle = '#ffff00';
                     ctx.beginPath();
                     ctx.arc(0, 0, TILE_SIZE * 0.6 * (1-progress), 0, Math.PI*2);
                     ctx.fill();
                 }
             }
             
        } else {
            // Normal Render
            let angle = pacman.angle || 0;
            if(pacman.dx === 1) angle = 0;
            if(pacman.dx === -1) angle = Math.PI;
            if(pacman.dy === -1) angle = -Math.PI/2;
            if(pacman.dy === 1) angle = Math.PI/2;
            pacman.angle = angle; // Store for frozen state
            ctx.rotate(angle);
            
            // Mouth animation
            if (gameState === STATE_PLAY) {
                 pacman.mouth += 0.05 * pacman.mouthDir;
                 if(pacman.mouth > 0.35) pacman.mouthDir = -1;
                 if(pacman.mouth < 0.05) pacman.mouthDir = 1;
            }
    
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.arc(0, 0, TILE_SIZE*0.4, pacman.mouth*Math.PI, (2-pacman.mouth)*Math.PI);
            ctx.lineTo(0,0);
            ctx.fill();
        }
        ctx.restore();

        // Ghosts - Hide during death
        if (gameState !== STATE_DYING && gameState !== STATE_GAMEOVER) {
            ghosts.forEach(g => {
                const gPos = getRenderPos(g);
                ctx.fillStyle = g.color;
                ctx.beginPath();
                ctx.arc(gPos.x, gPos.y, TILE_SIZE*0.4, Math.PI, 0);
                ctx.lineTo(gPos.x + TILE_SIZE*0.4, gPos.y + TILE_SIZE*0.4);
                ctx.lineTo(gPos.x - TILE_SIZE*0.4, gPos.y + TILE_SIZE*0.4);
                ctx.fill();
                
                // Eyes
                ctx.fillStyle = 'white';
                ctx.beginPath();
                ctx.arc(gPos.x - 6, gPos.y - 4, 4, 0, Math.PI*2);
                ctx.arc(gPos.x + 6, gPos.y - 4, 4, 0, Math.PI*2);
                ctx.fill();
                ctx.fillStyle = 'blue';
                ctx.beginPath();
                ctx.arc(gPos.x - 6 + g.dx*2, gPos.y - 4 + g.dy*2, 2, 0, Math.PI*2);
                ctx.arc(gPos.x + 6 + g.dx*2, gPos.y - 4 + g.dy*2, 2, 0, Math.PI*2);
                ctx.fill();
            });
        }

        // ============================
        // STATE TEXT OVERLAYS
        // ============================
        if (gameState === STATE_READY) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; // dim
            ctx.fillRect(0, canvas.height/2 - 20, canvas.width, 40);
            ctx.fillStyle = '#ffcc00';
            ctx.font = 'bold 32px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 4;
            ctx.fillText('READY!', canvas.width/2, canvas.height/2);
            ctx.shadowBlur = 0;
        } else if (gameState === STATE_GAMEOVER) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 48px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 10;
            ctx.fillText('GAME OVER', canvas.width/2, canvas.height/2);
            ctx.shadowBlur = 0;
        }
    };

    const loop = () => {
        try {
            const now = Date.now();

            if (gameState === STATE_READY) {
               if (now > stateEndTime) {
                   gameState = STATE_PLAY;
               }
            } 
            else if (gameState === STATE_PLAY) {
                updatePacman();
                ghosts.forEach(updateGhost);
                
                // Eating
                const t = mapLayout[pacman.tileY]?.[pacman.tileX];
                if (t === 0 || t === 2) {
                    const val = (t===2) ? 50 : 10;
                    mapLayout[pacman.tileY][pacman.tileX] = 3;
                    gameStateScore += val;
                    setScore(gameStateScore);
                    pelletsRemaining--;
                    if (pelletsRemaining <= 0) advanceLevel();
                }

                // Collision
                for(const g of ghosts) {
                    const dx = Math.abs(g.tileX - pacman.tileX);
                    const dy = Math.abs(g.tileY - pacman.tileY);
                    if (dx < 0.8 && dy < 0.8) {
                        // HIT!
                        gameState = STATE_FROZEN;
                        stateEndTime = now + 500; // Freeze for 500ms
                    }
                }
            }
            else if (gameState === STATE_FROZEN) {
                 // Just wait, then trigger death
                 if (now > stateEndTime) {
                     gameState = STATE_DYING;
                     stateEndTime = now + 1500; // Death animation duration
                     playDeathSound();
                 }
            }
            else if (gameState === STATE_DYING) {
                if (now > stateEndTime) {
                    if (gameLives > 1) {
                         gameLives--;
                         setLives(gameLives);
                         resetEntities();
                         gameState = STATE_READY;
                         stateEndTime = now + 2000;
                    } else {
                         gameLives = 0;
                         setLives(0);
                         gameState = STATE_GAMEOVER;
                         stateEndTime = now + 3000;
                    }
                }
            }
            else if (gameState === STATE_GAMEOVER) {
                if (now > stateEndTime) {
                    handleGameOver();
                    return;
                }
            }

            render();
            animationFrameId = requestAnimationFrame(loop);
            
        } catch (err) {
            console.error(err);
        }
    };

    // Input
    const handleKey = (e) => {
        // Allow input buffer only if playing or ready (classic buffering)
        // For simplicity, only allow if Playing
        if (gameState !== STATE_PLAY) return;

        if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if(e.key === 'ArrowUp') { pacman.nextDx=0; pacman.nextDy=-1; }
            if(e.key === 'ArrowDown') { pacman.nextDx=0; pacman.nextDy=1; }
            if(e.key === 'ArrowLeft') { pacman.nextDx=-1; pacman.nextDy=0; }
            if(e.key === 'ArrowRight') { pacman.nextDx=1; pacman.nextDy=0; }
        }
    };
    
    window.addEventListener('keydown', handleKey);
    loop();

    return () => {
        window.removeEventListener('keydown', handleKey);
        cancelAnimationFrame(animationFrameId);
    };
  }, [gameStarted]);

  // Intro Screen
  const GhostPreview = ({ color, name }) => (
    <div className="text-center">
      <svg width="40" height="44" viewBox="0 0 40 44" className="mx-auto mb-2">
        <path d="M5 22 Q5 5, 20 5 Q35 5, 35 22 L35 40 L30 35 L25 40 L20 35 L15 40 L10 35 L5 40 Z" fill={color} />
        <circle cx="14" cy="18" r="5" fill="white" />
        <circle cx="26" cy="18" r="5" fill="white" />
        <circle cx="15" cy="19" r="2.5" fill="#1e3a8a" />
        <circle cx="27" cy="19" r="2.5" fill="#1e3a8a" />
      </svg>
      <span className="text-sm" style={{ color }}>{name}</span>
    </div>
  );

  if (!gameStarted) {
    return (
      <div className="flex flex-col items-center justify-center mb-6 w-full">
        <div className="relative rounded-xl overflow-hidden shadow-2xl border-4 border-slate-700 bg-black p-8"
             style={{ width: '100%', maxWidth: '896px', height: '600px' }}>
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-yellow-400 mb-2"
                style={{ fontFamily: 'monospace', textShadow: '3px 3px 0 #0369a1' }}>
              DR. JIRA PAC-MAN
            </h1>
           
          </div>

          <div className="flex justify-center items-center space-x-8 mb-10">
            <div className="text-center">
              <div className="w-12 h-12 bg-yellow-400 rounded-full mx-auto mb-2 relative overflow-hidden">
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-t-[12px] border-b-[12px] border-l-[16px] border-t-transparent border-b-transparent border-l-black"></div>
              </div>
              <span className="text-yellow-400 text-sm font-bold">DR. JIRA</span>
            </div>
            <GhostPreview color="#ef4444" name="NADIA" />
            <GhostPreview color="#f472b6" name="MARWA" />
            <GhostPreview color="#22d3d3" name="AMARA" />
            <GhostPreview color="#fb923c" name="REYHAN" />
          </div>

          <div className="text-center">
            <button
              onClick={handleStartGame}
              className="px-8 py-4 bg-gradient-to-r from-yellow-400 to-yellow-500 text-black font-bold text-xl rounded-lg hover:from-yellow-300 hover:to-yellow-400 transition-all transform hover:scale-105 shadow-lg"
            >
              🎮 START GAME
            </button>
          </div>
          

          <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
            <p className="text-blue-400 text-lg">© DR. JIRA DICTATE 1986</p>
          </div>

          <div className="absolute bottom-4 right-4">
            <button
              onClick={() => setMusicEnabled(!musicEnabled)}
              className={`p-2 rounded-full transition-colors ${musicEnabled ? 'bg-green-600 hover:bg-green-500' : 'bg-slate-600 hover:bg-slate-500'}`}
            >
              {musicEnabled ? <Volume2 className="w-5 h-5 text-white" /> : <VolumeX className="w-5 h-5 text-white" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Game Screen
  return (
    <div ref={containerRef} tabIndex={0} className="flex flex-col items-center justify-center mb-6 w-full outline-none">
      <div className="relative rounded-xl overflow-hidden shadow-2xl border-4 border-slate-700 bg-black">
        <canvas ref={canvasRef} className="block" />
        <div className="absolute top-2 left-2 text-white/90 font-bold text-xs pointer-events-none font-mono tracking-widest">
            1UP <span className="text-yellow-400">{score.toString().padStart(6, '0')}</span> Lvl {level} Lives <span className="text-red-500">{lives}</span>
        </div>
        <div className="absolute top-2 right-2 text-white/50 font-bold text-xs pointer-events-none font-mono">
            HIGH SCORE <span className="text-white">{highScore.toString().padStart(6, '0')}</span>
        </div>
      </div>
      <div className="text-slate-400 text-xs mt-2 font-mono">
        Click here, then use Arrow Keys
      </div>
    </div>
  );
};

export default PacManGame;
