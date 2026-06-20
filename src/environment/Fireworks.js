import * as THREE from 'three';
import { eventBus } from '../utils/EventBus.js';

// ── Particle Texture ──
function makeFireworkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  
  // A bright center with a soft falloff
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const fireworkTex = makeFireworkTexture();

// ── Colors ──
const PALETTES = [
  new THREE.Color(1.0, 0.8, 0.2), // Gold
  new THREE.Color(0.8, 0.8, 1.0), // Silver/Blueish
  new THREE.Color(1.0, 0.2, 0.2), // Red
  new THREE.Color(0.2, 1.0, 0.2), // Green
  new THREE.Color(0.8, 0.2, 1.0), // Purple
  new THREE.Color(0.2, 0.6, 1.0), // Blue
];

// ── Shaders ──
const vertexShader = `
uniform float uTime;
uniform float uStartTime;
uniform vec3 uCenter;
uniform vec3 uColor;
uniform float uSize;

attribute vec3 aVelocity;
attribute float aLife;
attribute float aType; // 0=head, 1=trail, 2=strobe
attribute float aTrailOffset;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float age = uTime - uStartTime - aTrailOffset;
  
  if (age < 0.0 || age > aLife) {
    gl_Position = vec4(0.0);
    vAlpha = 0.0;
    return;
  }
  
  // Physics
  // Apply drag to velocity integral: p = p0 + v0 / drag * (1 - exp(-drag * t))
  float drag = 1.2;
  vec3 pos = uCenter;
  
  vec3 vel = aVelocity;
  pos += vel / drag * (1.0 - exp(-drag * age));
  
  // Gravity
  pos.y -= 4.9 * age * age;
  
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  
  float sizeMod = 1.0;
  if (aType > 0.5 && aType < 1.5) sizeMod = 0.35; // trails are smaller (aType == 1)
  if (aType > 1.5) {                               // strobe effect (aType == 2)
    // strobe effect
    sizeMod = 0.8 + 0.8 * sin(age * 40.0);
  }
  
  gl_PointSize = uSize * sizeMod * (300.0 / -mvPosition.z) * (1.0 - age/aLife);
  
  // Emissive color for Bloom
  float intensity = 3.0; 
  if (age < 0.05 && aType != 1.0) intensity = 15.0; // Huge flash on spawn
  if (aType == 1.0) intensity = 1.2; // trails are less intense
  
  // Mix color: trails can be slightly more white/yellow as they burn out
  vec3 finalColor = mix(uColor, vec3(1.0, 0.9, 0.7), aTrailOffset * 2.0);
  
  vColor = finalColor * intensity;
  
  // Fade out
  vAlpha = 1.0 - (age / aLife);
  if (aType == 1.0) vAlpha *= 0.5; // trails are more transparent
}
`;

const fragmentShader = `
varying vec3 vColor;
varying float vAlpha;
uniform sampler2D uTexture;
uniform float uOpacity;

void main() {
  if (vAlpha <= 0.0) discard;
  
  vec4 texColor = texture2D(uTexture, gl_PointCoord);
  // Additive output
  gl_FragColor = vec4(vColor * texColor.rgb * vAlpha * uOpacity, 1.0);
}
`;

// ── GPU Burst Class ──
class GPUBurst extends THREE.Group {
  constructor() {
    super();
    this.active = false;
    this.phase = 'idle'; // idle | launch | explode
    this.launchTime = 0;
    this.explodeTime = 0;
    this.targetY = 0;
    this.launchSpeed = 40;
    this.burstCenter = new THREE.Vector3();
    
    // --- Rocket ---
    this.numRocketParticles = 25;
    const rocketGeo = new THREE.BufferGeometry();
    const rPos = new Float32Array(this.numRocketParticles * 3);
    const rCol = new Float32Array(this.numRocketParticles * 3);
    
    for(let i=0; i<this.numRocketParticles; i++) {
      rPos[i*3] = (Math.random() - 0.5) * 0.3; // jitter X
      rPos[i*3+1] = -i * 0.8; // Trail falls behind
      rPos[i*3+2] = (Math.random() - 0.5) * 0.3; // jitter Z
      
      const intensity = 1.0 - (i / this.numRocketParticles);
      rCol[i*3] = 1.0 * intensity;
      rCol[i*3+1] = 0.8 * intensity;
      rCol[i*3+2] = 0.4 * intensity;
    }
    rocketGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
    rocketGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
    
    this.rocketMat = new THREE.PointsMaterial({
      map: fireworkTex,
      size: 5,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.rocket = new THREE.Points(rocketGeo, this.rocketMat);
    this.add(this.rocket);
    
    // --- Particles ---
    this.numParticles = 5000;
    this.trailsPerHead = 12;
    this.heads = Math.floor(this.numParticles / (this.trailsPerHead + 1));
    this.actualParticles = this.heads * (this.trailsPerHead + 1);
    
    this.geo = new THREE.BufferGeometry();
    this.posArray = new Float32Array(this.actualParticles * 3);
    this.velArray = new Float32Array(this.actualParticles * 3);
    this.lifeArray = new Float32Array(this.actualParticles);
    this.typeArray = new Float32Array(this.actualParticles);
    this.trailOffsetArray = new Float32Array(this.actualParticles);
    
    // Fill positions with 0, they are offset by uCenter in shader
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3));
    this.velAttr = new THREE.BufferAttribute(this.velArray, 3);
    this.lifeAttr = new THREE.BufferAttribute(this.lifeArray, 1);
    this.typeAttr = new THREE.BufferAttribute(this.typeArray, 1);
    this.trailAttr = new THREE.BufferAttribute(this.trailOffsetArray, 1);
    
    this.geo.setAttribute('aVelocity', this.velAttr);
    this.geo.setAttribute('aLife', this.lifeAttr);
    this.geo.setAttribute('aType', this.typeAttr);
    this.geo.setAttribute('aTrailOffset', this.trailAttr);
    
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStartTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color() },
        uSize: { value: 6.0 },
        uTexture: { value: fireworkTex },
        uOpacity: { value: 1.0 }
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    
    this.particles = new THREE.Points(this.geo, this.mat);
    this.particles.frustumCulled = false;
    this.add(this.particles);
    
    this.rocket.visible = false;
    this.particles.visible = false;
  }

  launch(x, z, targetY, shapeType, color) {
    this.active = true;
    this.phase = 'launch';
    this.launchTime = performance.now() / 1000;
    this.targetY = targetY;
    this.burstCenter.set(x, 0, z); // starts at ground
    
    this.launchSpeed = 40 + Math.random() * 10;
    
    this.rocket.position.copy(this.burstCenter);
    this.rocket.visible = true;
    this.particles.visible = false;
    
    // Pre-calculate explosion attributes
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uCenter.value.set(x, targetY, z);
    
    this.generateExplosion(shapeType);
  }

  generateExplosion(shape) {
    let speedMult = 1.0;
    let lifeMult = 1.0;
    
    if (shape === 'willow') { speedMult = 0.4; lifeMult = 1.8; }
    if (shape === 'corona') { speedMult = 1.2; lifeMult = 1.0; }
    
    for (let i = 0; i < this.heads; i++) {
      let vx, vy, vz;
      
      if (shape === 'corona') {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.PI / 2 + (Math.random() - 0.5) * 0.3; // Ring
        const s = (25 + Math.random() * 10) * speedMult;
        vx = Math.sin(phi) * Math.cos(theta) * s;
        vy = Math.cos(phi) * s * 0.2;
        vz = Math.sin(phi) * Math.sin(theta) * s;
      } else if (shape === 'willow') {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.4; // Top hemisphere
        const s = (20 + Math.random() * 20) * speedMult;
        vx = Math.sin(phi) * Math.cos(theta) * s;
        vy = Math.cos(phi) * s - 5.0; // downwards bias
        vz = Math.sin(phi) * Math.sin(theta) * s;
      } else { // sphere
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const s = (20 + Math.random() * 30) * speedMult;
        vx = Math.sin(phi) * Math.cos(theta) * s;
        vy = Math.sin(phi) * Math.sin(theta) * s;
        vz = Math.cos(phi) * s;
      }
      
      const lifeBase = (1.5 + Math.random() * 1.0) * lifeMult;
      const isStrobe = Math.random() < 0.15;
      
      let idx = i * (this.trailsPerHead + 1);
      
      // Head
      this.velArray[idx*3] = vx; this.velArray[idx*3+1] = vy; this.velArray[idx*3+2] = vz;
      this.lifeArray[idx] = lifeBase;
      this.typeArray[idx] = isStrobe ? 2.0 : 0.0;
      this.trailOffsetArray[idx] = 0.0;
      
      // Trails
      for (let j = 1; j <= this.trailsPerHead; j++) {
        idx++;
        // Slight randomness to trail path
        this.velArray[idx*3] = vx + (Math.random() - 0.5) * 2;
        this.velArray[idx*3+1] = vy + (Math.random() - 0.5) * 2;
        this.velArray[idx*3+2] = vz + (Math.random() - 0.5) * 2;
        this.lifeArray[idx] = lifeBase * (0.4 + 0.6 * Math.random());
        this.typeArray[idx] = 1.0; // trail
        this.trailOffsetArray[idx] = (j / this.trailsPerHead) * 0.35; // offset up to 0.35s
      }
    }
    
    this.velAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.typeAttr.needsUpdate = true;
    this.trailAttr.needsUpdate = true;
  }

  update(time, dt) {
    if (!this.active) return;
    
    if (this.phase === 'launch') {
      const age = time - this.launchTime;
      const currentY = this.launchSpeed * age;
      this.rocket.position.y = currentY;
      
      // Flicker rocket trail
      const rCol = this.rocket.geometry.attributes.color.array;
      for(let i=0; i<this.numRocketParticles; i++) {
        const baseIntensity = 1.0 - (i / this.numRocketParticles);
        const flicker = 0.4 + 0.6 * Math.random();
        rCol[i*3] = 1.0 * baseIntensity * flicker;
        rCol[i*3+1] = 0.8 * baseIntensity * flicker;
        rCol[i*3+2] = 0.4 * baseIntensity * flicker;
      }
      this.rocket.geometry.attributes.color.needsUpdate = true;
      
      if (currentY >= this.targetY) {
        this.phase = 'explode';
        this.explodeTime = time;
        this.rocket.visible = false;
        this.particles.visible = true;
        this.mat.uniforms.uStartTime.value = time;
      }
    } else if (this.phase === 'explode') {
      this.mat.uniforms.uTime.value = time;
      const maxLife = 4.0; // Safe upper bound for all particle lives
      if (time - this.explodeTime > maxLife) {
        this.active = false;
        this.particles.visible = false;
      }
    }
  }
}

// ── Main System ──
export function buildFireworks() {
  const group = new THREE.Group();
  group.name = 'fireworks';

  const MAX_BURSTS = 15;
  const bursts = [];
  for (let i = 0; i < MAX_BURSTS; i++) {
    const b = new GPUBurst();
    bursts.push(b);
    group.add(b);
  }

  let nightFactor = 0;
  
  eventBus.on('time-phase-change', (data) => {
    nightFactor = data.nightFactor;
  });

  // Choreography State
  let showMode = false;
  let showPhase = 0;
  let showTimer = 0;

  eventBus.on('trigger-fireworks-show', () => {
    showMode = true;
    showPhase = 0;
    showTimer = 0;
  });

  function getFreeBurst() {
    return bursts.find(b => !b.active);
  }

  function fire(x, z, targetY, shape, colorIdx) {
    const b = getFreeBurst();
    if (b) {
      const color = PALETTES[colorIdx !== undefined ? colorIdx : Math.floor(Math.random() * PALETTES.length)];
      b.launch(x, z, targetY, shape, color);
    }
  }

  group.userData.tick = (delta, time) => {
    const t = performance.now() / 1000;
    
    const opacity = 0.55 + 0.45 * nightFactor;
    for (const b of bursts) {
      b.mat.uniforms.uOpacity.value = opacity;
      b.rocketMat.opacity = opacity;
      b.update(t, delta);
    }

    if (showMode) {
      showTimer -= delta;
      if (showTimer <= 0) {
        if (showPhase === 0) {
          fire(-60, -120, 50, 'sphere', 0);
          fire(  0, -120, 60, 'sphere', 1);
          fire( 60, -120, 50, 'sphere', 0);
          showTimer = 2.5;
        } else if (showPhase === 1) {
          fire(-15, -130, 70, 'willow', 2);
          fire( 15, -130, 70, 'willow', 3);
          showTimer = 3.0;
        } else if (showPhase === 2) {
          fire(-80, -110, 45, 'corona', 4);
          setTimeout(() => fire(-40, -110, 55, 'corona', 5), 300);
          setTimeout(() => fire(  0, -110, 65, 'corona', 4), 600);
          setTimeout(() => fire( 40, -110, 55, 'corona', 5), 900);
          setTimeout(() => fire( 80, -110, 45, 'corona', 4), 1200);
          showTimer = 4.0;
        } else if (showPhase === 3) {
          fire(-40, -140, 60, 'sphere', 0);
          fire( 40, -140, 60, 'sphere', 0);
          setTimeout(() => fire(-20, -140, 75, 'sphere', 1), 400);
          setTimeout(() => fire( 20, -140, 75, 'sphere', 1), 400);
          setTimeout(() => fire(  0, -140, 90, 'willow', 0), 800);
          setTimeout(() => fire(  0, -140, 50, 'corona', 2), 1000);
          showTimer = 8.0;
        } else {
          showMode = false;
        }
        showPhase++;
      }
    }
  };

  return group;
}
