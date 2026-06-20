import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
gltfLoader.register(function () {
  return { name: 'KHR_materials_pbrSpecularGlossiness' };
});
const rgbeLoader = new RGBELoader();

export function loadColorTexture(url, { repeat = [1, 1], anisotropy = 8 } = {}) {
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  return tex;
}

export function loadLinearTexture(url, { repeat = [1, 1], anisotropy = 8 } = {}) {
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  return tex;
}

export function sanitizeMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const fixed = mats.map((m) => {
      const std = new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null, // preserve texture maps since MTL sometimes uses them
        normalMap: m.normalMap || null,
        roughnessMap: m.roughnessMap || null,
        metalnessMap: m.metalnessMap || null,
        emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
        emissiveMap: m.emissiveMap || null,
        emissiveIntensity: m.emissiveIntensity != null ? m.emissiveIntensity : 1,
        roughness: m.roughness != null ? m.roughness : 0.9,
        metalness: m.metalness != null ? m.metalness : 0.0,
        // alphaTest handles foliage cutout in the OPAQUE pass; flagging every
        // textured material `transparent` pushed most of the scene into the
        // sorted transparent pass (no early-Z, sorting artifacts on foliage).
        transparent: m.transparent === true,
        opacity: m.opacity != null ? m.opacity : 1,
        alphaTest: m.alphaTest || (m.map ? 0.5 : 0),
        side: m.side != null ? m.side : THREE.DoubleSide, // useful for foliage
        name: m.name,
      });
      return std;
    });
    o.material = Array.isArray(o.material) ? fixed : fixed[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

// Strip any keyframe animations from the imported GLB — this project's policy is that
// every animation must be written by us (procedural). The bone hierarchy stays so we can
// still drive bones manually.
export function loadGLB(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        gltf.animations = [];
        resolve(gltf);
      },
      undefined,
      reject
    );
  });
}

export async function loadObjMtl(objUrl, mtlUrl) {
  const mtlLoader = new MTLLoader();
  const materials = await new Promise((resolve, reject) => {
    mtlLoader.load(mtlUrl, resolve, undefined, reject);
  });
  materials.preload();
  
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  
  const group = await new Promise((resolve, reject) => {
    objLoader.load(objUrl, resolve, undefined, reject);
  });
  
  sanitizeMaterials(group);
  return group;
}

export function loadHDR(url) {
  return new Promise((resolve, reject) => {
    rgbeLoader.load(url, resolve, undefined, reject);
  });
}
