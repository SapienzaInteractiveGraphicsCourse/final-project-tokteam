import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { Easings } from '../utils/Easings.js';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { eventBus } from '../utils/EventBus.js';
import { isNightNow } from '../lighting/DayNightCycle.js';

const LAMP_URL = 'assets/models/environment/lamp.glb';
export const LAMPPOST_LAYER = 1;

const POSITIONS = [
  ['lamp_0', -5, -25],
  ['lamp_1', -5, -50],
  ['lamp_2', -5, -75],
  ['lamp_3',  5, -25],
  ['lamp_4',  5, -50],
  ['lamp_5',  5, -75],
  ['lamp_6', -5,  25],
  ['lamp_7', -5,  50],
  ['lamp_8', -5,  75],
  ['lamp_9',  5,  25],
  ['lamp_10', 5,  50],
  ['lamp_11', 5,  75]
];

export async function buildLampposts() {
  const group = new THREE.Group();
  group.name = 'lampposts';

  const gltf = await loadGLB(LAMP_URL);
  const source = gltf.scene;
  sanitizeMaterials(source);

  const bbox = new THREE.Box3().setFromObject(source);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const targetHeight = 6.0;
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  const groundOffset = -bbox.min.y * scale;
  const lampHeadY = bbox.max.y * scale * 0.9;

  const count = POSITIONS.length;

  // Build individual lamp clones instead of using one InstancedMesh.
  // This allows independent control over materials and light sources per lamp.
  for (let i = 0; i < count; i++) {
    const [id, x, z] = POSITIONS[i];

    const lampRoot = new THREE.Group();
    lampRoot.name = id;
    lampRoot.position.set(x, groundOffset, z);
    lampRoot.userData.lampId = id;
    lampRoot.userData.mode = 'auto'; // Explicit tracking state: 'auto' | 'on' | 'off'
    lampRoot.userData.targetOn = false;
    lampRoot.userData.nightFactor = 0.0;
    lampRoot.userData.instanceIndex = i;
    lampRoot.userData.blinkTime = 0.0;
    lampRoot.userData.targetIntensity = 0.0;
    lampRoot.userData.intensityTween = null;
    group.add(lampRoot);

    // Clone model for this specific lamppost
    const modelClone = source.clone();
    modelClone.scale.set(scale, scale, scale);
    lampRoot.add(modelClone);

    // Clone materials recursively so each lamp can control its emissive glowing independently
    const emissiveMaterials = [];
    modelClone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.layers.enable(LAMPPOST_LAYER);
        if (o.material) {
          o.material = o.material.clone();
          if (o.material.emissive) {
            emissiveMaterials.push(o.material);
          }
        }
      }
    });
    lampRoot.userData.emissiveMaterials = emissiveMaterials;

    // Invisible click hitbox — a tall slim box roughly matching the lamppost footprint.
    const hitboxGeo = new THREE.BoxGeometry(1.2, targetHeight, 1.2);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitbox.position.set(0, targetHeight / 2, 0);
    hitbox.userData.lampRef = lampRoot;
    hitbox.layers.enable(LAMPPOST_LAYER);
    lampRoot.add(hitbox);

    // High-performance PointLight shining in all directions
    const pointLight = new THREE.PointLight(0xfffaf0, 0, 90, 1.2);
    pointLight.position.set(0, lampHeadY, 0);
    pointLight.name = `${id}_light`;
    pointLight.castShadow = false;
    pointLight.userData.lockColor = true;
    pointLight.layers.enable(LAMPPOST_LAYER);
    lampRoot.add(pointLight);

    lampRoot.userData.pointLight = pointLight;
  }

  // Listen for time phase changes to update nightFactor (used for dimming).
  // Day/night state itself is read via isNightNow() in the tick so that the
  // click handler and the auto-mode logic always agree.
  eventBus.on('time-phase-change', (data) => {
    const nightFactor = data.nightFactor;

    for (const lampRoot of group.children) {
      lampRoot.userData.nightFactor = nightFactor;
    }
  });

  // Tick update logic
  group.userData.tick = (delta, time) => {
    const baseIntensity = 40.0; // Reduced from 120.0 to prevent reflection/bloom hotspots
    const maxEmissive = 4.0;    // Reduced from 8.0 for a cleaner bulb glow

    for (const lampRoot of group.children) {
      const pl = lampRoot.userData.pointLight;
      if (!pl) continue;

      const mode = lampRoot.userData.mode || 'auto';

      if (lampRoot.userData.blinkTime > 0) {
        if (lampRoot.userData.intensityTween) {
          lampRoot.userData.intensityTween.stop();
          lampRoot.userData.intensityTween = null;
        }
        lampRoot.userData.blinkTime -= delta;
        const step = Math.floor(lampRoot.userData.blinkTime / 0.10);
        const isNight = isNightNow(lampRoot);
        const isBlinkOn = (step % 2 === 0) ? isNight : !isNight;
        pl.intensity = isBlinkOn ? baseIntensity : 0.0;

        const emissiveStrength = (pl.intensity / baseIntensity) * maxEmissive;
        const emissiveMats = lampRoot.userData.emissiveMaterials || [];
        for (const mat of emissiveMats) {
          mat.emissiveIntensity = emissiveStrength;
          mat.emissive.setHex(0xfffaf0);
        }
        continue;
      }

      let targetIntensity = 0;
      if (mode === 'on') {
        targetIntensity = baseIntensity;
      } else if (mode === 'off') {
        targetIntensity = 0;
      } else if (isNightNow(lampRoot)) {
        const nf = lampRoot.userData.nightFactor !== undefined ? lampRoot.userData.nightFactor : 1.0;
        targetIntensity = nf * baseIntensity;
      }

      const stored = lampRoot.userData.targetIntensity;
      if (lampRoot.userData.blinkTime <= 0 && Math.abs(targetIntensity - stored) > 0.01) {
        lampRoot.userData.targetIntensity = targetIntensity;
        if (lampRoot.userData.intensityTween) {
          lampRoot.userData.intensityTween.stop();
          lampRoot.userData.intensityTween = null;
        }
        lampRoot.userData.intensityTween = new TWEEN.Tween(pl)
          .to({ intensity: targetIntensity }, 300)
          .easing(Easings.SMOOTH)
          .start();
      }

      // Drive individual emissive intensity on the lamp's unique materials
      const emissiveStrength = (pl.intensity / baseIntensity) * maxEmissive;
      const emissiveMats = lampRoot.userData.emissiveMaterials || [];
      for (const mat of emissiveMats) {
        mat.emissiveIntensity = emissiveStrength;
        mat.emissive.setHex(0xfffaf0);
      }
    }
  };

  return group;
}
