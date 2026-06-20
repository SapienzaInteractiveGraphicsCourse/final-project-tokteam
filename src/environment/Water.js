import * as THREE from 'three';
import { riverCenter, riverHalfWidth, RIVER_X_MIN, RIVER_X_MAX } from '../utils/riverConstants.js';

const RIVER_Y = 0.25;

function buildRiverSurfaceGeometry() {
  const segmentsAlongX = 320;
  const segmentsAcross = 16;
  const positions = [];
  const indices = [];
  const uvs = [];
  for (let i = 0; i <= segmentsAlongX; i++) {
    const t = i / segmentsAlongX;
    const x = RIVER_X_MIN + t * (RIVER_X_MAX - RIVER_X_MIN);
    const cz = riverCenter(x);
    const hw = riverHalfWidth(x);
    for (let j = 0; j <= segmentsAcross; j++) {
      const s = j / segmentsAcross;
      const z = cz + (s * 2 - 1) * hw;
      positions.push(x, 0, z);
      uvs.push(t, s);
    }
  }
  const rowLen = segmentsAcross + 1;
  for (let i = 0; i < segmentsAlongX; i++) {
    for (let j = 0; j < segmentsAcross; j++) {
      const a = i * rowLen + j;
      const b = a + 1;
      const c = (i + 1) * rowLen + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uRipples[8]; // x, z, age, intensity
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  vec3 sinWave(vec3 pos, vec2 dir, float wavelength, float amp, float speed, float t) {
    float k = 6.2831853 / wavelength;
    float phase = k * dot(dir, pos.xz) - speed * t;
    float h = amp * sin(phase);
    float dh = amp * cos(phase) * k;
    return vec3(h, dh * dir.x, dh * dir.y);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Sum of sine waves — primary flow direction +X.
    vec3 w1 = sinWave(pos, normalize(vec2( 1.0, 0.1)), 14.0, 0.10, 0.6, uTime);
    vec3 w2 = sinWave(pos, normalize(vec2( 1.0,-0.3)),  7.0, 0.06, 1.0, uTime);
    vec3 w3 = sinWave(pos, normalize(vec2( 0.7, 0.7)),  3.2, 0.03, 1.6, uTime);
    vec3 w4 = sinWave(pos, normalize(vec2(-0.4, 1.0)),  1.6, 0.015, 2.2, uTime);

    float h  = w1.x + w2.x + w3.x + w4.x;
    float dx = w1.y + w2.y + w3.y + w4.y;
    float dz = w1.z + w2.z + w3.z + w4.z;

    // Concentric wave packet ripples triggered by fish entry/exit
    float drip = 0.0;
    float dr_dx = 0.0;
    float dr_dz = 0.0;
    
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      if (r.w > 0.0) {
        float dist = distance(pos.xz, r.xy);
        float age = r.z;
        float speed = 4.2;
        float wavelength = 1.0;
        float k = 6.2831853 / wavelength;
        
        float waveFront = speed * age;
        float distToFront = abs(dist - waveFront);
        
        float amp = r.w * 0.18 * exp(-dist * 0.45) * smoothstep(1.5, 0.0, age);
        float envelope = exp(-distToFront * distToFront * 3.5);
        float frontLimit = smoothstep(waveFront + 0.8, waveFront - 0.2, dist);
        
        // Primary gravity wave + secondary capillary wave
        float waveVal = sin(k * dist - 16.0 * age) + 0.35 * sin(2.2 * k * dist - 28.0 * age);
        
        drip += amp * waveVal * envelope * frontLimit;
        
        // Analytical derivative of displacement with respect to dist
        float dWave_dDist = amp * (k * cos(k * dist - 16.0 * age) + 0.35 * 2.2 * k * cos(2.2 * k * dist - 28.0 * age)) * envelope * frontLimit;
        float dirX = (pos.x - r.x) / (dist + 0.001);
        float dirZ = (pos.z - r.y) / (dist + 0.001);
        dr_dx += dWave_dDist * dirX;
        dr_dz += dWave_dDist * dirZ;
      }
    }

    pos.y += h + drip;

    vNormal = normalize(vec3(-(dx + dr_dx), 1.0, -(dz + dr_dz)));
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform float uNight;       // 0 = full day, 1 = full night
  uniform vec4 uRipples[8];
  uniform vec3 uSpotPositions[28];
  uniform vec3 uSpotTargets[28];
  uniform float uSpotIntensities[28];
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    float bank = abs(vUv.y - 0.5) * 2.0;

    vec2 flowUv = vec2(vUv.x * 80.0 - uTime * 1.2, vUv.y * 16.0);
    float n1 = noise(flowUv);
    float n2 = noise(flowUv * 2.3 + uTime * 0.3);
    float caustic = pow(0.5 + 0.5 * (n1 - n2), 3.0);

    vec3 deep    = vec3(0.04, 0.18, 0.40);
    vec3 shallow = vec3(0.22, 0.58, 0.78);
    vec3 foamCol = vec3(0.96, 0.99, 1.00);
    vec3 col = mix(deep, shallow, 1.0 - bank * 0.7);

    col += caustic * vec3(0.25, 0.30, 0.20) * (1.0 - bank * 0.5);

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(0.0, dot(normalize(vNormal), H)), 80.0);
    col += spec * 0.8;

    float fres = pow(1.0 - max(0.0, dot(normalize(vNormal), V)), 4.0);
    vec3 skyCol = mix(vec3(0.7, 0.85, 0.95), vec3(0.005, 0.015, 0.035), clamp(uNight, 0.0, 1.0));
    col = mix(col, skyCol, fres * 0.25);

    float foamStrip = smoothstep(0.78, 1.0, bank);
    float foamRipple = smoothstep(0.55, 1.0, noise(vec2(vUv.x * 200.0 + uTime * 2.0, vUv.y * 40.0)));
    col = mix(col, foamCol, foamStrip * (0.6 + foamRipple * 0.4));

    // Dynamic wave foam from fish ripples
    float totalFoam = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 r = uRipples[i];
      if (r.w > 0.0) {
        float dist = distance(vWorldPos.xz, r.xy);
        float age = r.z;
        float speed = 4.2;
        float waveFront = speed * age;
        float distToFront = abs(dist - waveFront);
        
        float foamAmt = exp(-distToFront * distToFront * 5.0) * r.w * 0.8 * exp(-dist * 0.2) * smoothstep(1.5, 0.0, age);
        
        float angle = atan(vWorldPos.z - r.y, vWorldPos.x - r.x);
        float n = noise(vec2(angle * 12.0, (dist - waveFront) * 15.0 + uTime * 2.0));
        
        float threshold = 0.35 + (age / 1.5) * 0.35;
        float foamVal = smoothstep(threshold, threshold + 0.1, n);
        
        totalFoam += foamAmt * foamVal;
      }
    }
    col = mix(col, foamCol, clamp(totalFoam, 0.0, 1.0));

    // Night Time
    vec3 nightCol = col * 0.03; // Base water extremely dark, practically no light emitted
    col = mix(col, nightCol, clamp(uNight, 0.0, 1.0));

    // Spotlights illumination
    vec3 spotLightAdded = vec3(0.0);
    for(int i=0; i<28; i++) {
        float intensity = uSpotIntensities[i];
        if (intensity > 0.0) {
            vec3 lDir = vWorldPos - uSpotPositions[i];
            float dist = length(lDir);
            lDir = normalize(lDir);
            
            vec3 tDir = normalize(uSpotTargets[i] - uSpotPositions[i]);
            float spotEffect = dot(lDir, tDir);
            
            if (spotEffect > 0.85) { // cone angle
                float spotFalloff = smoothstep(0.85, 0.95, spotEffect);
                float atten = 1.0 / (1.0 + 0.1 * dist + 0.05 * dist * dist);
                
                vec3 normal = normalize(vNormal);
                float diff = max(0.0, dot(normal, -lDir));
                
                vec3 V = normalize(cameraPosition - vWorldPos);
                vec3 H = normalize(-lDir + V);
                float spec = pow(max(0.0, dot(normal, H)), 60.0);
                
                // Add warm white light (softer contribution)
                spotLightAdded += vec3(1.0, 0.95, 0.85) * (intensity * 0.008) * atten * spotFalloff * (diff + spec * 2.0);
            }
        }
    }

    col += spotLightAdded * clamp(uNight, 0.0, 1.0); // Only add at night

    gl_FragColor = vec4(col, 0.85);
  }
`;

export function buildWater() {
  const group = new THREE.Group();
  group.name = 'water';

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.3).normalize() },
      uNight: { value: 0.0 },
      uRipples: { value: Array(8).fill(null).map(() => new THREE.Vector4(0, 0, 0, 0)) },
      uSpotPositions: { value: Array(28).fill(null).map(() => new THREE.Vector3()) },
      uSpotTargets: { value: Array(28).fill(null).map(() => new THREE.Vector3()) },
      uSpotIntensities: { value: Array(28).fill(0) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(buildRiverSurfaceGeometry(), material);
  mesh.position.y = RIVER_Y;
  mesh.name = 'river_surface';
  group.add(mesh);
  
  group.userData.material = material;

  const activeRipples = [];

  group.userData.triggerRipple = (x, z, intensity = 1.0) => {
    // Find finished/expired ripple or create a new slot if under capacity
    let rip = activeRipples.find(r => r.age >= 1.5);
    if (!rip && activeRipples.length < 8) {
      rip = { x: 0, z: 0, age: 0, intensity: 0 };
      activeRipples.push(rip);
    } else if (!rip) {
      // Evict oldest active ripple to maintain budget
      rip = activeRipples.reduce((oldest, current) => current.age > oldest.age ? current : oldest, activeRipples[0]);
    }
    
    if (rip) {
      rip.x = x;
      rip.z = z;
      rip.age = 0;
      rip.intensity = intensity;
    }
  };

  group.userData.tick = (delta) => {
    material.uniforms.uTime.value += delta;

    // Update ripple durations
    for (const rip of activeRipples) {
      rip.age += delta;
    }

    // Populate uniform array
    const uRips = material.uniforms.uRipples.value;
    for (let i = 0; i < 8; i++) {
      if (i < activeRipples.length && activeRipples[i].age < 1.5) {
        const r = activeRipples[i];
        uRips[i].set(r.x, r.z, r.age, r.intensity);
      } else {
        uRips[i].set(0, 0, 0, 0);
      }
    }
  };
  
  return group;
}


