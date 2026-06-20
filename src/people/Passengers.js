import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLB } from '../utils/loaders.js';

const HUMANS_DIR = 'assets/models/people/';

let passengerWorldHeight = 3.28; // Default fallback height in world units

export function setPassengerWorldHeight(h) {
  passengerWorldHeight = h;
}

export function getPassengerWorldHeight() {
  return passengerWorldHeight;
}


// Park-visitor models (Quaternius) — civilian outfits only, no soldiers/zombies/etc.
export const VISITOR_MODELS = [
  'Casual_Male', 'Casual_Female', 'Casual2_Male', 'Casual2_Female',
  'Casual3_Male', 'Casual3_Female', 'Casual_Bald', 'Suit_Male', 'Suit_Female',
  'Kimono_Male', 'Kimono_Female', 'Worker_Male', 'Worker_Female',
  'OldClassy_Male', 'OldClassy_Female',
];

const ANIM_BONES = [
  'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'Head', 'Torso',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR',
  'FootL', 'FootR',
];

export const ACTIONS_SEATED_GENERAL = ['rest', 'rest', 'lookL', 'lookR', 'lookUp', 'wave', 'point', 'cheer', 'relax'];
export const ACTIONS_SEATED_CHAT_L = ['chatL', 'chatL', 'rest', 'lookR'];   // neighbour sits to this rider's left
export const ACTIONS_SEATED_CHAT_R = ['chatR', 'chatR', 'rest', 'lookL'];
export const ACTIONS_STANDING = ['standRest', 'standRest', 'standWave', 'standCheer', 'standPoint', 'standLook'];

const smoothstep = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Load a handful of random visitor models as reusable templates.
export async function loadVisitorTemplates(count) {
  const picks = shuffle(VISITOR_MODELS).slice(0, count);
  const results = await Promise.allSettled(
    picks.map((name) => loadGLB(`${HUMANS_DIR}${name}.gltf`))
  );
  const templates = [];
  results.forEach((r, idx) => {
    if (r.status !== 'fulfilled') return;
    const root = r.value.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false; // SkinnedMesh bind-pose bbox ignores deformation
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((mat) => {
            if (mat.name === 'Skin') {
              mat.color.setRGB(1.0, 0.88, 0.82); // Light Caucasian skin tone
              mat.roughness = 0.6;
              mat.metalness = 0.0;
            }
            mat.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                '#include <opaque_fragment>',
                '#include <opaque_fragment>\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(1.0));'
              );
            };
          });
        }
      }
    });
    const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 3.3;
    templates.push({ root, height: h, name: picks[idx] });
  });
  return templates;
}

export function collectBones(fig) {
  const map = {};
  const foundBones = [];
  const allBonesInRig = [];
  
  fig.traverse((o) => {
    if (o.isBone) allBonesInRig.push(o.name);
  });
  
  for (const n of ANIM_BONES) {
    let b = fig.getObjectByName(n);
    if (!b) {
      const dottedName = n.replace(/([LR])$/, '.$1');
      b = fig.getObjectByName(dottedName);
    }
    if (!b) {
      const underscoredName = n.replace(/([LR])$/, '_$1');
      b = fig.getObjectByName(underscoredName);
    }
    if (b) {
      map[n] = { bone: b, rest: b.rotation.clone() };
      foundBones.push(n);
    }
  }
  
  return map;
}

// Set a bone to rest-pose + delta Euler (relative) or direct Euler (absolute).
export function pose(bones, name, dx = 0, dy = 0, dz = 0, absolute = false) {
  const e = bones[name];
  if (!e) return;
  if (absolute) {
    e.bone.rotation.set(dx, dy, dz);
  } else {
    e.bone.rotation.set(e.rest.x + dx, e.rest.y + dy, e.rest.z + dz);
  }
}

// Set a bone's rotation via quaternion (bypasses Euler decomposition issues
// caused by mirrored bone local axes in the Quaternius rig).
function poseQ(bones, name, qx, qy, qz, qw) {
  const e = bones[name];
  if (!e) return;
  e.bone.quaternion.set(qx, qy, qz, qw);
}

/* ── Quaternion values extracted from the GLTF "SitDown" animation ──
 *
 * The Quaternius human rig has mirrored bone rolls: left & right leg
 * bones live in different local coordinate systems.  Setting the same
 * Euler angles on both sides does NOT produce a symmetric pose.
 *
 * The artist's own "SitDown" animation stores quaternions that are
 * perfectly symmetric:  same (x, w), negated (y, z).
 * Using those quaternions directly guarantees visual symmetry.
 *
 * Source: last keyframe of "SitDown" animation in Casual_Male.gltf
 *   UpperLeg.L quat = ( 0.822676,  0.006432,  0.004781,  0.568454)
 *   UpperLeg.R quat = ( 0.822676, -0.006433, -0.004780,  0.568454)
 *   LowerLeg.L quat = ( 0.684060,  0.006947,  0.006955,  0.729359)
 *   LowerLeg.R quat = ( 0.684060, -0.006947, -0.006955,  0.729359)
 *   Foot.L     quat = ( 0.000005,  0.702952,  0.711237,  0.000005)
 *   Foot.R     quat = ( 0.000006, -0.702952, -0.711237,  0.000005)
 */

// Chair-seated legs (Tagada style): knees forward, minimal splay.
export function applyChairSeatedLegs(B, scale = 1.0) {
  // Fully-seated pose from the SitDown animation (last keyframe)
  poseQ(B, 'UpperLegL',  0.822676,  0.006432,  0.004781, 0.568454);
  poseQ(B, 'UpperLegR',  0.822676, -0.006433, -0.004780, 0.568454);
  poseQ(B, 'LowerLegL',  0.684060,  0.006947,  0.006955, 0.729359);
  poseQ(B, 'LowerLegR',  0.684060, -0.006947, -0.006955, 0.729359);
  poseQ(B, 'FootL',      0.000005,  0.702952,  0.711237, 0.000005);
  poseQ(B, 'FootR',      0.000006, -0.702952, -0.711237, 0.000005);
}

// Seated leg pose for horse — splayed outwards around the horse body
export function applyHorseSeatedLegs(B, scale = 1.0) {
  // Start from the base seated quaternion then apply splay via
  // a small additional rotation around the bone's local Z axis.
  // splay quaternion:  (0, 0, sin(a/2), cos(a/2))
  const splayAngle = 0.35 + 0.15 * (1.0 / scale); // radians outward
  const halfSplay = splayAngle * 0.5;
  const sz = Math.sin(halfSplay);
  const cz = Math.cos(halfSplay);

  // Base seated upper-leg quaternions (from SitDown animation)
  const ulL = { x: 0.822676, y: 0.006432, z: 0.004781, w: 0.568454 };
  const ulR = { x: 0.822676, y: -0.006433, z: -0.004780, w: 0.568454 };

  // Splay: rotate around local Z. Left leg splays -Z, right leg splays +Z
  // q_result = q_base * q_splay  (local-space post-multiply)
  const splayL = { x: 0, y: 0, z: -sz, w: cz };   // negative Z splay
  const splayR = { x: 0, y: 0, z: sz, w: cz };    // positive Z splay

  poseQ(B, 'UpperLegL', ...qMul(ulL, splayL));
  poseQ(B, 'UpperLegR', ...qMul(ulR, splayR));

  // Lower legs: use seated pose with a small inward wrap
  const wrapAngle = 0.15;
  const halfWrap = wrapAngle * 0.5;
  const wz = Math.sin(halfWrap);
  const cwz = Math.cos(halfWrap);

  const llL = { x: 0.684060, y: 0.006947, z: 0.006955, w: 0.729359 };
  const llR = { x: 0.684060, y: -0.006947, z: -0.006955, w: 0.729359 };

  const wrapL = { x: 0, y: 0, z: -wz, w: cwz };  // wrap inward
  const wrapR = { x: 0, y: 0, z: wz, w: cwz };    // wrap inward (mirrored)

  poseQ(B, 'LowerLegL', ...qMul(llL, wrapL));
  poseQ(B, 'LowerLegR', ...qMul(llR, wrapR));

  // Feet: same as chair-seated
  poseQ(B, 'FootL',  0.000005,  0.702952,  0.711237, 0.000005);
  poseQ(B, 'FootR',  0.000006, -0.702952, -0.711237, 0.000005);
}

// Quaternion multiply: returns [x, y, z, w]
function qMul(a, b) {
  return [
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  ];
}

/* ── Free-foot placement ─────────────────────────────────────────────────────
 * The Quaternius rig keeps Foot.L/R as FREE bones — siblings of the leg chains
 * under the root bone (a Blender IK setup). Rotating UpperLeg/LowerLeg does
 * NOT move the feet, so every leg pose must also PLACE the foot bones at the
 * end of the chains, or the feet stay wherever the GLTF default frame left
 * them (visibly detached on seated/standing riders).
 * ────────────────────────────────────────────────────────────────────────── */

// Flat-on-ground foot orientations in armature space (from the rig's own
// SitDown pose — the bind pose points the feet ballet-style straight down).
const FOOT_FLAT_Q = {
  L: new THREE.Quaternion(0, 0.702952, 0.711237, 0).normalize(),
  R: new THREE.Quaternion(0, -0.702952, -0.711237, 0).normalize(),
};

const _fkM = new THREE.Matrix4();
const _fkS = new THREE.Vector3();
const _fkHip = new THREE.Vector3(), _fkKnee = new THREE.Vector3(), _fkAnkle = new THREE.Vector3();
const _fkQUp = new THREE.Quaternion(), _fkQLo = new THREE.Quaternion(), _fkQInv = new THREE.Quaternion();

// Calibrate the leg chains from the skin bind pose (the GLTF default node
// pose is an arbitrary animation frame — never use it for geometry).
export function calibrateLegRig(fig) {
  const raw = {};
  fig.traverse((o) => { if (o.isBone && !(o.name in raw)) raw[o.name] = o; });
  const find = (n) => raw[n] || raw[n.replace('.', '')] || raw[n.replace('.', '_')] || null;
  const bones = {};
  for (const n of ['UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R']) {
    bones[n] = find(n);
    if (!bones[n]) return null;
  }
  const body = bones['UpperLeg.L'].parent;          // pelvis bone ("Body"/"Body_1")
  if (!body || !body.isBone) return null;
  let skin = null;
  fig.traverse((o) => { if (!skin && o.isSkinnedMesh) skin = o; });
  if (!skin) return null;
  const skel = skin.skeleton;
  const bindWorld = (bone, outP, outQ) => {
    const bi = skel.bones.indexOf(bone);
    if (bi < 0) return false;
    _fkM.copy(skel.boneInverses[bi]).invert();
    _fkM.decompose(outP, outQ, _fkS);
    return true;
  };
  const pB = new THREE.Vector3(), qB = new THREE.Quaternion();
  if (!bindWorld(body, pB, qB)) return null;
  const rig = { body, sides: {} };
  for (const s of ['L', 'R']) {
    const up = bones[`UpperLeg.${s}`], lo = bones[`LowerLeg.${s}`], ft = bones[`Foot.${s}`];
    const pU = new THREE.Vector3(), qU = new THREE.Quaternion();
    const pL = new THREE.Vector3(), qL = new THREE.Quaternion();
    const pF = new THREE.Vector3(), qF = new THREE.Quaternion();
    if (!bindWorld(up, pU, qU) || !bindWorld(lo, pL, qL) || !bindWorld(ft, pF, qF)) return null;
    rig.sides[s] = {
      up, lo, ft,
      // knee→ankle offset in LowerLeg space — exact, from the bind pose
      ankleOff: pF.clone().sub(pL).applyQuaternion(qL.clone().invert()),
      bindUpWorld: qU.clone(),                     // straight legs (bind = standing)
      bindLoLocal: qU.clone().invert().multiply(qL),
      flat: FOOT_FLAT_Q[s],
    };
  }
  return rig;
}

// Forward kinematics: put each free Foot bone at the end of its (already
// posed) leg chain. Works in the root bone's frame (feet and pelvis share it).
export function placeFeet(rig) {
  if (!rig) return;
  const body = rig.body;
  for (const s of ['L', 'R']) {
    const S = rig.sides[s];
    _fkQUp.copy(body.quaternion).multiply(S.up.quaternion);
    _fkQLo.copy(_fkQUp).multiply(S.lo.quaternion);
    _fkHip.copy(S.up.position).applyQuaternion(body.quaternion).add(body.position);
    _fkKnee.copy(S.lo.position).applyQuaternion(_fkQUp).add(_fkHip);
    _fkAnkle.copy(S.ankleOff).applyQuaternion(_fkQLo).add(_fkKnee);
    S.ft.position.copy(_fkAnkle);
  }
}

// Straight standing legs + flat feet (the GLTF default pose is a mid-walk
// frame with a bent knee — never use it as a standing pose).
export function applyStandingLegs(rig) {
  if (!rig) return;
  for (const s of ['L', 'R']) {
    const S = rig.sides[s];
    S.up.quaternion.copy(_fkQInv.copy(rig.body.quaternion).invert()).multiply(S.bindUpWorld);
    S.lo.quaternion.copy(S.bindLoLocal);
    S.ft.quaternion.copy(S.flat);
  }
}

const UPPER_BONES = ['UpperArmR', 'UpperArmL', 'LowerArmR', 'LowerArmL', 'Head', 'Torso'];

const REST_UPPER = {
  UpperArmR: [0.55, 0, 0.10], UpperArmL: [0.55, 0, -0.10],
  LowerArmR: [0.45, 0, 0], LowerArmL: [0.45, 0, 0],
  Head: [0, 0, 0], Torso: [0, 0, 0],
};

const POSE_DEFS = {
  rest:   {},
  lookL:  { Head: [0.05, 0.6, 0], Torso: [0, 0.18, 0] },
  lookR:  { Head: [0.05, -0.6, 0], Torso: [0, -0.18, 0] },
  lookUp: { Head: [-0.45, 0.1, 0], Torso: [-0.08, 0, 0] },
  wave:   { UpperArmR: [0.2, 1.9, -0.2], LowerArmR: [1.1, 0, 0], Head: [0, 0.2, 0] },
  cheer:  { UpperArmR: [0.2, 2.2, -0.2], UpperArmL: [-0.2, -2.2, 0.2], LowerArmR: [0.8, 0, 0], LowerArmL: [0.8, 0, 0], Head: [-0.06, 0, 0] },
  point:  { UpperArmR: [0.1, 1.45, 0], Head: [0, 0.32, 0], Torso: [0, 0.1, 0] },
  photo:  { UpperArmR: [1.0, 0.4, 0.25], UpperArmL: [1.0, -0.4, -0.25],
            LowerArmR: [0.8, 0, 0], LowerArmL: [0.8, 0, 0], Head: [-0.12, 0, 0] },
  relax:  { UpperArmR: [0.15, 1.05, 0], Head: [0.06, -0.2, 0], Torso: [0.05, -0.05, 0] },
  // Carousel: both hands forward on the vertical pole, elbows soft.
  holdPole: { UpperArmR: [1.15, -0.28, 0.1], UpperArmL: [1.15, 0.28, -0.1],
              LowerArmR: [0.5, 0, 0], LowerArmL: [0.5, 0, 0],
              Torso: [0.07, 0, 0], Head: [0.02, 0, 0] },
  chatL:  { UpperArmR: [0.4, 0.8, 0], LowerArmR: [0.8, 0, 0], Head: [0.1, 0.5, 0], Torso: [0.1, 0.14, 0] },
  chatR:  { UpperArmL: [-0.4, -0.8, 0], LowerArmL: [0.8, 0, 0], Head: [0.1, -0.5, 0], Torso: [0.1, -0.14, 0] },

  // Standing poses
  standRest: {
    Torso: [0.15, 0, 0], Head: [0.05, 0, 0],
    UpperArmR: [0.4, 0.2, 0], UpperArmL: [0.4, -0.2, 0],
    LowerArmR: [0.5, 0, 0], LowerArmL: [0.5, 0, 0]
  },
  standWave: {
    Torso: [0.10, 0, 0], Head: [0, 0.2, 0],
    UpperArmR: [0.2, 1.9, -0.2], LowerArmR: [1.1, 0, 0],
    UpperArmL: [0.4, -0.2, 0], LowerArmL: [0.5, 0, 0]
  },
  standCheer: {
    Torso: [0.05, 0, 0], Head: [-0.06, 0, 0],
    UpperArmR: [0.2, 2.2, -0.2], UpperArmL: [-0.2, -2.2, 0.2],
    LowerArmR: [0.8, 0, 0], LowerArmL: [0.8, 0, 0]
  },
  standPoint: {
    Torso: [0.12, 0.1, 0], Head: [0, 0.32, 0],
    UpperArmR: [0.1, 1.45, 0],
    UpperArmL: [0.4, -0.2, 0], LowerArmL: [0.5, 0, 0]
  },
  standLook: {
    Torso: [0.28, 0, 0], Head: [0.25, 0.4, 0],
    UpperArmR: [0.5, 0.15, 0], UpperArmL: [0.5, -0.15, 0],
    LowerArmR: [0.6, 0, 0], LowerArmL: [0.6, 0, 0]
  }
};

const POSES = {};
for (const k in POSE_DEFS) {
  POSES[k] = { ...REST_UPPER };
  for (const b in POSE_DEFS[k]) POSES[k][b] = POSE_DEFS[k][b];
}

export function positionRiderOnHip(rider, template, targetHipPos, scale) {
  rider.fig.updateMatrixWorld(true);
  const hipBone = rider.fig.getObjectByName('Hips');
  if (hipBone) {
    const localHip = new THREE.Vector3();
    hipBone.getWorldPosition(localHip);
    rider.fig.worldToLocal(localHip);
    const scaledHip = localHip.clone().multiplyScalar(scale);
    const hipInParent = scaledHip.clone().applyQuaternion(rider.pivot.quaternion);
    rider.pivot.position.set(
      targetHipPos.x - hipInParent.x,
      targetHipPos.y - hipInParent.y,
      targetHipPos.z - hipInParent.z
    );
  } else {
    const riderHeight = template.height * scale;
    const fallbackLocalHip = new THREE.Vector3(0, riderHeight * 0.28, 0);
    const hipInParent = fallbackLocalHip.applyQuaternion(rider.pivot.quaternion);
    rider.pivot.position.set(
      targetHipPos.x - hipInParent.x,
      targetHipPos.y - hipInParent.y,
      targetHipPos.z - hipInParent.z
    );
  }
}

export function makeRider(template, height, { pool, facingY = 0, phase = 0, standing = false, seatedStyle = 'chair' }) {
  const pivot = new THREE.Group();             // gentle body sway lives here
  const fig = cloneSkinned(template.root);
  const scale = height / template.height;
  fig.scale.setScalar(scale);
  fig.rotation.y = facingY;
  pivot.add(fig);
  return {
    pivot, fig, bones: collectBones(fig), legRig: calibrateLegRig(fig),
    pool, phase, standing, scale, seatedStyle,
    height,
    from: pool.includes('rest') || pool.includes('standRest') ? (pool.includes('standRest') ? 'standRest' : 'rest') : pool[0],
    to: pick(pool), tStart: 0, transDur: 0.7,
    nextSwitch: phase * 0.7 + Math.random() * 3, // stagger first switch
    restZ: pivot.rotation.z,
  };
}

// Advance the rider's state-machine and pose its bones for absolute time t.
export function updateRider(r, t) {
  if (t >= r.nextSwitch) {
    r.from = r.to;
    r.to = pick(r.pool);
    r.tStart = t;
    r.nextSwitch = t + r.transDur + 2.5 + Math.random() * 4; // hold 2.5–6.5 s
  }
  const k = smoothstep(Math.min((t - r.tStart) / r.transDur, 1)); // eased blend
  const B = r.bones;

  if (r.standing) {
    if (r.legRig) {
      applyStandingLegs(r.legRig);             // straight bind legs + flat feet
    } else {
      pose(B, 'UpperLegL', 0, 0, 0);
      pose(B, 'UpperLegR', 0, 0, 0);
      pose(B, 'LowerLegL', 0, 0, 0);
      pose(B, 'LowerLegR', 0, 0, 0);
    }
  } else {
    // Seated legs
    if (r.seatedStyle === 'horse') {
      applyHorseSeatedLegs(B, r.scale);
    } else {
      applyChairSeatedLegs(B, r.scale);
    }
  }
  placeFeet(r.legRig);                         // free Foot bones follow the chain

  const A = POSES[r.from], C = POSES[r.to];
  for (const bn of UPPER_BONES) {
    const a = A[bn], c = C[bn];
    let dx = lerp(a[0], c[0], k), dy = lerp(a[1], c[1], k), dz = lerp(a[2], c[2], k);
    if (bn === 'Torso') dx += Math.sin(t * 1.1 + r.phase) * 0.02;  // breathing
    if (bn === 'Head') dy += Math.sin(t * 0.5 + r.phase) * 0.04;   // idle micro-glance
    pose(B, bn, dx, dy, dz);
  }

  // Live flair on the active action (eased in by k so it doesn't pop on transition).
  if (r.to === 'wave' || r.to === 'standWave') {
    pose(B, 'UpperArmR', 0.2 + Math.sin(t * 3) * 0.05 * k, 1.9 + Math.sin(t * 3) * 0.05 * k, -0.2);
    pose(B, 'LowerArmR', 1.1, Math.sin(t * 10) * 0.35 * k, Math.sin(t * 10) * 0.35 * k);
    pose(B, 'Head', 0, 0.2 + Math.sin(t * 2) * 0.08 * k, 0);
  } else if (r.to === 'cheer' || r.to === 'standCheer') {
    const pump = Math.sin(t * 8) * 0.2 * k;
    pose(B, 'UpperArmR', 0.2 + pump, 2.2 + pump * 0.5, -0.2);
    pose(B, 'UpperArmL', -0.2 - pump, -2.2 - pump * 0.5, 0.2);
    pose(B, 'LowerArmR', 0.8 + pump, 0, 0);
    pose(B, 'LowerArmL', 0.8 + pump, 0, 0);
    pose(B, 'Torso', 0.05 + Math.sin(t * 8) * 0.04 * k, 0, 0);
  } else if (r.to === 'chatL') {
    pose(B, 'UpperArmR', 0.4 + Math.sin(t * 2.0) * 0.1 * k, 0.8 + Math.sin(t * 2.0) * 0.1 * k, 0);
    pose(B, 'LowerArmR', 0.8 + Math.sin(t * 4.0) * 0.3 * k, 0, 0);
    pose(B, 'Head', 0.1, 0.5 + Math.sin(t * 2.0) * 0.1 * k, Math.sin(t * 3.0) * 0.05 * k);
    pose(B, 'Torso', 0.1 + Math.sin(t * 1.0) * 0.03 * k, 0.14, 0);
  } else if (r.to === 'chatR') {
    pose(B, 'UpperArmL', -0.4 - Math.sin(t * 2.0) * 0.1 * k, -0.8 - Math.sin(t * 2.0) * 0.1 * k, 0);
    pose(B, 'LowerArmL', 0.8 + Math.sin(t * 4.0) * 0.3 * k, 0, 0);
    pose(B, 'Head', 0.1, -0.5 - Math.sin(t * 2.0) * 0.1 * k, Math.sin(t * 3.0) * 0.05 * k);
    pose(B, 'Torso', 0.1 + Math.sin(t * 1.0) * 0.03 * k, -0.14, 0);
  } else if (r.to === 'standLook') {
    pose(B, 'Head', 0.25, 0.4 + Math.sin(t * 1.5) * 0.3 * k, 0);
    pose(B, 'Torso', 0.28 + Math.sin(t * 1.0) * 0.04 * k, 0, 0);
  } else if (r.to === 'standRest') {
    pose(B, 'Head', 0.05 + Math.sin(t * 0.8) * 0.05 * k, Math.sin(t * 0.4) * 0.1 * k, 0);
  } else if (r.to === 'standPoint') {
    pose(B, 'UpperArmR', 0.1, 1.5 + Math.sin(t * 2.5) * 0.04 * k, -0.1);
    pose(B, 'LowerArmR', 0.2, 0, 0);
    pose(B, 'UpperArmL', 0.3, -0.3, 0);
    pose(B, 'LowerArmL', 0.6, 0, 0);
    pose(B, 'Head', 0.1, 0.35 + Math.sin(t * 2.5) * 0.05 * k, 0);
  }
}
