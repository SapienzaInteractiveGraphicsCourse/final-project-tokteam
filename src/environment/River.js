import * as THREE from 'three';
import { buildWater } from './Water.js';
import { buildRocks } from './Rocks.js';
import { buildFish } from './Fish.js';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { RIVER_X_MIN, RIVER_X_MAX, riverCenter, riverHalfWidth } from '../utils/riverConstants.js';

export const SPOTLIGHT_X_COORDS = [-85, -73, -61, -49, -37, -25, -13, 13, 25, 37, 49, 61, 73, 85];

export function distanceFromRiver(x, z) {
  return Math.abs(z - riverCenter(x)) - riverHalfWidth(x);
}

function buildRiverBed() {
  const segments = 200;
  const positions = [];
  const indices = [];
  const uvs = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = RIVER_X_MIN + t * (RIVER_X_MAX - RIVER_X_MIN);
    const cz = riverCenter(x);
    const hw = riverHalfWidth(x);
    positions.push(x, 0, cz - hw);
    positions.push(x, 0, cz + hw);
    uvs.push(t, 0); uvs.push(t, 1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  mesh.name = 'river_bed';
  return mesh;
}

export async function buildRiver() {
  const group = new THREE.Group();
  group.name = 'river';

  group.add(buildRiverBed());

  const water = buildWater();
  const [rocks, fish, spotlightGltf] = await Promise.all([
    buildRocks(),
    buildFish(water),
    loadGLB('assets/models/environment/spotlight.glb').catch((err) => {
      console.warn('Failed to load spotlight.glb:', err.message);
      return null;
    })
  ]);

  group.add(water);
  group.add(rocks);
  group.add(fish);

  const spotlightsList = [];

  if (spotlightGltf) {
    const spotlightSource = spotlightGltf.scene;
    sanitizeMaterials(spotlightSource);

    const bbox = new THREE.Box3().setFromObject(spotlightSource);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const targetHeight = 1.2;
    const scale = size.y > 0 ? targetHeight / size.y : 1;

    const spotlightsGroup = new THREE.Group();
    spotlightsGroup.name = 'bank_spotlights';
    group.add(spotlightsGroup);

    // Place spotlights along the banks (avoiding bridge area near x=0)
    for (const x of SPOTLIGHT_X_COORDS) {
      const cz = riverCenter(x);
      const hw = riverHalfWidth(x);

      // Left bank (side = -1) and Right bank (side = 1)
      for (const side of [-1, 1]) {
        const z = cz + side * (hw + 0.35);

        const fixture = new THREE.Group();
        fixture.name = `spotlight_${x}_${side === 1 ? 'right' : 'left'}`;
        // Set fixture Y so the bottom of the spotlight rests exactly on the ground
        fixture.position.set(x, 0.05, z);

        const model = spotlightSource.clone();
        
        // Center the model meshes exactly at local (0,0,0)
        model.position.set(-center.x, -center.y, -center.z);
        
        const rotator = new THREE.Group();
        rotator.add(model);
        // Lift it up so the base of the bounding box rests exactly at local y=0
        rotator.position.y = size.y / 2;
        
        fixture.add(rotator);
        fixture.scale.setScalar(scale);

        // Target coordinates at the center of the river bed (submerged)
        const targetX = x;
        const targetY = -1.5; 
        const targetZ = cz;

        // Point the fixture horizontally towards the river bed target (pan only, no tilt)
        fixture.lookAt(targetX, 0.05, targetZ);

        // Find the canister node to tilt it down without tilting the base
        const canister = model.getObjectByName('Cylinder275_60');
        if (canister) {
          const distXZ = Math.hypot(targetX - x, targetZ - z);
          const pitch = Math.atan2(0.05 - targetY, distXZ); // Positive angle to tilt down
          
          // Create pivot group to align coordinate axes with fixture space
          const canisterPivot = new THREE.Group();
          canisterPivot.name = `canisterPivot_${x}_${side === 1 ? 'right' : 'left'}`;
          canisterPivot.position.copy(canister.position);
          
          // Re-nest canister inside pivot
          const parentNode = canister.parent;
          parentNode.add(canisterPivot);
          canisterPivot.add(canister);
          
          // Reset canister rotation and position relative to pivot
          canister.rotation.set(0, 0, 0);
          canister.position.set(0, 0, 0);
          
          // Apply rotation:
          // Yaw of -Math.PI/2 aligns the canister's physical cylinder with the look direction (+Z)
          // Pitch rotates it downwards towards the water
          canisterPivot.rotation.set(pitch, -Math.PI / 2, 0);
        }

        // Virtual spotlight parameters for the custom water shader (zero active three.js lights for maximum performance)
        const lightWorldPos = new THREE.Vector3(x, 0.05 + targetHeight * 0.5, z);
        const lightWorldTarget = new THREE.Vector3(targetX, targetY, targetZ);

        // Setup emissive materials clone for animating bulb glow
        const emissiveMaterials = [];
        fixture.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material = o.material.clone();
              // Check if material is Material.065 or has any emissive color
              if (o.material.name === 'Material.065' || (o.material.emissive && o.material.emissive.getHex() > 0)) {
                emissiveMaterials.push(o.material);
              }
            }
          }
        });

        spotlightsGroup.add(fixture);

        spotlightsList.push({
          fixture,
          intensity: 0.0,
          position: lightWorldPos,
          target: lightWorldTarget,
          emissiveMaterials
        });
      }
    }
  }

  const ticks = [];
  if (water.userData.tick) ticks.push(water.userData.tick);
  if (fish.userData.tick) ticks.push(fish.userData.tick);

  group.userData.update = (delta, time) => {
    for (const t of ticks) t(delta, time);

    // Animate spotlights based on night cycle
    const isNight = isNightNow(group);
    const targetIntensity = isNight ? 120.0 : 0.0;
    const targetEmissive = isNight ? 2.5 : 0.0;

    const k = 1 - Math.exp(-5.0 * delta); // smooth fade transition

    const uSpotPos = water.userData.material ? water.userData.material.uniforms.uSpotPositions.value : null;
    const uSpotTgt = water.userData.material ? water.userData.material.uniforms.uSpotTargets.value : null;
    const uSpotInt = water.userData.material ? water.userData.material.uniforms.uSpotIntensities.value : null;

    for (let i = 0; i < spotlightsList.length; i++) {
      const sp = spotlightsList[i];
      sp.intensity = THREE.MathUtils.lerp(sp.intensity, targetIntensity, k);
      for (const mat of sp.emissiveMaterials) {
        mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, targetEmissive, k);
        if (mat.emissive.getHex() === 0) mat.emissive.setHex(0xfffaf0);
      }
      
      if (uSpotPos && uSpotTgt && uSpotInt) {
        uSpotPos[i].copy(sp.position);
        uSpotTgt[i].copy(sp.target);
        uSpotInt[i] = sp.intensity;
      }
    }
  };
  return group;
}
