import * as THREE from 'three';
import { loadObjMtl } from '../utils/loaders.js';
import { riverCenter, riverHalfWidth, RIVER_X_MIN, RIVER_X_MAX } from '../utils/riverConstants.js';

const ROCK_MODELS = ['Rock_1', 'Rock_3', 'Rock_5', 'Rock_6', 'Rock_Moss_1', 'Rock_Moss_3'];
const BASE_URL = 'assets/models/environment/';
const BRIDGE_CLEAR = 5;
const SPOTLIGHT_X_COORDS = [-85, -73, -61, -49, -37, -25, -13, 13, 25, 37, 49, 61, 73, 85];

function rand(min, max) { return min + Math.random() * (max - min); }

export async function buildRocks() {
  const group = new THREE.Group();
  group.name = 'rocks';

  const drySources = [];
  const mossySources = [];

  await Promise.all(
    ROCK_MODELS.map((name) =>
      loadObjMtl(`${BASE_URL}${name}.obj`, `${BASE_URL}${name}.mtl`)
        .then((m) => {
          const bbox = new THREE.Box3().setFromObject(m);
          const size = new THREE.Vector3();
          bbox.getSize(size);
          const baseHeight = 0.8;
          const scale = size.y > 0 ? baseHeight / size.y : 1;
          m.scale.setScalar(scale);
          m.userData.yOffset = -bbox.min.y * scale;
          
          if (name.includes('Moss')) {
            mossySources.push(m);
          } else {
            drySources.push(m);
          }
        })
        .catch((err) => console.warn(`Rock ${name} skipped:`, err.message))
    )
  );

  if (!drySources.length && !mossySources.length) return group;

  const getMossySource = () => mossySources.length ? mossySources[Math.floor(Math.random() * mossySources.length)] : getDrySource();
  const getDrySource = () => drySources.length ? drySources[Math.floor(Math.random() * drySources.length)] : null;

  function placeRock(src, x, z, scaleMul = 1, sink = 0) {
    if (!src) return;
    const rock = src.clone(true);
    rock.scale.multiplyScalar(scaleMul);
    rock.rotation.y = Math.random() * Math.PI * 2;
    rock.rotation.x = (Math.random() - 0.5) * 0.25;
    rock.rotation.z = (Math.random() - 0.5) * 0.25;
    rock.position.set(x, src.userData.yOffset * scaleMul - sink, z);
    rock.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    group.add(rock);
  }

  function spawnBankCluster(xCenter, cz, hw, side) {
    const baseZ = cz + side * hw;
    
    // 1. Primary Rock (Large anchor boulder)
    const pScale = rand(1.1, 1.8);
    const isMossy = Math.random() < 0.4;
    const srcPrimary = isMossy ? getMossySource() : getDrySource();
    
    const px = xCenter + rand(-0.8, 0.8);
    const zOffset = isMossy ? rand(-0.15, 0.1) * side : rand(0.15, 0.5) * side;
    const pz = baseZ + zOffset;
    const pSink = rand(0.05, 0.15);
    placeRock(srcPrimary, px, pz, pScale, pSink);
    
    // 2. Secondary/Detail Rocks (1 to 3 detail stones)
    const numDetail = Math.floor(rand(1, 4));
    for (let k = 0; k < numDetail; k++) {
      const sScale = pScale * rand(0.35, 0.65);
      
      const angle = rand(0, Math.PI * 2);
      const radius = pScale * rand(0.4, 0.8);
      const sx = px + Math.cos(angle) * radius;
      const sz = pz + Math.sin(angle) * radius;
      
      const isStoneWaterSide = side === -1 ? (sz > baseZ - 0.2) : (sz < baseZ + 0.2);
      const srcDetail = (isStoneWaterSide && Math.random() < 0.7) ? getMossySource() : getDrySource();
      const sSink = rand(0.02, 0.1) * sScale;
      placeRock(srcDetail, sx, sz, sScale, sSink);
    }
  }

  // 1. Organic Rock Clusters along both banks (95% spawn rate every 2.8 units for a dense, continuous border)
  const STEP = 2.8;
  for (let x = RIVER_X_MIN + 3; x <= RIVER_X_MAX - 3; x += STEP) {
    if (Math.abs(x) < BRIDGE_CLEAR) continue;
    
    const nearSpotlight = SPOTLIGHT_X_COORDS.some((sx) => Math.abs(x - sx) < 1.8);
    
    const cz = riverCenter(x);
    const hw = riverHalfWidth(x);
    
    // Left bank cluster
    if (Math.random() < 0.95 && !nearSpotlight) {
      spawnBankCluster(x, cz, hw, -1);
    }
    
    // Right bank cluster
    if (Math.random() < 0.95 && !nearSpotlight) {
      spawnBankCluster(x, cz, hw, 1);
    }
  }

  // 2. Sparse Rock Bars INSIDE the river (riffles/deposition clusters)
  const numRiverBars = Math.floor(rand(5, 8));
  for (let i = 0; i < numRiverBars; i++) {
    let rx;
    do { rx = rand(RIVER_X_MIN + 15, RIVER_X_MAX - 15); } while (Math.abs(rx) < BRIDGE_CLEAR + 2);
    
    const cz = riverCenter(rx);
    const hw = riverHalfWidth(rx);
    const rz = cz + rand(0.55, 0.75) * hw * (Math.random() < 0.5 ? 1 : -1);
    
    // Main submerged boulder
    const mainScale = rand(0.9, 1.4);
    const mainSink = rand(0.2, 0.45);
    placeRock(getMossySource(), rx, rz, mainScale, mainSink);
    
    // Calculate flow tangent for downstream deposition
    const dz_ds = 14 * 0.04 * Math.cos(rx * 0.04) + 3 * 0.11 * Math.cos(rx * 0.11);
    const len = Math.sqrt(1 + dz_ds * dz_ds);
    const tx = 1.0 / len;
    const tz = dz_ds / len;
    
    // Spawn 1 to 2 trailing eddy rocks downstream
    const numTrailing = Math.floor(rand(1, 3));
    for (let k = 0; k < numTrailing; k++) {
      const trailScale = mainScale * rand(0.4, 0.7);
      const dist = mainScale * rand(0.65, 1.2);
      const sideSign = (Math.random() < 0.5 ? 1 : -1);
      
      const tx_pos = rx + tx * dist * sideSign + rand(-0.25, 0.25) * (-tz);
      const tz_pos = rz + tz * dist * sideSign + rand(-0.25, 0.25) * tx;
      const trailSink = rand(0.15, 0.3) * trailScale;
      
      placeRock(getMossySource(), tx_pos, tz_pos, trailScale, trailSink);
    }
  }

  return group;
}
