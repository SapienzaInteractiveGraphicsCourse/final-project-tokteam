import * as THREE from 'three';
import { eventBus } from '../utils/EventBus.js';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { makeRider, updateRider, pose } from '../people/Passengers.js';
import { RideBase } from './RideBase.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { nightMixLerp } from '../utils/rideUtils.js';

class ShootingGalleryController extends RideBase {
  constructor(group, config) {
    super(group, { running: true });

    this.camera = config.camera;
    this.renderer = config.renderer;
    this.controls = config.controls;
    this.boothModel = config.boothModel;
    this.targets = config.targets;
    this.galleryLights = config.galleryLights;
    this.ambientLights = config.ambientLights;
    this.fpsGun = config.fpsGun;
    this.operator = config.operator;
    this.cowboyWrapper = config.cowboyWrapper;
    this.bulletGltf = config.bulletGltf;
    this.muzzleLight = config.muzzleLight;

    // Game state
    this.score = 0;
    this.timer = 30;
    this.aimMode = false;
    this.isTransitioning = false;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.preAimPos = null;
    this.preAimTarget = null;
    this.centerYaw = undefined;

    // Effects
    this.activeBullets = [];
    this.activeParticles = [];
    this.cameraShake = new THREE.Vector3();
    this.recoilX = 0;
    this.recoilY = 0;
    this.recoilTimer = 0;
    this.muzzleFlashIntensity = 0;
    this.particleGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
    this.shockwaveGeo = new THREE.SphereGeometry(0.1, 12, 12);

    // UI elements
    this.scoreEl = document.getElementById('shootScore');
    this.timerEl = document.getElementById('shootTimer');
    this.crosshairEl = document.getElementById('crosshair');

    // Raycast helpers
    this.raycaster = new THREE.Raycaster();
    this._shootDir = new THREE.Vector3();

    // Pre-allocated temps to avoid per-frame GC pressure
    this._muzzleOffset = new THREE.Vector3(0.18, 0.13, 0);
    this._muzzlePos    = new THREE.Vector3();
    this._camLocalPos  = new THREE.Vector3(0, 2.7, 5.5);

    // Bind event handlers to this
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    // Register event listeners using RideBase helper
    this.addEventListener(document, 'pointerlockchange', this.onPointerLockChange);
    this.addEventListener(document, 'mousemove', this.onMouseMove);
    this.addEventListener(document, 'mousedown', this.onClick);
    this.addEventListener(document, 'keydown', this.onKeyDown);
  }

  // FPV getters
  getFpvCameraPos(target, out) {
    const camPos = new THREE.Vector3(0, 2.7, 5.5);
    this.group.localToWorld(camPos);
    out.copy(camPos);
  }

  getFpvLookTarget(target, out) {
    const lookPos = new THREE.Vector3(0, 1.3, -2.0);
    this.group.localToWorld(lookPos);
    out.copy(lookPos);
  }

  getFpvUp(target, out) {
    out.set(0, 1, 0);
  }

  getFpvOffset() {
    return new THREE.Vector3(0, 0, 0);
  }

  getRiders() {
    return [];
  }

  getFpvTarget() {
    return this.fpsGun || null;
  }

  enterAimMode() {
    if (this.aimMode || this.isTransitioning) return;
    this.isTransitioning = true;
    this.preAimPos = this.camera.position.clone();
    this.preAimTarget = this.controls ? this.controls.target.clone() : new THREE.Vector3();

    // Position camera above the gun barrel, slightly tilted down
    const camPos = new THREE.Vector3(0, 2.7, 5.5);
    this.group.localToWorld(camPos);
    const lookPos = new THREE.Vector3(0, 1.3, -2.0);
    this.group.localToWorld(lookPos);

    if (window.__lp && window.__lp.cameraManager) {
      window.__lp.cameraManager.flyToPosition(camPos, lookPos, () => {
        this.isTransitioning = false;
        this._startAiming();
      });
    } else {
      this.isTransitioning = false;
      this.camera.position.copy(camPos);
      this.camera.lookAt(lookPos);
      this._startAiming();
    }
  }

  _startAiming() {
    if (document.pointerLockElement === this.renderer.domElement) return;
    this.aimMode = true;
    this.score = 0;
    this.timer = 30;

    // Reset targets
    for (const t of this.targets) {
      t.hit = false;
      t.hitTime = 0;
      t.omega = 0;
      t.group.rotation.x = 0;
      for (const m of t.meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mat => {
          if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0;
        });
      }
    }

    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.aimYaw = euler.y;
    this.aimPitch = euler.x;
    this.centerYaw = this.aimYaw;

    // Hide cowboy, show FPS gun
    if (this.cowboyWrapper) this.cowboyWrapper.visible = false;
    if (this.fpsGun) {
      this.fpsGun.visible = true;
      // Reset rotation to face targets
      this.fpsGun.rotation.set(0, Math.PI, 0);
    }

    if (this.scoreEl) this.scoreEl.style.display = 'block';
    if (this.timerEl) this.timerEl.style.display = 'block';
    if (this.crosshairEl) this.crosshairEl.style.display = 'block';

    if (this.controls) this.controls.enabled = false;
    this.renderer.domElement.requestPointerLock();
  }

  exitAimMode() {
    if (!this.aimMode) return;
    this.aimMode = false;
    this.isTransitioning = false;

    // Clean up active bullets
    for (const b of this.activeBullets) {
      this.group.remove(b.mesh);
    }
    this.activeBullets.length = 0;

    // Clean up active particles
    for (const p of this.activeParticles) {
      this.group.remove(p.mesh);
    }
    this.activeParticles.length = 0;

    // Show cowboy, hide FPS gun
    if (this.cowboyWrapper) this.cowboyWrapper.visible = true;
    if (this.fpsGun) this.fpsGun.visible = false;

    // Reset muzzle light
    if (this.muzzleLight) this.muzzleLight.intensity = 0.0;

    // Release pointer lock
    document.exitPointerLock();

    // Hide UI
    if (this.scoreEl) this.scoreEl.style.display = 'none';
    if (this.timerEl) this.timerEl.style.display = 'none';
    if (this.crosshairEl) this.crosshairEl.style.display = 'none';

    // Restore controls
    if (this.controls) this.controls.enabled = true;

    // Fly back
    if (window.__lp && window.__lp.cameraManager && this.preAimPos && this.preAimTarget) {
      window.__lp.cameraManager.flyToPosition(this.preAimPos, this.preAimTarget);
    }
  }

  onPointerLockChange() {
    if (document.pointerLockElement !== this.renderer.domElement && this.aimMode) {
      this.exitAimMode();
    }
  }

  onMouseMove(e) {
    if (!this.aimMode) return;
    const sensitivity = 0.0025;
    this.aimYaw -= e.movementX * sensitivity;
    this.aimPitch -= e.movementY * sensitivity;

    // Clamp pitch (vertical rotation)
    this.aimPitch = Math.max(-0.2, Math.min(0.25, this.aimPitch));

    // Clamp yaw (horizontal rotation) relative to gallery center direction
    const centerYaw = this.centerYaw !== undefined ? this.centerYaw : (this.group.rotation.y + Math.PI);
    let diffYaw = this.aimYaw - centerYaw;
    diffYaw = Math.atan2(Math.sin(diffYaw), Math.cos(diffYaw));
    diffYaw = Math.max(-0.55, Math.min(0.55, diffYaw));
    this.aimYaw = centerYaw + diffYaw;
  }

  onClick(e) {
    if (!this.aimMode || e.button !== 0) return;

    // Recoil and muzzle flash parameters
    this.recoilX = 0.22;
    this.recoilY = (Math.random() - 0.5) * 0.08;
    this.recoilTimer = 0.12;
    this.muzzleFlashIntensity = 12.0;

    // Trigger visual muzzle flash visibility directly for instant feedback
    if (this.fpsGun && this.fpsGun.userData.flashGroup) {
      this.fpsGun.userData.flashGroup.visible = true;
      if (this.fpsGun.userData.flashMat) this.fpsGun.userData.flashMat.opacity = 1.0;
      this.fpsGun.userData.flashGroup.scale.setScalar(1.5 + Math.random() * 0.8); // Dynamic burst size
      if (this.fpsGun.userData.flashSprite) this.fpsGun.userData.flashSprite.material.rotation = Math.random() * Math.PI;
    }

    this.cameraShake.set(
      (Math.random() - 0.5) * 0.06,
      (Math.random() * 0.03 + 0.03), // recoil kick upwards
      (Math.random() - 0.5) * 0.06
    );

    // Locate gun muzzle position in local coordinates of group
    const muzzleLocalInGroup = new THREE.Vector3();
    if (this.aimMode && this.fpsGun) {
      // Get the muzzle's local position in fpsGunModel's space, then transform to group space
      const tempMuzzle = new THREE.Vector3(0.18, 0.13, 0);
      if (this.fpsGun.children[0]) {
        this.fpsGun.children[0].updateMatrix();
        tempMuzzle.applyMatrix4(this.fpsGun.children[0].matrix);
      }
      this.fpsGun.updateMatrix();
      tempMuzzle.applyMatrix4(this.fpsGun.matrix);
      muzzleLocalInGroup.copy(tempMuzzle);
    } else {
      const tempWorld = this.camera.position.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), 0.5);
      muzzleLocalInGroup.copy(tempWorld);
      this.group.worldToLocal(muzzleLocalInGroup);
    }

    // Raycast from camera center to find target impact point
    this._shootDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(this.camera.position, this._shootDir);

    const targetMeshes = [];
    for (const t of this.targets) {
      if (!t.hit) {
        for (const m of t.meshes) targetMeshes.push(m);
      }
    }

    const intersectObjects = [...targetMeshes];
    if (this.boothModel) {
      intersectObjects.push(this.boothModel);
    }

    const hits = this.raycaster.intersectObjects(intersectObjects, true);
    const impactPointLocal = new THREE.Vector3();
    let hitObject = null;

    if (hits.length > 0) {
      impactPointLocal.copy(hits[0].point);
      this.group.worldToLocal(impactPointLocal);
      hitObject = hits[0].object;
    } else {
      // Default fallback plane
      impactPointLocal.set(0, 1.8, -2.0);
    }

    // Spawn visible glowing tracer mesh (elongated cylinder)
    const tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8); // 2.5m long thick tracer
    tracerGeo.rotateX(Math.PI / 2);
    tracerGeo.translate(0, 0, 1.25);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    let tracer = new THREE.Mesh(tracerGeo, tracerMat);

    // Glow halo
    const glowGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8);
    glowGeo.rotateX(Math.PI / 2);
    glowGeo.translate(0, 0, 1.25);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    tracer.add(new THREE.Mesh(glowGeo, glowMat));

    // Add original bullet model at the tip of the tracer
    if (this.bulletGltf) {
      const model = this.bulletGltf.scene.clone();
      sanitizeMaterials(model);
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          o.material = new THREE.MeshBasicMaterial({ color: 0xffeedd });
        }
      });
      model.scale.setScalar(0.015);
      model.rotation.y = Math.PI / 2;
      model.position.z = 2.5;
      tracer.add(model);
    }

    tracer.position.copy(muzzleLocalInGroup);
    this.group.add(tracer);

    // Store bullet
    const speed = 70.0;
    const velocity = new THREE.Vector3().subVectors(impactPointLocal, muzzleLocalInGroup).normalize().multiplyScalar(speed);
    const distanceToTarget = muzzleLocalInGroup.distanceTo(impactPointLocal);

    this.activeBullets.push({
      mesh: tracer,
      startPos: muzzleLocalInGroup.clone(),
      endPos: impactPointLocal.clone(),
      velocity,
      distanceTravelled: 0,
      totalDistance: distanceToTarget,
      hitObject
    });
  }

  handleBulletImpact(bullet) {
    const impactPoint = bullet.endPos;
    const hitObject = bullet.hitObject;

    // Intense Flash core for shockwave
    const sMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sMesh = new THREE.Mesh(this.shockwaveGeo, sMat);
    sMesh.position.copy(impactPoint);
    this.group.add(sMesh);

    // Outer glow halo
    const gMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const gMesh = new THREE.Mesh(this.shockwaveGeo, gMat);
    sMesh.add(gMesh);

    this.activeParticles.push({
      mesh: sMesh,
      mat: sMat,
      gMat: gMat,
      type: 'shockwave',
      age: 0,
      lifetime: 0.2
    });

    // High-energy Spark splash streaks
    const particleCount = 35;
    const colors = [0xffdd44, 0xff8800, 0xff2200, 0xffffff];
    for (let i = 0; i < particleCount; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const pGeo = new THREE.BoxGeometry(0.015, 0.015, 0.15 + Math.random() * 0.3);
      const pMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.copy(impactPoint);

      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize();

      pMesh.lookAt(pMesh.position.clone().add(dir));

      const speed = 5.0 + Math.random() * 10.0;
      const vel = dir.multiplyScalar(speed);
      vel.y += 2.0;

      this.group.add(pMesh);

      this.activeParticles.push({
        mesh: pMesh,
        mat: pMat,
        velocity: vel,
        type: 'spark',
        age: 0,
        lifetime: 0.15 + Math.random() * 0.25
      });
    }

    // Check hit target
    if (hitObject) {
      for (const t of this.targets) {
        if (t.meshes.includes(hitObject)) {
          const meshIdx = t.meshes.indexOf(hitObject);
          const points = t.points[meshIdx] * t.multiplier;
          this.score += points;
          t.hit = true;
          t.hitTime = performance.now() / 1000;
          t.omega = -45.0;

          // Flash target
          const mats = Array.isArray(hitObject.material) ? hitObject.material : [hitObject.material];
          mats.forEach(mat => {
            if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 8.0;
          });

          // Camera hit punch
          this.cameraShake.set(
            (Math.random() - 0.5) * 0.12,
            (Math.random() - 0.5) * 0.12,
            (Math.random() - 0.5) * 0.12
          );
          break;
        }
      }
    }
  }

  onKeyDown(e) {
    if (e.code === 'Escape' && this.aimMode) {
      this.exitAimMode();
    }
  }

  tick(delta, time) {
    const dt = Math.min(delta, 0.05);

    // Gradual start/stop transitions driven by the shared ControlPanel
    const ease = 1.0;

    // 1. Muzzle light & recoil updates
    if (this.aimMode) {
      this.muzzleFlashIntensity = Math.max(0, this.muzzleFlashIntensity - dt * 65);
      if (this.muzzleLight) {
        this.muzzleLight.intensity = this.muzzleFlashIntensity;
        if (this.fpsGun) {
          this._muzzlePos.copy(this._muzzleOffset);
          if (this.fpsGun.children[0]) {
            this.fpsGun.children[0].updateMatrix();
            this._muzzlePos.applyMatrix4(this.fpsGun.children[0].matrix);
          }
          this.fpsGun.updateMatrix();
          this._muzzlePos.applyMatrix4(this.fpsGun.matrix);
          this.muzzleLight.position.copy(this._muzzlePos);
        } else if (this.operator) {
          const gunModel = this.operator.fig.getObjectByName('Sketchfab_Scene');
          if (gunModel) {
            this._muzzlePos.copy(this._muzzleOffset);
            gunModel.localToWorld(this._muzzlePos);
            this.group.worldToLocal(this._muzzlePos);
            this.muzzleLight.position.copy(this._muzzlePos);
          }
        }
      }

      // Update visual muzzle flash scale and opacity on the FPS gun
      if (this.fpsGun && this.fpsGun.userData.flashGroup) {
        const scale = 1.0 + (this.muzzleFlashIntensity / 12.0) * 1.5;
        const opacity = this.muzzleFlashIntensity / 12.0;
        this.fpsGun.userData.flashGroup.visible = (this.muzzleFlashIntensity > 0.01);
        this.fpsGun.userData.flashGroup.scale.setScalar(scale);
        if (this.fpsGun.userData.flashMat) this.fpsGun.userData.flashMat.opacity = opacity;
      }

      this.cameraShake.multiplyScalar(Math.max(0, 1 - dt * 10));

      if (this.recoilTimer > 0) {
        this.recoilTimer -= dt;
      } else {
        this.recoilX = THREE.MathUtils.lerp(this.recoilX, 0, dt * 8);
        this.recoilY = THREE.MathUtils.lerp(this.recoilY, 0, dt * 8);
      }
    }

    // 2. Update Bullets
    for (let i = this.activeBullets.length - 1; i >= 0; i--) {
      const b = this.activeBullets[i];
      b.distanceTravelled += b.velocity.length() * dt;
      b.mesh.position.addScaledVector(b.velocity, dt);

      // Rotate tracer to face flight direction
      const lookAtTargetLocal = b.mesh.position.clone().add(b.velocity);
      const lookAtTargetWorld = lookAtTargetLocal.clone();
      this.group.localToWorld(lookAtTargetWorld);
      b.mesh.lookAt(lookAtTargetWorld);

      if (b.distanceTravelled >= b.totalDistance) {
        this.handleBulletImpact(b);
        this.group.remove(b.mesh);
        this.activeBullets.splice(i, 1);
      }
    }

    // 3. Update Particles
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.age += dt;
      if (p.age >= p.lifetime) {
        this.group.remove(p.mesh);
        this.activeParticles.splice(i, 1);
      } else {
        const progress = p.age / p.lifetime;
        if (p.type === 'shockwave') {
          p.mesh.scale.setScalar(0.1 + progress * 6.0);
          p.mat.opacity = 1.0 - Math.pow(progress, 2);
          if (p.gMat) {
            p.gMat.opacity = 0.8 * (1.0 - progress);
          }
        } else {
          p.mesh.position.addScaledVector(p.velocity, dt);
          p.mat.opacity = 1.0 - progress;
          p.mesh.scale.setScalar(1.0 - progress * 0.8);
        }
      }
    }

    // 4. Operator animation
    if (this.operator) {
      updateRider(this.operator, time);
      const B = this.operator.bones;
      if (B && B.UpperArmR && B.LowerArmR && B.Torso && B.Head) {
        const cycle = time * 0.7 + this.operator.phase;
        const sweep = Math.sin(cycle);
        pose(B, 'Torso', 0.15 + Math.sin(time * 2.0) * 0.02, 0.35 + sweep * 0.15, 0);
        pose(B, 'Head', 0.1, -0.3, 0);
        pose(B, 'UpperArmR', 0.1 + Math.sin(time * 4.0) * 0.02, 1.45 + sweep * 0.05, -0.15);
        pose(B, 'LowerArmR', 0.2, 0, 0);

        if (B.UpperArmL && B.LowerArmL) {
          pose(B, 'UpperArmL', 0.2, -0.3, 0.3);
          pose(B, 'LowerArmL', 1.1, 0, 0);
        }
      }
    }

    // Day/Night and light pulsing
    const isNight = isNightNow(this.group);
    this.nightMix = nightMixLerp(this.nightMix, isNight, delta, 2.2);

    // 5. Animate gallery lights – gentle pulsing (affected by nightMix)
    for (const gl of this.galleryLights) {
      const pulse = 1.0 + 0.18 * Math.sin(time * 2.5 + gl.phase);
      if (gl.mesh && gl.mesh.material) {
        gl.mesh.material.emissiveIntensity = gl.baseIntensity * pulse * this.nightMix;
      }
      if (gl.light) {
        gl.light.intensity = gl.baseIntensity * pulse * this.nightMix;
      }
    }

    // Ambient lights update with nightMix
    if (this.ambientLights) {
      for (const light of this.ambientLights) {
        light.intensity = light.baseIntensity * this.nightMix;
      }
    }

    // 6. Update target movement and animations
    const bound = 2.8;

    for (const t of this.targets) {
      // Speed multiplier and ease applied to target speeds
      t.group.position.x += t.speed * dt * t.direction * ease * this.speedMultiplier;
      let wrapped = false;
      if (t.direction > 0 && t.group.position.x > bound) {
        t.group.position.x = -bound;
        wrapped = true;
      } else if (t.direction < 0 && t.group.position.x < -bound) {
        t.group.position.x = bound;
        wrapped = true;
      }
      if (wrapped) {
        t.hit = false;
        t.hitTime = 0;
        t.omega = 0;
        t.group.rotation.x = 0;
        for (const m of t.meshes) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mat => {
            if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0;
          });
        }
      }

      if (t.hit) {
        const substeps = 4;
        const subDt = dt / substeps;
        const g = 15.0;
        const damping = 2.0;

        for (let step = 0; step < substeps; step++) {
          const theta = t.group.rotation.x;
          const alpha = -g * Math.sin(theta) - damping * t.omega;
          t.omega += alpha * subDt;
          t.group.rotation.x += t.omega * subDt;
        }

        const elapsed = (performance.now() / 1000) - t.hitTime;
        for (const m of t.meshes) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mat => {
            if (mat && 'emissiveIntensity' in mat) {
              mat.emissiveIntensity = Math.max(0, 8.0 - elapsed * 25);
            }
          });
        }

        const angleFromUpright = Math.abs(Math.atan2(Math.sin(t.group.rotation.x), Math.cos(t.group.rotation.x)));
        if (Math.abs(t.omega) < 0.2 && angleFromUpright < 0.05) {
          t.hit = false;
          t.hitTime = 0;
          t.omega = 0;
          t.group.rotation.x = 0;
          for (const m of t.meshes) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach(mat => {
              if (mat && 'emissiveIntensity' in mat) mat.emissiveIntensity = 0;
            });
          }
        }
      }
    }

    if (!this.aimMode) return;

    // Update timer
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
      this.exitAimMode();
      return;
    }

    // 7. Update FPS gun rotation to follow aim direction
    if (this.fpsGun) {
      const baseYaw = Math.PI;
      const relYaw = this.aimYaw - this.centerYaw;
      this.fpsGun.rotation.set(-this.aimPitch, baseYaw + relYaw, 0, 'YXZ');
      this.fpsGun.rotation.x += this.recoilX;
    }

    // 8. Update camera position: above the gun barrel, slightly tilted down
    this._camLocalPos.set(0, 2.7, 5.5);
    this.group.localToWorld(this._camLocalPos);
    this._camLocalPos.add(this.cameraShake);
    this.camera.position.copy(this._camLocalPos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.aimPitch, this.aimYaw, 0, 'YXZ'));

    // Update UI
    if (this.scoreEl) this.scoreEl.textContent = `Score: ${this.score}`;
    if (this.timerEl) this.timerEl.textContent = `Time: ${Math.ceil(this.timer)}s`;
  }


}

export async function buildShootingGallery({ camera, renderer, controls }) {
  const group = new THREE.Group();
  group.name = 'shootingGallery';

  // ── Load prize and character models asynchronously ──
  let duckGltf, bearGltf, bunnyGltf, rabbitGltf, workerGltf, gunGltf, bulletGltf;
  try {
    [duckGltf, bearGltf, bunnyGltf, rabbitGltf, workerGltf, gunGltf, bulletGltf] = await Promise.all([
      loadGLB('assets/models/prizes/duck_plush.glb'),
      loadGLB('assets/models/prizes/low_poly_asset_teddy_bear.glb'),
      loadGLB('assets/models/prizes/low_poly_bunny_plush_toy.glb'),
      loadGLB('assets/models/prizes/rabbit_plush__conejo_peluche.glb'),
      loadGLB('assets/models/people/Cowboy_Male.gltf'),
      loadGLB('assets/models/9mm_pistol_low_poly_gun.glb'),
      loadGLB('assets/models/9mm_bullet_low_poly.glb')
    ]);
  } catch (err) {
    console.warn("Failed to load models", err);
  }

  // ── Helper to create customized prize versions ──
  function createPrize(type, { tint, scale = 1.0, position, rotation }) {
    let baseScene;
    if (type === 'duck') baseScene = duckGltf?.scene;
    else if (type === 'bear') baseScene = bearGltf?.scene;
    else if (type === 'bunny') baseScene = bunnyGltf?.scene;
    else if (type === 'rabbit') baseScene = rabbitGltf?.scene;

    if (!baseScene) return null;

    const clone = baseScene.clone();

    clone.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) {
          o.material = o.material.map(m => m.clone());
        } else {
          o.material = o.material.clone();
        }
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    const bbox = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const rawHeight = size.y;

    const targetHeight = 0.8;
    const baseScale = rawHeight > 0 ? targetHeight / rawHeight : 1.0;

    const center = new THREE.Vector3();
    bbox.getCenter(center);

    const wrapper = new THREE.Group();
    wrapper.add(clone);

    clone.scale.setScalar(baseScale);
    clone.position.set(-center.x * baseScale, -bbox.min.y * baseScale, -center.z * baseScale);

    wrapper.scale.setScalar(scale);
    if (position) wrapper.position.fromArray(position);
    if (rotation) wrapper.rotation.fromArray(rotation);

    if (tint) {
      const colors = {
        red: 0xdd3b3b,
        blue: 0x3b6ddd,
        yellow: 0xddb63b
      };
      const tintColor = new THREE.Color(colors[tint] || tint);
      wrapper.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((mat) => {
            const name = (mat.name || '').toLowerCase();
            if (name.includes('eye') || name.includes('nose') || name.includes('teeth') || name.includes('blush')) {
              return;
            }
            if (mat.color.r < 0.05 && mat.color.g < 0.05 && mat.color.b < 0.05) {
              return;
            }
            mat.color.copy(tintColor);
          });
        }
      });
    }

    return wrapper;
  }

  function createHangingString(x, y, z, length) {
    const stringGeo = new THREE.CylinderGeometry(0.008, 0.008, length, 4);
    const stringMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const stringMesh = new THREE.Mesh(stringGeo, stringMat);
    stringMesh.position.set(x, y - length / 2, z);
    stringMesh.castShadow = true;
    return stringMesh;
  }

  const SHELF_Y = 1.75;
  const SHELF_Z = -1.5;
  const WALL_HANG_Y = 2.65;
  const WALL_HANG_Z = -2.2;

  const SHELF_Z_BACK = -2;
  const SHELF_Z_FRONT = -1.4;

  const prizeSpecs = [
    { type: 'duck',   tint: 'red',    scale: 1.2, position: [-2.4, SHELF_Y, SHELF_Z_BACK], rotation: [0, 0.2, 0] },
    { type: 'bear',                    scale: 1.2, position: [-1.4, SHELF_Y, SHELF_Z_BACK], rotation: [0, -0.15, 0] },
    { type: 'rabbit', tint: 'yellow',  scale: 1.2, position: [-0.4, SHELF_Y, SHELF_Z_BACK], rotation: [0, 0.1, 0] },
    { type: 'bunny',                   scale: 1.2, position: [0.4,  SHELF_Y, SHELF_Z_BACK], rotation: [0, -0.1, 0] },
    { type: 'duck',                    scale: 1.2, position: [1.4,  SHELF_Y, SHELF_Z_BACK], rotation: [0, 0.15, 0] },
    { type: 'bear',   tint: 'blue',    scale: 1.2, position: [2.4,  SHELF_Y, SHELF_Z_BACK], rotation: [0, -0.2, 0] },

    { type: 'bunny',  tint: 'blue',    scale: 1.1, position: [-1.8, SHELF_Y, SHELF_Z_FRONT], rotation: [0, 0.1, 0] },
    { type: 'duck',   tint: 'yellow',  scale: 1.1, position: [-0.9, SHELF_Y, SHELF_Z_FRONT], rotation: [0, -0.05, 0] },
    { type: 'bear',   tint: 'red',     scale: 1.1, position: [0.0,  SHELF_Y, SHELF_Z_FRONT], rotation: [0, 0.05, 0] },
    { type: 'rabbit',                  scale: 1.1, position: [0.9,  SHELF_Y, SHELF_Z_FRONT], rotation: [0, -0.1, 0] },
    { type: 'duck',                    scale: 1.1, position: [1.8,  SHELF_Y, SHELF_Z_FRONT], rotation: [0, 0.12, 0] },

    { type: 'bear',   tint: 'red',     scale: 0.7, position: [-2.0, WALL_HANG_Y, WALL_HANG_Z], rotation: [0, 0.1, 0], hang: true },
    { type: 'bunny',  tint: 'yellow',  scale: 0.7, position: [-1.0, WALL_HANG_Y, WALL_HANG_Z], rotation: [0, -0.08, 0], hang: true },
    { type: 'duck',                    scale: 0.7, position: [0.0,  WALL_HANG_Y, WALL_HANG_Z], rotation: [0, 0.05, 0], hang: true },
    { type: 'rabbit', tint: 'blue',    scale: 0.7, position: [1.0,  WALL_HANG_Y, WALL_HANG_Z], rotation: [0, -0.05, 0], hang: true },
    { type: 'bear',                    scale: 0.7, position: [2.0,  WALL_HANG_Y, WALL_HANG_Z], rotation: [0, 0.12, 0], hang: true },

    { type: 'bear', scale: 1.8, position: [-3.6, 0.0, 1.5], rotation: [0, 0.5, 0] },
    { type: 'duck', scale: 1.8, position: [3.6, 0.0, 1.5], rotation: [0, -0.5, 0] },
  ];

  if (duckGltf && bearGltf && bunnyGltf && rabbitGltf) {
    const CEILING_Y = 3.6;
    prizeSpecs.forEach(spec => {
      const prize = createPrize(spec.type, {
        tint: spec.tint,
        scale: spec.scale,
        position: spec.position,
        rotation: spec.rotation
      });
      if (prize) {
        group.add(prize);
        if (spec.hang) {
          const px = spec.position[0];
          const py = spec.position[1];
          const pz = spec.position[2];
          const prizeHeight = 0.8 * spec.scale;
          const topY = py + prizeHeight;
          const stringLength = CEILING_Y - topY;
          if (stringLength > 0) {
            const stringMesh = createHangingString(px, CEILING_Y, pz, stringLength);
            group.add(stringMesh);
          }
        }
      }
    });
  }

  // ── Build booth structure ──
  let boothModel;
  try {
    const gltf = await loadGLB('assets/models/environment/food_stall.glb');
    boothModel = gltf.scene;
    sanitizeMaterials(boothModel);

    const bbox = new THREE.Box3().setFromObject(boothModel);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const targetHeight = 4.5;
    const scale = size.y > 0 ? targetHeight / size.y : 1;

    boothModel.scale.setScalar(scale);
    boothModel.rotation.y = -Math.PI / 2;

    boothModel.updateMatrix();
    boothModel.matrixWorld.copy(boothModel.matrix);

    const bboxRotated = new THREE.Box3().setFromObject(boothModel);
    const centerRotated = new THREE.Vector3();
    bboxRotated.getCenter(centerRotated);

    boothModel.position.set(-centerRotated.x, -bboxRotated.min.y, -centerRotated.z);

    boothModel.traverse((o) => {
      if (o.isMesh) {
        if (o.name.toLowerCase().includes('text') || o.name.toLowerCase().includes('sign')) {
          o.visible = false;
        } else {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      }
    });
    group.add(boothModel);
  } catch (e) {
    console.warn("Failed to load stylized_carnival_booth.glb, using procedural fallback", e);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 });
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.8, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });

    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 1.5), woodMat);
    counter.position.set(0, 0.5, 0);
    counter.castShadow = true;
    counter.receiveShadow = true;
    group.add(counter);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.3), woodMat);
    backWall.position.set(0, 2, -0.9);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    group.add(backWall);

    for (const [rx, rz] of [[-1.5, -0.5], [1.5, -0.5]]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.15, 2.5), canvasMat);
      roof.position.set(rx, 3.5, rz);
      roof.rotation.x = -0.15;
      roof.castShadow = true;
      group.add(roof);
    }

    for (const [px, pz] of [[-2.8, -1], [2.8, -1], [-2.8, 0.5], [2.8, 0.5]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 8), poleMat);
      pole.position.set(px, 1.5, pz);
      pole.castShadow = true;
      group.add(pole);
    }

    for (const sx of [-2.9, 2.9]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, 1.5), woodMat);
      side.position.set(sx, 1.75, -0.25);
      side.castShadow = true;
      group.add(side);
    }
  }

  // ── Targets ──
  const targets = [];
  const rows = [
    { z: 0.2,   y: 2.05, speed: 0.8, direction: 1, multiplier: 1, count: 3 },
    { z: -0.2,  y: 2.50, speed: 1.4, direction: -1, multiplier: 2, count: 4 },
    { z: -0.5,  y: 2.95, speed: 2.0, direction: 1, multiplier: 3, count: 4 }
  ];

  const bound = 2.8;
  const trackWidth = bound * 2;

  for (const row of rows) {
    const spacing = trackWidth / row.count;
    for (let i = 0; i < row.count; i++) {
      const tx = -bound + (i * spacing) + (spacing / 2);
      const ty = row.y;
      const tz = row.z;

      const targetGroup = new THREE.Group();
      targetGroup.position.set(tx, ty, tz);

      const outer = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16),
        new THREE.MeshStandardMaterial({ color: 0x2244cc, emissive: 0x000000 })
      );
      outer.rotation.x = -Math.PI / 2;
      targetGroup.add(outer);

      const mid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x000000 })
      );
      mid.rotation.x = -Math.PI / 2;
      targetGroup.add(mid);

      const center = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16),
        new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x000000 })
      );
      center.rotation.x = -Math.PI / 2;
      targetGroup.add(center);

      group.add(targetGroup);
      targets.push({
        group: targetGroup,
        meshes: [outer, mid, center],
        hit: false,
        hitTime: 0,
        points: [1, 5, 10],
        speed: row.speed,
        direction: row.direction,
        multiplier: row.multiplier,
        rowZ: row.z,
        omega: 0,
      });
    }
  }

  // ── Sophisticated interior lighting ──
  const galleryLights = [];
  const ambientLights = [];

  // ─── 1. Warm overhead spots directed precisely at the shelves ───
  const shelfSpotPositions = [-1.5, 0.0, 1.5];
  for (const sx of shelfSpotPositions) {
    const sp = new THREE.SpotLight(0xfff0d0, 8);
    sp.position.set(sx, 3.5, 0.0);
    sp.target.position.set(sx, SHELF_Y, SHELF_Z);
    sp.angle = Math.PI / 6;
    sp.penumbra = 0.5;
    sp.decay = 1.5;
    sp.distance = 6;
    sp.castShadow = true;
    group.add(sp);
    group.add(sp.target);
    sp.baseIntensity = 8;
    ambientLights.push(sp);
  }

  // ─── 2. Target backlights for sophisticated glowing silhouette ───
  const targetGlow1 = new THREE.PointLight(0x2288ff, 3.0, 4, 1.2);
  targetGlow1.position.set(-1.0, 2.5, -0.65);
  group.add(targetGlow1);
  targetGlow1.baseIntensity = 3.0;
  ambientLights.push(targetGlow1);

  const targetGlow2 = new THREE.PointLight(0xff2288, 3.0, 4, 1.2);
  targetGlow2.position.set(1.0, 2.5, -0.65);
  group.add(targetGlow2);
  targetGlow2.baseIntensity = 3.0;
  ambientLights.push(targetGlow2);

  // ─── 3. Shelf under-glow (subtle neon strip effect under the plushies) ───
  const underGlow = new THREE.PointLight(0xffaa44, 4.0, 5, 1.5);
  underGlow.position.set(0, SHELF_Y - 0.2, SHELF_Z + 0.2);
  group.add(underGlow);
  underGlow.baseIntensity = 4.0;
  ambientLights.push(underGlow);

  // ─── 4. Front counter fill (soft warm light for the player area) ───
  const frontFill = new THREE.PointLight(0xffeebb, 2.0, 5, 1.5);
  frontFill.position.set(0, 1.5, 1.0);
  group.add(frontFill);
  frontFill.baseIntensity = 2.0;
  ambientLights.push(frontFill);

  // ─── 5. Mesh-attached light bars (neon tubes on side walls) ───
  const neonColors = [0xff2266, 0x22aaff];
  const neonXPositions = [-3.05, 3.05];
  for (let i = 0; i < 2; i++) {
    const nx = neonXPositions[i];
    const nc = neonColors[i];
    const isRed = (i === 0);

    const tubeGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 8);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: nc,
      emissive: nc,
      emissiveIntensity: isRed ? 12.0 : 5.0,
      roughness: 0.1,
      transparent: true,
      opacity: 0.9,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.position.set(nx, 2.0, -1.2);
    group.add(tube);
    galleryLights.push({ mesh: tube, baseIntensity: isRed ? 12.0 : 5.0, phase: i * Math.PI });

    const neonPL = new THREE.PointLight(nc, isRed ? 4.0 : 2.5, 5.0, 1.5);
    neonPL.position.set(nx > 0 ? nx - 0.2 : nx + 0.2, 2.0, -1.2);
    group.add(neonPL);
    galleryLights.push({ light: neonPL, baseIntensity: isRed ? 4.0 : 2.5, phase: i * Math.PI });
  }

  // ── Add Operator Character ──
  let operator = null;
  if (workerGltf) {
    const root = workerGltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((mat) => {
            if (mat.name === 'Skin') {
              mat.color.setRGB(1.0, 0.88, 0.82);
              mat.roughness = 0.6;
              mat.metalness = 0.0;
            }
          });
        }
      }
    });

    const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 3.3;
    const template = { root, height: h, name: 'Cowboy_Male' };

    operator = makeRider(template, 3.28, {
      pool: ['standRest'],
      facingY: 0,
      phase: Math.random() * 6,
      standing: true,
    });

    if (gunGltf) {
      const gunWrapper = new THREE.Group();
      const gunModel = gunGltf.scene.clone();

      sanitizeMaterials(gunModel);
      gunModel.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
          if (o.name === 'defaultMaterial') {
            o.visible = false;
          }
        }
      });

      gunModel.scale.setScalar(3.8);
      gunModel.position.set(0, 0, 0);

      const m = new THREE.Matrix4().set(
        0,  0, -1,  0,
        1,  0,  0,  0,
        0, -1,  0,  0,
        0,  0,  0,  1
      );
      const baseQ = new THREE.Quaternion().setFromRotationMatrix(m);
      const extraQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      gunModel.quaternion.copy(baseQ).multiply(extraQ);
      gunWrapper.add(gunModel);

      const fig = operator.fig;
      let hand = fig.getObjectByName('Fist.R') || fig.getObjectByName('Fist_R') || fig.getObjectByName('FistR') ||
                 fig.getObjectByName('HandR') || fig.getObjectByName('Hand.R') || fig.getObjectByName('Hand_R');
      if (hand) {
        gunWrapper.position.set(-0.25, 0.35, 0.20);
      } else {
        hand = fig.getObjectByName('LowerArmR') || fig.getObjectByName('LowerArm.R') || fig.getObjectByName('LowerArm_R');
        gunWrapper.position.set(-0.1, 0.35, 0.1);
      }
      if (hand) hand.add(gunWrapper);
    }

    const wrapper = new THREE.Group();
    wrapper.name = 'shooting_operator';
    wrapper.position.set(-1.2, 0, 5.0);
    wrapper.rotation.y = Math.PI - 0.29;

    wrapper.add(operator.pivot);
    operator.pivot.position.set(0, 0, 0);
    updateRider(operator, 0);
    wrapper.updateMatrixWorld(true);
    operator.fig.traverse((o) => {
      if (o.isSkinnedMesh) o.skeleton.update();
    });
    const bbox = new THREE.Box3().setFromObject(operator.fig, true);
    if (isFinite(bbox.min.y)) {
      const fix = Math.max(-0.5, Math.min(0.5, bbox.min.y));
      operator.pivot.position.y -= fix;
    }

    if (!window.__lp) window.__lp = {};
    window.__lp.cowboy = wrapper;

    group.add(wrapper);
  }

  // ── FPS Gun ──
  let fpsGun = null;
  const cowboyWrapper = group.getObjectByName('shooting_operator');
  if (gunGltf) {
    fpsGun = new THREE.Group();
    fpsGun.name = 'fpsGun';
    const fpsGunModel = gunGltf.scene.clone();
    sanitizeMaterials(fpsGunModel);
    fpsGunModel.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.name === 'defaultMaterial') o.visible = false;
      }
    });
    fpsGunModel.scale.setScalar(6.0);
    fpsGunModel.rotation.set(0, -Math.PI / 2, 0);
    fpsGun.add(fpsGunModel);

    fpsGunModel.updateMatrix();
    const muzzleLocal = new THREE.Vector3(0.18, 0.13, 0).applyMatrix4(fpsGunModel.matrix);

    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 128;
    flashCanvas.height = 128;
    const ctx = flashCanvas.getContext('2d');

    const flashGradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    flashGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    flashGradient.addColorStop(0.15, 'rgba(255, 240, 150, 1)');
    flashGradient.addColorStop(0.4, 'rgba(255, 120, 0, 0.6)');
    flashGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = flashGradient;
    ctx.fillRect(0, 0, 128, 128);

    ctx.translate(64, 64);
    for (let i = 0; i < 7; i++) {
      ctx.rotate(Math.PI * 2 / 7);
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(0, -55);
      ctx.lineTo(3, 0);
      ctx.fillStyle = 'rgba(255, 200, 50, 0.7)';
      ctx.fill();
    }

    const flashTexture = new THREE.CanvasTexture(flashCanvas);
    const flashMat = new THREE.SpriteMaterial({
      map: flashTexture,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    const flashSprite = new THREE.Sprite(flashMat);
    flashSprite.scale.set(0.6, 0.6, 1.0);

    const flashGroup = new THREE.Group();
    flashGroup.position.copy(muzzleLocal);
    flashGroup.add(flashSprite);

    fpsGun.add(flashGroup);
    flashGroup.visible = false;

    fpsGun.userData.flashGroup = flashGroup;
    fpsGun.userData.flashMat = flashMat;
    fpsGun.userData.flashSprite = flashSprite;

    fpsGun.position.set(0, 1.5, 4.5);
    fpsGun.visible = false;
    group.add(fpsGun);
  }

  // Muzzle flash point light
  const muzzleLight = new THREE.PointLight(0xff9922, 0.0, 4.0, 1.5);
  group.add(muzzleLight);

  // Controller / State
  const controller = new ShootingGalleryController(group, {
    camera,
    renderer,
    controls,
    boothModel,
    targets,
    galleryLights,
    ambientLights,
    fpsGun,
    operator,
    cowboyWrapper,
    bulletGltf,
    muzzleLight,
  });

  group.userData.tick = (delta, time) => {
    controller.tick(delta, time);
  };

  controller.applyBloomLayers();

  group.userData.controller = controller;
  return group;
}
