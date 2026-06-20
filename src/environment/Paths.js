import * as THREE from 'three';
import { loadColorTexture, loadLinearTexture, loadGLB, sanitizeMaterials } from '../utils/loaders.js';
import { riverCenter, riverHalfWidth, RIVER_X_MIN, RIVER_X_MAX } from '../utils/riverConstants.js';

const TEX_BASE = 'assets/textures/asphalt/';
const BRIDGE_URL = 'assets/models/environment/bridge.glb';

function makeAsphaltMaterial({ repeat, anisotropy }) {
  const map = loadColorTexture(`${TEX_BASE}color.jpg`, { repeat, anisotropy });
  const roughnessMap = loadLinearTexture(`${TEX_BASE}roughness.jpg`, { repeat, anisotropy });
  const displacementMap = loadLinearTexture(`${TEX_BASE}displacement.png`, { repeat, anisotropy });

  return new THREE.MeshStandardMaterial({
    map,
    roughnessMap,
    bumpMap: displacementMap,
    bumpScale: 0.15,
    roughness: 1.0,
    metalness: 0.0,
  });
}

export async function buildPaths({ anisotropy = 8 } = {}) {
  const group = new THREE.Group();
  group.name = 'paths';

  const pathY = 0.05;

  // Split NS path into North and South segments, leaving a space at Z=0 for the East-West river
  const matNS = makeAsphaltMaterial({ repeat: [1, 14], anisotropy });
  const pathN = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), matNS);
  pathN.rotation.x = -Math.PI / 2;
  pathN.position.set(0, pathY, -55);
  pathN.receiveShadow = true;
  group.add(pathN);

  const pathS = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), matNS);
  pathS.rotation.x = -Math.PI / 2;
  pathS.position.set(0, pathY, 55);
  pathS.receiveShadow = true;
  group.add(pathS);

  // Decorative central bridge (model) over the East-West river
  try {
    const gltf = await loadGLB(BRIDGE_URL);
    const bridge = gltf.scene;
    bridge.name = 'japanese_bridge';
    sanitizeMaterials(bridge);

    const bbox = new THREE.Box3().setFromObject(bridge);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const targetLength = 22.0; // long enough to cross the river with nice margin
    const targetWidth = 6.0;   // matching the walking path width (6m)
    const targetHeight = 5.0;  // proportionate to 3.28m human models

    // Rotate so long axis runs along Z (NS path crosses EW river).
    const longAxisIsX = size.x >= size.z;
    bridge.rotation.y = longAxisIsX ? Math.PI / 2 : 0;

    // Scale non-uniformly based on orientation
    if (longAxisIsX) {
      bridge.scale.set(
        targetLength / size.x,
        targetHeight / size.y,
        targetWidth / size.z
      );
    } else {
      bridge.scale.set(
        targetWidth / size.x,
        targetHeight / size.y,
        targetLength / size.z
      );
    }

    // Recenter and place base on the path ground
    bridge.position.set(0, 0, 0);
    bridge.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(bridge);
    const postCenter = new THREE.Vector3();
    scaledBox.getCenter(postCenter);

    bridge.position.set(
      -postCenter.x,
      pathY - scaledBox.min.y,
      -postCenter.z
    );

    bridge.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(bridge);
  } catch (e) {
    console.error("Failed to load bridge", e);
  }

  return group;
}
