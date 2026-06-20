import * as THREE from 'three';
import { loadColorTexture, loadLinearTexture } from '../utils/loaders.js';

const TEX_BASE = 'assets/textures/grass/';

export function buildGround({ anisotropy = 8 } = {}) {
  const repeat = [40, 40];

  const map = loadColorTexture(`${TEX_BASE}color.jpg`, { repeat, anisotropy });
  const displacementMap = loadLinearTexture(`${TEX_BASE}displacement.png`, { repeat, anisotropy });

  const material = new THREE.MeshStandardMaterial({
    map,
    bumpMap: displacementMap,
    bumpScale: 0.4,
    roughness: 0.95,
    metalness: 0.0,
  });

  const geometry = new THREE.PlaneGeometry(200, 200, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
