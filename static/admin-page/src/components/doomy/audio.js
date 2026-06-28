/**
 * Doomy Audio Module
 * Uses Web Audio API to procedurally synthesize classic 80s/90s shooter sound effects.
 * Complies with strict sandboxed iframe CSP (no external assets).
 */

let audioCtx = null;
let masterGain = null;
let isMuted = false;

function initAudio() {
  if (audioCtx) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(isMuted ? 0 : 0.4, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
  } catch (e) {
    console.error('Failed to initialize Web Audio context', e);
  }
}

export function setMute(mute) {
  isMuted = mute;
  if (masterGain && audioCtx) {
    masterGain.gain.setValueAtTime(mute ? 0 : 0.4, audioCtx.currentTime);
  }
}

export function getMuted() {
  return isMuted;
}

export function playSound(type) {
  initAudio();
  if (!audioCtx || isMuted) return;

  // Resume context if suspended (browser autoplay policy gate)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  try {
    switch (type) {
      case 'fist_miss': {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }
      case 'fist_hit': {
        // punching sound (noise + low pitch thump)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }
      case 'pistol': {
        // Pistol shot: short white noise + high frequency snap
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.15);

        // white noise burst
        playNoise(0.05, 0.4, 1000);
        break;
      }
      case 'shotgun': {
        // Heavy blast: lower pitch saw + longer white noise explosion
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(300, now);
        osc1.frequency.linearRampToValueAtTime(40, now + 0.3);
        osc2.frequency.setValueAtTime(120, now);
        osc2.frequency.linearRampToValueAtTime(20, now + 0.35);
        gain.gain.setValueAtTime(0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(masterGain);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + 0.35); osc2.stop(now + 0.35);

        playNoise(0.25, 0.6, 600);
        break;
      }
      case 'chaingun': {
        // Fast repeating pistol shots (slightly varied pitch)
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(500 + Math.random() * 80, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.1);

        playNoise(0.03, 0.3, 1200);
        break;
      }
      case 'enemy_alert': {
        // High to low frequency grunt
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.linearRampToValueAtTime(90, now + 0.3);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.3);
        break;
      }
      case 'enemy_pain': {
        // Brief high pitch squeal
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.linearRampToValueAtTime(300, now + 0.12);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }
      case 'enemy_death': {
        // Descending low growl
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.55);
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.55);

        playNoise(0.45, 0.25, 400);
        break;
      }
      case 'player_pain': {
        // Deep grunt
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(95, now);
        osc.frequency.linearRampToValueAtTime(45, now + 0.25);
        gain.gain.setValueAtTime(0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.25);
        break;
      }
      case 'door': {
        // Door rumble: long low-frequency sliding sound
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(65, now);
        osc.frequency.linearRampToValueAtTime(55, now + 0.6);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.6);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.6);
        break;
      }
      case 'pickup': {
        // High pitch chime
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }
    }
  } catch (e) {
    console.error('Sound play error', e);
  }
}

// Procedural white noise burst generator
function playNoise(duration, volume, cutoffFreq = 1000) {
  if (!audioCtx || isMuted) return;
  try {
    const now = audioCtx.currentTime;
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffFreq, now);
    
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    
    noise.start(now);
    noise.stop(now + duration);
  } catch (e) {
    console.error('White noise burst failed', e);
  }
}
