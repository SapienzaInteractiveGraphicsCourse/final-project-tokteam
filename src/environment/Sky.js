import * as THREE from 'three';
import { loadHDR } from '../utils/loaders.js';

// 4 HDR equirect maps for time-of-day. A custom sky-sphere shader samples two of them
// at once and crossfades by a `uMix` uniform so the slider produces a smooth transition
// across the full 24-hour cycle. PMREM-baked env maps drive PBR IBL; we snap to the
// nearer preset (env can't be cheaply crossfaded in Three.js).

// Anchor hours tuned so each preset has a plausible dwell.
// Night holds [0..4] + [20..24], sunrise rises [4..7], day plateaus [7..17],
// sunset descends [17..20]. The crossfade between anchors is eased separately.
const PRESETS = [
  { name: 'night_a',  hour: 0,   url: 'assets/hdr/night.hdr'   },
  { name: 'night_a2', hour: 4,   url: 'assets/hdr/night.hdr'   },
  { name: 'sunrise',  hour: 7,   url: 'assets/hdr/sunrise.hdr' },
  { name: 'day',      hour: 9,   url: 'assets/hdr/day.hdr'     },
  { name: 'day_b',    hour: 16,  url: 'assets/hdr/day.hdr'     },
  { name: 'sunset',   hour: 19,  url: 'assets/hdr/sunset.hdr'  },
  { name: 'night_b',  hour: 21,  url: 'assets/hdr/night.hdr'   },
  { name: 'night_b2', hour: 24,  url: 'assets/hdr/night.hdr'   },
];

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    // Anchor the sky to the camera (translation-free) — large sphere otherwise drifts.
    mat4 viewNoTranslate = mat4(modelViewMatrix);
    viewNoTranslate[3] = vec4(0.0, 0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * viewNoTranslate * vec4(position, 1.0);
    // Force depth = 1 so sky is always behind everything.
    gl_Position.z = gl_Position.w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform float uMix;
  varying vec3 vDir;
  #define PI 3.14159265359
  vec2 dirToUv(vec3 d) {
    // Equirectangular mapping (Three.js convention).
    float u = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
    return vec2(u, v);
  }
  void main() {
    vec3 d = normalize(vDir);
    vec2 uv = dirToUv(d);
    vec3 colA = texture2D(uTexA, uv).rgb;
    vec3 colB = texture2D(uTexB, uv).rgb;
    vec3 col = mix(colA, colB, clamp(uMix, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    // Tone mapping and color-space conversion are handled by EffectComposer's
    // OutputPass (ACESFilmicToneMapping + SRGBColorSpace) — do NOT include them
    // here or the sky will be double-tone-mapped and appear washed out.
  }
`;

export async function buildSky(scene, renderer) {
  // Deduplicate so we only load each unique HDR once.
  const uniqueUrls = [...new Set(PRESETS.map(p => p.url))];
  const loaded = await Promise.all(uniqueUrls.map(loadHDR));
  loaded.forEach((tex) => { tex.mapping = THREE.EquirectangularReflectionMapping; });
  const hdrByUrl = Object.fromEntries(uniqueUrls.map((u, i) => [u, loaded[i]]));

  // Anchor → texture mapping (anchors may share textures).
  const hdrs = PRESETS.map(p => hdrByUrl[p.url]);

  // Bake one PMREM per unique HDR (shared by anchors with the same URL).
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envByUrl = Object.fromEntries(
    uniqueUrls.map((u) => [u, pmrem.fromEquirectangular(hdrByUrl[u]).texture])
  );
  pmrem.dispose();
  const envs = PRESETS.map(p => envByUrl[p.url]);

  // Sky-sphere material with two HDR samples + crossfade.
  const dayIdx = PRESETS.findIndex(p => p.name === 'day');
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTexA: { value: hdrs[dayIdx] },
      uTexB: { value: hdrs[dayIdx] },
      uMix:  { value: 0.0 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: false,
    toneMapped: true,
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  skyMesh.name = 'sky';
  skyMesh.renderOrder = -1000;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  // No scene.background — sky sphere covers it.
  scene.background = null;
  scene.environment = envs[dayIdx];
  scene.backgroundIntensity = 1.0;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 1.0;

  let lastEnvIdx = dayIdx;

  // Map t01 → (anchorA, anchorB, mix) across the 5-anchor calendar so 00:00 and 24:00 both equal night.
  function setTime(t01) {
    const h = t01 * 24;
    // Find pair of anchors flanking h.
    let i = 0;
    while (i < PRESETS.length - 1 && PRESETS[i + 1].hour <= h) i++;
    const a = PRESETS[i];
    const b = PRESETS[Math.min(i + 1, PRESETS.length - 1)];
    const span = Math.max(1e-6, b.hour - a.hour);
    const m = THREE.MathUtils.clamp((h - a.hour) / span, 0, 1);

    // Smoothstep so the crossfade eases in/out instead of going linearly.
    const mix = m * m * (3 - 2 * m);

    material.uniforms.uTexA.value = hdrs[i];
    material.uniforms.uTexB.value = hdrs[Math.min(i + 1, hdrs.length - 1)];
    material.uniforms.uMix.value = mix;

    // Snap env IBL to whichever anchor we're closer to.
    const envIdx = mix < 0.5 ? i : Math.min(i + 1, envs.length - 1);
    if (envIdx !== lastEnvIdx) {
      lastEnvIdx = envIdx;
      scene.environment = envs[envIdx];
    }
  }

  return { setTime, hdrs, envs, material };
}
