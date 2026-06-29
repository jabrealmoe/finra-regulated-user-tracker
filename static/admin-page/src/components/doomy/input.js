/**
 * Doomy Input Module
 * Listens for keyboard presses and handles Pointer Lock API mouse movements
 * for first-person turning and strafing.
 */

export class InputHandler {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.keys = {};
    this.mouseMoveX = 0;
    this.mouseClicked = false;
    this.useDoorTriggered = false;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);

    this.setupListeners();
  }

  setupListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // Click canvas to request pointer lock
    this.canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    });
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  onKeyDown(e) {
    this.keys[e.key.toLowerCase()] = true;
    this.keys[e.code] = true; // backups for arrows

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      this.mouseClicked = true;
    }
    if (e.key.toLowerCase() === 'e') {
      this.useDoorTriggered = true;
    }
  }

  onKeyUp(e) {
    this.keys[e.key.toLowerCase()] = false;
    this.keys[e.code] = false;
  }

  onMouseMove(e) {
    if (document.pointerLockElement === this.canvas) {
      // accumulate horizontal mouse delta
      this.mouseMoveX += e.movementX;
    }
  }

  onMouseDown(e) {
    if (document.pointerLockElement === this.canvas) {
      if (e.button === 0) {
        this.mouseClicked = true;
      }
    }
  }

  onPointerLockChange() {
    if (document.pointerLockElement !== this.canvas) {
      // Clear keys on lock release to prevent player drifting
      this.keys = {};
    }
  }

  // Poll and consume mouse delta
  getMouseRotation() {
    const rot = this.mouseMoveX;
    this.mouseMoveX = 0;
    return rot;
  }

  // Consume fire click state
  consumeFire() {
    const clicked = this.mouseClicked;
    this.mouseClicked = false;
    return clicked;
  }

  // Consume E/Interact press
  consumeUse() {
    const used = this.useDoorTriggered;
    this.useDoorTriggered = false;
    return used;
  }
}
