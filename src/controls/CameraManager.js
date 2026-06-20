import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { Easings } from '../utils/Easings.js';

const PRESETS = {

  1: { pos: [70, 60, 70],   target: [0, 0, 0] },     // overview
  2: { pos: [-10, 25, -10], target: [-50, 22, -50] }, // ferris wheel
  3: { pos: [15, 18, -15],  target: [40, 5, -40] },   // carousel
  4: { pos: [-25, 25, 15],   target: [52, 15, 54] },   // roller coaster (full loop view)
  5: { pos: [-15, 18, 15],  target: [-40, 0, 40] },   // tagada
  6: { pos: [0, 14, -58],   target: [0, 4, -88] },    // stage
};

const FLY_DURATION = 1.2;
const FPV_OFFSET = new THREE.Vector3(0, 1.5, 0);

export class CameraManager {
  constructor(camera, scene, controls, renderer, getRides, interactiveObjects = []) {
    this.camera = camera;
    this.scene = scene;
    this.controls = controls;
    this.renderer = renderer;
    this.getRides = getRides;
    this.interactiveObjects = interactiveObjects;
    this.state = 'orbit';
    this._flyFrom = new THREE.Vector3();
    this._flyTo = new THREE.Vector3();
    this._lookFrom = new THREE.Vector3();
    this._lookTo = new THREE.Vector3();
    this._flyTween = null;
    this._fpvTarget = null;
    this._fpvOffset = FPV_OFFSET.clone();
    this._fpvRide = null;
    this._preFpvPos = null;
    this._preFpvTarget = null;
    this._hiddenRiders = [];
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpVec = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpForward = new THREE.Vector3();
    this._clickStart = { x: 0, y: 0 };
    this._hasMoved = false;
    this._lastHoverTime = 0;
    this._hoverThrottleMs = 50;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerHover = this._onPointerHover.bind(this);
    this._bindEvents();
  }

  flyToPreset(index) {
    const preset = PRESETS[index];
    if (!preset) return;
    this._startFlight(
      this.camera.position.clone(),
      new THREE.Vector3(...preset.pos),
      this.controls.target.clone(),
      new THREE.Vector3(...preset.target)
    );
  }

  flyToWorldPoint(targetPos) {
    const fixedHeight = 12;
    const distance = 22;
    const dir = this.camera.position.clone().sub(targetPos);
    dir.y = 0;
    if (dir.lengthSq() < 0.0001) {
      dir.set(0, 0, 1);
    } else {
      dir.normalize();
    }
    const flyTo = targetPos.clone().add(dir.multiplyScalar(distance));
    flyTo.y = fixedHeight;
    this._startFlight(
      this.camera.position.clone(),
      flyTo,
      this.controls.target.clone(),
      targetPos.clone()
    );
  }

  flyToPosition(pos, targetLook, onComplete) {
    this._startFlight(
      this.camera.position.clone(),
      pos,
      this.controls.target.clone(),
      targetLook
    );
    if (onComplete) {
      setTimeout(onComplete, FLY_DURATION * 1000 + 50);
    }
  }

  enterFPV() {
    if (this.state === 'fpv') return;
    const rides = this.getRides();
    if (!rides || rides.length === 0) return;

    const referencePos = (this.state === 'flying') ? this._flyTo : this.camera.position;

    let closestRide = null;
    let closestDist = Infinity;
    for (const ride of rides) {
      ride.getWorldPosition(this._tmpVec);
      const dist = referencePos.distanceTo(this._tmpVec);
      if (dist < 80 && dist < closestDist) {
        closestDist = dist;
        closestRide = ride;
      }
    }
    if (!closestRide) return;

    const controller = closestRide.userData?.controller;
    if (!controller) return;

    const target = controller.getFpvTarget();
    if (!target) return;

    // Save camera position and target before entering FPV
    if (this.state === 'flying') {
      this._preFpvPos = this._flyTo.clone();
      this._preFpvTarget = this._lookTo.clone();
    } else {
      this._preFpvPos = this.camera.position.clone();
      this._preFpvTarget = this.controls.target.clone();
    }

    this._fpvTarget = target;
    this._fpvRide = closestRide;
    this._fpvOffset.copy(controller.getFpvOffset());

    // Hide riders of this ride to prevent clipping
    this._hiddenRiders = [];
    if (controller.getRiders) {
      const riders = controller.getRiders();
      if (riders && riders.length > 0) {
        for (const rider of riders) {
          if (rider && rider.pivot) {
            rider.pivot.visible = false;
            this._hiddenRiders.push(rider);
          }
        }
      }
    }

    this.state = 'fpv';
    this.controls.enabled = false;
  }

  enterFPVById(rideId) {
    const rides = this.getRides();
    if (!rides || rides.length === 0) return;

    const ride = rides.find(r => r.userData?.rideId === rideId);
    if (!ride) {
      console.warn('[CameraManager] No ride with id', rideId);
      return;
    }

    if (this.state === 'fpv' && this._fpvRide === ride) {
      this.exitFPV();
      return;
    }

    if (this.state === 'fpv') {
      this._cleanupFPV();
    }

    const controller = ride.userData?.controller;
    if (!controller) {
      console.warn('[CameraManager] Ride', rideId, 'has no controller');
      return;
    }

    const target = controller.getFpvTarget();
    if (!target) {
      console.warn('[CameraManager] Ride', rideId, 'has no FPV target');
      return;
    }

    // Save camera position and target so exitFPV() can fly back.
    if (this.state === 'flying') {
      this._preFpvPos = this._flyTo.clone();
      this._preFpvTarget = this._lookTo.clone();
    } else {
      this._preFpvPos = this.camera.position.clone();
      this._preFpvTarget = this.controls.target.clone();
    }

    this._fpvTarget = target;
    this._fpvRide = ride;
    this._fpvOffset.copy(controller.getFpvOffset());

    this._hiddenRiders = [];
    if (controller.getRiders) {
      const riders = controller.getRiders();
      if (riders && riders.length > 0) {
        for (const rider of riders) {
          if (rider && rider.pivot) {
            rider.pivot.visible = false;
            this._hiddenRiders.push(rider);
          }
        }
      }
    }

    this.state = 'fpv';
    this.controls.enabled = false;
  }

  exitFPV() {
    if (this.state !== 'fpv') return;

    const prePos = this._preFpvPos;
    const preTarget = this._preFpvTarget;

    this._preFpvPos = null;
    this._preFpvTarget = null;

    if (prePos && preTarget) {
      // Calculate current look direction of the camera to determine starting look target
      this._tmpQuat.copy(this.camera.quaternion);
      this._tmpForward.set(0, 0, -1).applyQuaternion(this._tmpQuat);
      const currentLookTarget = this.camera.position.clone().add(this._tmpForward.multiplyScalar(20));

      this._startFlight(
        this.camera.position.clone(),
        prePos,
        currentLookTarget,
        preTarget
      );
    } else {
      // Fallback
      this.state = 'orbit';
      if (this._fpvRide) {
        this._fpvRide.getWorldPosition(this._tmpVec);
        this.controls.target.copy(this._tmpVec);
      }
      this.controls.enabled = true;
      this._cleanupFPV();
    }
  }

  _cleanupFPV() {
    this._fpvTarget = null;
    this._fpvRide = null;
    if (this._hiddenRiders && this._hiddenRiders.length > 0) {
      for (const rider of this._hiddenRiders) {
        if (rider && rider.pivot) {
          rider.pivot.visible = true;
        }
      }
      this._hiddenRiders = [];
    }
    this.camera.up.set(0, 1, 0); // Restore default up vector
  }

  get isFPV() { return this.state === 'fpv'; }

  setInteractiveObjects(objects) {
    this.interactiveObjects = objects;
  }

  tick(delta) {
    if (this.state === 'flying') this._tickFlight(delta);
    else if (this.state === 'fpv') this._tickFPV();
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this._onPointerHover);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }

  /** Called when flight completes naturally (tween.onComplete). Snaps to destination. */
  _finishFlight() {
    if (this._flyTween) {
      this._flyTween.stop();
      this._flyTween = null;
    }

    this.camera.position.copy(this._flyTo);
    this.controls.target.copy(this._lookTo);
    this._flyProgress = null;

    if (this.controls._sphericalDelta) {
      this.controls._sphericalDelta.set(0, 0, 0);
    }
    if (this.controls._panOffset) {
      this.controls._panOffset.set(0, 0, 0);
    }

    this.controls.update();
    this.controls.saveState();

    this.camera.up.set(0, 1, 0); // Restore default up vector

    this.controls.enabled = true;
    this.state = 'orbit';
  }

  /**
   * Called when the user presses Escape during a flight. Freezes the camera at the
   * current interpolated pose instead of teleporting to the destination.
   */
  _cancelFlight() {
    if (this._flyTween) {
      this._flyTween.stop();
      this._flyTween = null;
    }
    // Camera already sits at the interpolated position (updated each frame by onUpdate).
    // Copy the current camera position into the orbit controls target so OrbitControls
    // resumes smoothly from here.
    if (this._flyProgress) {
      const t = this._flyProgress.t;
      this.controls.target.lerpVectors(this._lookFrom, this._lookTo, t);
    }
    this._flyProgress = null;

    if (this.controls._sphericalDelta) this.controls._sphericalDelta.set(0, 0, 0);
    if (this.controls._panOffset) this.controls._panOffset.set(0, 0, 0);

    this.controls.update();
    this.controls.saveState();
    this.camera.up.set(0, 1, 0);
    this.controls.enabled = true;
    this.state = 'orbit';
  }

  _startFlight(fromPos, toPos, fromLook, toLook) {
    if (this._flyTween) {
      this._flyTween.stop();
      this._flyTween = null;
    }

    this.state = 'flying';
    this.controls.enabled = false;
    this._cleanupFPV();

    if (this.controls._sphericalDelta) {
      this.controls._sphericalDelta.set(0, 0, 0);
    }
    if (this.controls._panOffset) {
      this.controls._panOffset.set(0, 0, 0);
    }

    this._flyFrom.copy(fromPos);
    this._flyTo.copy(toPos);
    this._lookFrom.copy(fromLook);
    this._lookTo.copy(toLook);

    this._flyProgress = { t: 0 };
    this._flyTween = new TWEEN.Tween(this._flyProgress)
      .to({ t: 1 }, FLY_DURATION * 1000)
      .easing(Easings.FLY)
      .onUpdate(() => {
        const t = this._flyProgress.t;
        this.camera.position.lerpVectors(this._flyFrom, this._flyTo, t);
        this.controls.target.lerpVectors(this._lookFrom, this._lookTo, t);
        this.camera.lookAt(this.controls.target);
      })
      .onComplete(() => this._finishFlight())
      .start();
  }

  _tickFlight(delta) {
    // TWEEN.update() in App.js drives the tween; this method keeps the tick branch alive.
    if (this.state === 'flying' && !this._flyTween) {
      this._finishFlight();
    }
  }

  _tickFPV() {
    if (!this._fpvRide || !this._fpvTarget) { this.exitFPV(); return; }

    const controller = this._fpvRide.userData?.controller;
    if (!controller) { this.exitFPV(); return; }

    if (controller.getFpvCameraPos) {
      controller.getFpvCameraPos(this._fpvTarget, this.camera.position);
    } else {
      this._fpvTarget.getWorldPosition(this._tmpVec);
      this.camera.position.copy(this._tmpVec).add(this._fpvOffset);
    }

    if (controller.getFpvUp) {
      controller.getFpvUp(this._fpvTarget, this.camera.up);
    } else {
      this.camera.up.set(0, 1, 0);
    }

    if (controller.getFpvLookTarget) {
      controller.getFpvLookTarget(this._fpvTarget, this._lookTo);
      this.camera.lookAt(this._lookTo);
    } else {
      this._fpvTarget.getWorldPosition(this._tmpVec);
      this._fpvTarget.getWorldQuaternion(this._tmpQuat);
      this._tmpForward.set(0, 0, -1).applyQuaternion(this._tmpQuat);
      this._lookTo.copy(this._tmpVec).add(this._tmpForward);
      this.camera.lookAt(this._lookTo);
    }
  }

  _onKeyDown(ev) {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;
    const key = ev.key;
    if (key >= '1' && key <= '6') {
      this.flyToPreset(parseInt(key));
    } else if (key === 'Escape') {
      if (this.state === 'fpv') this.exitFPV();
      else if (this.state === 'flying') this._cancelFlight();
    }
  }

  _onPointerDown(ev) {
    if (ev.button !== 0 || this.state !== 'orbit') return;
    if (document.pointerLockElement) return;
    if (ev.target !== this.renderer.domElement) return;
    this._clickStart.x = ev.clientX;
    this._clickStart.y = ev.clientY;
    this._hasMoved = false;
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _onPointerMove(ev) {
    const dx = Math.abs(ev.clientX - this._clickStart.x);
    const dy = Math.abs(ev.clientY - this._clickStart.y);
    if (dx > 5 || dy > 5) {
      this._hasMoved = true;
    }
  }

  _onPointerUp(ev) {
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);

    if (ev.button !== 0 || this.state !== 'orbit') return;
    if (this._hasMoved) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(this._ndc, this.camera);

    // Overriding click-to-fly when clicking interactive objects (control panel, lamppost)
    const intersects = this._ray.intersectObjects(this.interactiveObjects, true);
    let hitInteractive = false;
    for (const hit of intersects) {
      let obj = hit.object;
      while (obj) {
        if (obj.name === 'controlPanel' || obj.userData.lampId) {
          hitInteractive = true;
          break;
        }
        obj = obj.parent;
      }
      if (hitInteractive) break;
    }
    if (hitInteractive) return;

    const hit = new THREE.Vector3();
    if (this._ray.ray.intersectPlane(this._groundPlane, hit)) {
      hit.x = THREE.MathUtils.clamp(hit.x, -95, 95);
      hit.z = THREE.MathUtils.clamp(hit.z, -95, 95);
      this.flyToWorldPoint(hit);
    }
  }

  _onPointerHover(ev) {
    if (this.state !== 'orbit') return;
    const now = Date.now();
    if (now - this._lastHoverTime < this._hoverThrottleMs) return;
    this._lastHoverTime = now;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    const intersects = this._ray.intersectObjects(this.interactiveObjects, true);
    
    let hitInteractive = false;
    for (const hit of intersects) {
      let obj = hit.object;
      while (obj) {
        if (obj.name === 'controlPanel' || obj.userData.lampId) {
          hitInteractive = true;
          break;
        }
        obj = obj.parent;
      }
      if (hitInteractive) break;
    }

    if (hitInteractive) {
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      if (this.renderer.domElement.style.cursor === 'pointer') {
        this.renderer.domElement.style.cursor = '';
      }
    }
  }

  _bindEvents() {
    window.addEventListener('keydown', this._onKeyDown);
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerHover);
  }
}
