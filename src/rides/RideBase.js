import { eventBus } from '../utils/EventBus.js';

/**
 * Standard base class for managing ride state, panel coordination, night lighting,
 * and bloom layers.
 */
export class RideBase {
  constructor(group, config = {}) {
    this.group = group;
    this.running = config.running !== false;
    this.speedMultiplier = config.speedMultiplier !== undefined ? config.speedMultiplier : 1.0;
    this.nightMix = 0.0;
    this.panel = null;
  }

  toggle() {
    this.running = !this.running;
    if (this.panel && typeof this.panel.updateState === 'function') {
      this.panel.updateState(this.running);
    }
  }

  start() {
    this.running = true;
    if (this.panel && typeof this.panel.updateState === 'function') {
      this.panel.updateState(true);
    }
  }

  stop() {
    this.running = false;
    if (this.panel && typeof this.panel.updateState === 'function') {
      this.panel.updateState(false);
    }
  }

  setSpeed(val) {
    this.speedMultiplier = val;
  }

  /**
   * Calls controlPanel.tick() and returns a {ease, speedMult} object for use in
   * the ride's per-frame tick closure. Also resets speedMultiplier to 1.0 when
   * the ride comes to a full stop (ease === 0) so the next start feels consistent.
   *
   * @param {object} controlPanel - the ride's ControlPanel instance
   * @param {number} delta        - frame delta time in seconds
   * @returns {{ ease: number, speedMult: number }}
   */
  tickSpeed(controlPanel, delta) {
    const ease = controlPanel.tick(delta, this.speedMultiplier);
    const speedMult = this.speedMultiplier !== undefined ? this.speedMultiplier : 1.0;
    return { ease, speedMult };
  }

  /**
   * Registers a DOM event listener. Convenience wrapper for document.addEventListener.
   */
  addEventListener(target, type, listener, options) {
    target.addEventListener(type, listener, options);
  }

  /**
   * Registers an EventBus listener.
   */
  addEventBusListener(event, callback) {
    eventBus.on(event, callback);
  }

  /**
   * No-op retained for call-site compatibility.
   */
  trackTween(tween) {
    return tween;
  }

  /**
   * Traverses meshes (excluding ControlPanel) and applies layers.enable(2).
   */
  applyBloomLayers() {
    if (!this.group) return;
    this.group.traverse((node) => {
      if (node.isMesh) {
        // Exclude control panel meshes
        let isPanel = false;
        let p = node;
        while (p) {
          if (p.name && (p.name.toLowerCase().includes('panel') || p.name.toLowerCase().includes('control_panel'))) {
            isPanel = true;
            break;
          }
          p = p.parent;
        }
        if (!isPanel) {
          node.layers.enable(2);
        }
      }
    });
  }

}
