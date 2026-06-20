import * as THREE from 'three';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { makeRider, updateRider, pose } from '../people/Passengers.js';

const CART_URL = 'assets/models/environment/new_york_hot_dog_cart.glb';

// Worker models — chef or worker outfits
const WORKER_MODELS = ['Chef_Male', 'Chef_Female', 'Worker_Male', 'Worker_Female'];

const PLACEMENTS = [
  // West side of the path, parallel to the path.
  // [id, x, z, rotY]
  ['hotdog_cart_1', -14, 23, 0],
];

function enableShadows(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

// Soft round sprite for the steam puffs.
function makeSteamSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Cooking-steam particle system. Spawn pos is relative to the group root
 * (world coords), so the caller must pass the final world position. */
function makeSteam({ x, y, z }) {
  const COUNT = 28;
  const LIFE_MIN = 1.8, LIFE_MAX = 3.2;
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const lifetimes = new Float32Array(COUNT);
  const durations = new Float32Array(COUNT);

  const respawn = (i) => {
    positions[i * 3]     = x + (Math.random() - 0.5) * 0.35;
    positions[i * 3 + 1] = y + Math.random() * 0.08;
    positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.35;
    velocities[i * 3]     = (Math.random() - 0.5) * 0.10;
    velocities[i * 3 + 1] = 0.25 + Math.random() * 0.25;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.10;
    durations[i]  = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    lifetimes[i]  = durations[i];
  };
  for (let i = 0; i < COUNT; i++) {
    respawn(i);
    lifetimes[i] = Math.random() * durations[i]; // desynchronise
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: makeSteamSprite(),
    color: 0xd8dfe6,
    size: 0.70,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  points.userData.tick = (delta, time, windSpeed = 1) => {
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < COUNT; i++) {
      lifetimes[i] -= dt;
      if (lifetimes[i] <= 0) { respawn(i); continue; }
      positions[i * 3]     += (velocities[i * 3] + windSpeed * 0.10) * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3 + 1] += 0.04 * dt;
      positions[i * 3] += Math.sin(time * 2.0 + i) * 0.04 * dt;
    }
    geometry.attributes.position.needsUpdate = true;
    material.opacity = 0.42 + 0.08 * Math.sin(time * 1.3) - Math.min(0.15, windSpeed * 0.04);
  };
  return points;
}

export async function buildFoodStalls() {
  const group = new THREE.Group();
  group.name = 'foodStalls';

  const steamSystems = [];
  const workers = [];

  for (const [id, x, z, rotY] of PLACEMENTS) {
    /* ── 1. Load and place the hot dog cart ── */
    let cartScale = 1;
    let cartGroundOffset = 0;
    let cartBbox = null;

    const TARGET_HEIGHT = 5.5;

    try {
      const gltf = await loadGLB(CART_URL);
      const cartModel = gltf.scene;
      sanitizeMaterials(cartModel);

      // Measure the raw model
      const rawBox = new THREE.Box3().setFromObject(cartModel);
      const rawSize = new THREE.Vector3();
      rawBox.getSize(rawSize);

      // Scale so the cart fits well alongside human-scale elements.
      cartScale = rawSize.y > 0 ? TARGET_HEIGHT / rawSize.y : 1;
      cartModel.scale.setScalar(cartScale);

      // Sit the cart flush on the ground
      cartGroundOffset = -rawBox.min.y * cartScale;
      cartModel.position.set(x, cartGroundOffset, z);
      cartModel.rotation.y = rotY;

      // --- Add sophisticated lights ---
      const lightColor = 0xffe0b2; // Warm, inviting glow
      
      // Main warm point light under the umbrella
      const mainLight = new THREE.PointLight(lightColor, 3.5, 15);
      mainLight.position.set(0, rawSize.y * 0.75, 0); 
      mainLight.castShadow = true;
      cartModel.add(mainLight);

      // Luminous lines (neon light strips) along the sides of the cart body
      // The main box is aligned along Z, spanning from Z = -0.994 to 0.238.
      // We orient the light strips along Z.
      const lineGeo = new THREE.BoxGeometry(0.015, 0.015, 1.20);
      const lineMat = new THREE.MeshStandardMaterial({ 
        color: 0xfff3e0, 
        emissive: 0xffa74a, 
        emissiveIntensity: 4.5, 
        roughness: 0.1 
      });

      // Front strip (customer side menu, +X is ~0.24)
      const frontLine = new THREE.Mesh(lineGeo, lineMat);
      frontLine.position.set(0.245, 0.64, -0.38); 
      cartModel.add(frontLine);

      // Back strip (chef side, -X is ~-0.24)
      const backLine = new THREE.Mesh(lineGeo, lineMat);
      backLine.position.set(-0.245, 0.64, -0.38);
      cartModel.add(backLine);
      // --------------------------------

      enableShadows(cartModel);
      cartModel.name = id;
      group.add(cartModel);

      cartModel.updateMatrixWorld(true);
      cartBbox = new THREE.Box3().setFromObject(cartModel);

      /* ── 2. Steam: center on the grill, in front of worker ── */
      // Centered steam position (X = -0.15, Y = 0.67, Z = -0.27) closer to the worker.
      const localSteamPos = new THREE.Vector3(-0.15, 0.67, -0.27); 
      const worldSteamPos = localSteamPos.clone().applyMatrix4(cartModel.matrixWorld);
      const steam = makeSteam({ x: worldSteamPos.x, y: worldSteamPos.y, z: worldSteamPos.z });
      group.add(steam);
      steamSystems.push(steam);

      /* ── 3. Worker NPC centered behind the cart ── */
      // Worker centered on the chef side (X = -0.52, Z = -0.32).
      const localWorkerPos = new THREE.Vector3(-0.52, 0, -0.32); 
      const worldWorkerPos = localWorkerPos.clone().applyMatrix4(cartModel.matrixWorld);
      const workerFaceAngle = rotY + Math.PI / 2; // face +X (towards the cart)
      const worker = await _buildWorker(group, worldWorkerPos.x, worldWorkerPos.z, workerFaceAngle);
      if (worker) workers.push(worker);
    } catch (e) {
      console.warn('FoodStalls: failed to load new_york_hot_dog_cart.glb', e);
    }
  }

  group.userData.tick = (delta, time, windSpeed) => {
    for (const s of steamSystems) s.userData.tick(delta, time, windSpeed);
    for (const w of workers) {
      updateRider(w, time);
      
      // Custom sophisticated animation for the cook
      const B = w.bones;
      if (B && B.UpperArmR && B.LowerArmR && B.UpperArmL && B.LowerArmL && B.Torso && B.Head) {
        // Lean forward to reach the grill
        pose(B, 'Torso', 0.35 + Math.sin(time * 0.5) * 0.05, 0, 0);
        // Head looking down at the hot dogs
        pose(B, 'Head', 0.4 + Math.sin(time * 1.2) * 0.05, Math.sin(time * 0.8) * 0.1, 0);
        
        // Right arm working the grill (flipping/moving things)
        const rightWork = Math.sin(time * 6.0);
        pose(B, 'UpperArmR', 0.5 + rightWork * 0.15, 0.2, -0.1);
        pose(B, 'LowerArmR', 1.0 + rightWork * 0.25, 0, 0);

        // Left arm holding/assisting
        const leftWork = Math.cos(time * 3.5);
        pose(B, 'UpperArmL', 0.6 + leftWork * 0.08, -0.2, 0.1);
        pose(B, 'LowerArmL', 0.9 + leftWork * 0.15, 0, 0);
      }
    }
  };

  return group;
}

/* ── Internal: build a single worker figure ── */
async function _buildWorker(parentGroup, worldX, worldZ, faceAngle) {
  const workerName = WORKER_MODELS[Math.floor(Math.random() * WORKER_MODELS.length)];
  let template;
  try {
    const gltf = await loadGLB(`assets/models/people/${workerName}.gltf`);
    const root = gltf.scene;
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
    template = { root, height: h, name: workerName };
  } catch (e) {
    console.warn('FoodStalls: failed to load worker', workerName, e);
    return null;
  }

  const HEIGHT = 3.28;
  const rider = makeRider(template, HEIGHT, {
    pool: ['standRest', 'standRest', 'standLook', 'standPoint'],
    facingY: 0,               // fig faces +Z in pivot local space
    phase: Math.random() * 6,
    standing: true,
  });

  // Wrapper group placed in the world; its +Z direction = faceAngle.
  const wrapper = new THREE.Group();
  wrapper.name = 'hotdog_worker';
  wrapper.position.set(worldX, 0, worldZ);
  wrapper.rotation.y = faceAngle; // face toward the cart front

  wrapper.add(rider.pivot);
  rider.pivot.position.set(0, 0, 0);

  // Run one animation frame so the standing pose is applied, then
  // calibrate the ground offset.
  updateRider(rider, 0);
  wrapper.updateMatrixWorld(true);
  rider.fig.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton.update();
  });
  const bbox = new THREE.Box3().setFromObject(rider.fig, true);
  if (isFinite(bbox.min.y)) {
    const fix = Math.max(-0.5, Math.min(0.5, bbox.min.y));
    rider.pivot.position.y -= fix;
  }

  parentGroup.add(wrapper);
  return rider;
}
