import * as THREE from 'three';
import { loadGLB, sanitizeMaterials } from '../utils/loaders.js';

const BENCH_URL = 'assets/models/environment/bench.glb';

function enableShadows(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

export async function buildBenches() {
  const group = new THREE.Group();
  group.name = 'benches';

  const gltf = await loadGLB(BENCH_URL);
  const source = gltf.scene;
  sanitizeMaterials(source);

  const bbox = new THREE.Box3().setFromObject(source);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const targetHeight = 1.55; // proportioned to 3.28m human models
  const scale = size.y > 0 ? targetHeight / size.y : 1;
  const groundOffset = -bbox.min.y * scale;

  source.scale.setScalar(scale);
  enableShadows(source);

  const PLACEMENTS = [];
  
  // Placed halfway between lamps
  const dist = [35, 60];
  
  // North path, East and West side (exluding the one near the stage)
  for(let z of dist) {
    PLACEMENTS.push([4.0, groundOffset, -z, -Math.PI / 2]);
    PLACEMENTS.push([-4.0, groundOffset, -z, Math.PI / 2]);
  }
  // South path, East and West side
  for(let z of [35, 60, 85]) {
    PLACEMENTS.push([4.0, groundOffset, z, -Math.PI / 2]);
    PLACEMENTS.push([-4.0, groundOffset, z, Math.PI / 2]);
  }

  for (let i = 0; i < PLACEMENTS.length; i++) {
    const [x, y, z, rotY] = PLACEMENTS[i];
    const bench = source.clone(true);
    bench.name = `bench_${i}`;
    bench.position.set(x, y, z);
    bench.rotation.y = rotY;
    group.add(bench);
  }

  return group;
}
