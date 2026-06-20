import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { isNightNow } from '../lighting/DayNightCycle.js';
import { eventBus } from '../utils/EventBus.js';
import TWEEN from '@tweenjs/tween.js';
import { Easings } from '../utils/Easings.js';

const FENCE_URL = 'assets/models/environment/fence.glb';
const HALF = 100;
const SEG_LEN = 4.0;

function bakeSourceToSingleMesh(root) {
  const geos = [];
  let mat = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
    if (!mat && o.material) mat = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  if (!geos.length) return null;
  for (const g of geos) {
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    }
  }
  const merged = mergeGeometries(geos, false);
  // Recenter on XZ — source model may have its origin at one end of the segment.
  // Without this, segment world origin is not the segment centre and adjacent placements leave gaps.
  const cbb = new THREE.Box3().setFromBufferAttribute(merged.attributes.position);
  const cx = (cbb.min.x + cbb.max.x) / 2;
  const cz = (cbb.min.z + cbb.max.z) / 2;
  merged.translate(-cx, 0, -cz);
  return { geometry: merged, material: mat };
}

export async function buildFence() {
  const group = new THREE.Group();
  group.name = 'fence';

  const gltf = await loadGLB(FENCE_URL);
  sanitizeMaterials(gltf.scene);

  const baked = bakeSourceToSingleMesh(gltf.scene);
  if (!baked) return group;

  const bbox = new THREE.Box3().setFromBufferAttribute(baked.geometry.attributes.position);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const sourceLen = Math.max(size.x, size.z);
  const scale = sourceLen > 0 ? SEG_LEN / sourceLen : 1;
  const alongX = size.x >= size.z;
  const minY = bbox.min.y * scale;

  const count = Math.floor((HALF * 2) / SEG_LEN);
  const start = -HALF + SEG_LEN / 2;
  const totalInstances = count * 4;

  const inst = new THREE.InstancedMesh(baked.geometry, baked.material, totalInstances);
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.name = 'fence_instanced';

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const s = new THREE.Vector3(scale, scale, scale);

  let idx = 0;
  function place(x, z, rotY) {
    let rot = rotY;
    if (!alongX) rot += Math.PI / 2;
    pos.set(x, -minY, z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    m.compose(pos, quat, s);
    inst.setMatrixAt(idx++, m);
  }

  // offset start by half a segment to perfectly fit 200x200
  for (let i = 0; i < count; i++) {
    const t = start + i * SEG_LEN;
    
    // Wider gap at the south entrance — entrance gate sits here, must not overlap fence.
    if (Math.abs(t) < 12) {
        place(t, -HALF, 0); // only build north wall here
        place( HALF, t, Math.PI / 2); // east wall
        place(-HALF, t, Math.PI / 2); // west wall
        continue;
    }

    place(t, -HALF, 0); // North
    place(t,  HALF, 0); // South (gap already skipped)
    place( HALF, t, Math.PI / 2); // East
    place(-HALF, t, Math.PI / 2); // West
  }
  inst.count = idx; // Update actual instance count
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);

  // Corner posts — close the gap at each of the 4 corners.
  const cornerHeight = (bbox.max.y - bbox.min.y) * scale * 1.15;
  const cornerMat = new THREE.MeshStandardMaterial({ color: 0xa67b4a, roughness: 0.9, metalness: 0.0 });
  const cornerGeo = new THREE.BoxGeometry(0.5, cornerHeight, 0.5);
  for (const [cx, cz] of [[-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF]]) {
    const post = new THREE.Mesh(cornerGeo, cornerMat);
    post.position.set(cx, cornerHeight / 2, cz);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }

  // ── String lights along the top of the fence ──
  const fenceTop = (bbox.max.y - bbox.min.y) * scale;
  const fenceLights = new THREE.Group();
  fenceLights.name = 'fenceLights';
  group.add(fenceLights);

  // 1940 wire segments, 258 bulbs max
  const wireGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5);
  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x151515,
    roughness: 0.8,
    metalness: 0.2
  });
  const wireInst = new THREE.InstancedMesh(wireGeo, wireMat, 1940);
  wireInst.castShadow = true;
  group.add(wireInst);

  const socketGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.1, 6);
  const socketMat = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.7,
    metalness: 0.2
  });
  const socketInst = new THREE.InstancedMesh(socketGeo, socketMat, 258);
  socketInst.castShadow = true;
  group.add(socketInst);

  const lightGeo = new THREE.SphereGeometry(0.075, 8, 8);
  const bulbs = [];

  // Helper variables for placing cylinders in 3D
  const _dir = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _q = new THREE.Quaternion();
  const _sc = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  function placeCylinderBetween(instMesh, idx, p1, p2, radius) {
    _dir.subVectors(p2, p1);
    const len = _dir.length();
    _dir.normalize();

    _mid.addVectors(p1, p2).multiplyScalar(0.5);
    _q.setFromUnitVectors(_up, _dir);
    _sc.set(radius, len, radius);

    _m.compose(_mid, _q, _sc);
    instMesh.setMatrixAt(idx, _m);
  }

  function getPointAt(wallType, s, constantVal) {
    const pLeft = Math.floor(s / 4.0) * 4.0;
    const t_local = (s - pLeft) / 4.0;

    const wave = Math.sin(t_local * Math.PI);

    const sag = 0.35 + 0.1 * Math.sin(s * 0.15);
    const noise = 0.03 * Math.sin(s * 1.7) + 0.015 * Math.cos(s * 3.1);
    const y = fenceTop - (sag + noise) * wave;

    const sway = (0.05 * Math.sin(s * 0.9) + 0.02 * Math.cos(s * 2.3)) * wave;

    const pt = new THREE.Vector3();
    if (wallType === 'north' || wallType === 'south1' || wallType === 'south2') {
      pt.set(s, y, constantVal + sway);
    } else {
      pt.set(constantVal + sway, y, s);
    }
    return pt;
  }

  let wireIdx = 0;
  let socketIdx = 0;
  const fenceColor = new THREE.Color(0xffaa44);

  function createWallLights(wallType, sStart, sEnd, constantVal) {
    const length = Math.abs(sEnd - sStart);

    const wireStep = 0.4;
    const numSteps = Math.ceil(length / wireStep);
    for (let i = 0; i < numSteps; i++) {
      const s1 = sStart + i * (length / numSteps);
      const s2 = sStart + (i + 1) * (length / numSteps);
      const p1 = getPointAt(wallType, s1, constantVal);
      const p2 = getPointAt(wallType, s2, constantVal);

      placeCylinderBetween(wireInst, wireIdx++, p1, p2, 1.0);
    }

    const bulbSpacing = 3.0;
    const numBulbs = Math.floor(length / bulbSpacing);
    for (let i = 0; i < numBulbs; i++) {
      const s = sStart + (i + 0.5) * (length / numBulbs) + 0.3 * Math.sin(i * 2.3);
      const sClamped = Math.max(sStart + 0.2, Math.min(sEnd - 0.2, s));
      const p = getPointAt(wallType, sClamped, constantVal);

      const sm = new THREE.Matrix4();
      const sp = new THREE.Vector3(p.x, p.y - 0.05, p.z);
      const sq = new THREE.Quaternion();
      const ss = new THREE.Vector3(1, 1, 1);
      sm.compose(sp, sq, ss);
      socketInst.setMatrixAt(socketIdx++, sm);

      const bulbMat = new THREE.MeshStandardMaterial({
        color: fenceColor,
        emissive: fenceColor,
        emissiveIntensity: 0.0,
        roughness: 0.5,
        metalness: 0.1
      });
      const bulbMesh = new THREE.Mesh(lightGeo, bulbMat);
      bulbMesh.position.set(p.x, p.y - 0.12, p.z);
      fenceLights.add(bulbMesh);

      bulbs.push({
        mat: bulbMat,
        phase: i * 0.7
      });
    }
  }

  createWallLights('north', -HALF, HALF, -HALF);
  createWallLights('east', -HALF, HALF, HALF);
  createWallLights('west', -HALF, HALF, -HALF);
  createWallLights('south1', 12, HALF, HALF);
  createWallLights('south2', -HALF, -12, HALF);

  wireInst.count = wireIdx;
  wireInst.instanceMatrix.needsUpdate = true;

  socketInst.count = socketIdx;
  socketInst.instanceMatrix.needsUpdate = true;
  eventBus.on('color-change', (hex) => {
    const target = new THREE.Color(hex);
    new TWEEN.Tween(fenceColor)
      .to(target, 500)
      .easing(Easings.COLOR)
      .onUpdate(() => {
        for (const b of bulbs) {
          b.mat.color.copy(fenceColor);
          b.mat.emissive.copy(fenceColor);
        }
      })
      .start();
  });

  let nightMix = 0;

  group.userData.tick = (delta, time) => {
    const night = isNightNow(group);
    nightMix += ((night ? 1.0 : 0.0) - nightMix) * (1.0 - Math.exp(-3.0 * delta));

    for (const b of bulbs) {
      const twinkle = 0.5 + 1.5 * Math.sin(time * 3.0 + b.phase);
      b.mat.emissiveIntensity = nightMix * twinkle * 2.5;
    }
  };

  return group;
}
