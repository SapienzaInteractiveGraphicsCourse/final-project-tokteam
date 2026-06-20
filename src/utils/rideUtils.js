import * as THREE from 'three';

/**
 * Creates an emissive bulb mesh with standard properties.
 * Used for night lights on rides.
 * @param {number|THREE.Color} color - Color of the light
 * @param {number} size - Radius of the bulb sphere
 * @param {number} [intensity=0] - Initial emissive intensity
 * @returns {THREE.Mesh} The bulb mesh
 */
export function createEmissiveBulb(color, size, intensity = 0) {
  const geo = new THREE.SphereGeometry(size, 8, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Creates a point light with standard parameters.
 * @param {number|THREE.Color} color - Color of the light
 * @param {number} intensity - Light intensity
 * @param {number} distance - Light range distance
 * @param {number} decay - Light decay rate
 * @returns {THREE.PointLight} The point light
 */
export function createPointLight(color, intensity, distance, decay) {
  return new THREE.PointLight(color, intensity, distance, decay);
}

/**
 * Updates nightMix factor using exponential interpolation.
 * @param {number} nightMix - Current nightMix value
 * @param {boolean} isNight - Whether it is night time
 * @param {number} delta - Frame delta time in seconds
 * @param {number} [rate=2.2] - Animation speed rate
 * @returns {number} The updated nightMix value
 */
export function nightMixLerp(nightMix, isNight, delta, rate = 2.2) {
  const target = isNight ? 1 : 0;
  return nightMix + (target - nightMix) * (1 - Math.exp(-rate * delta));
}
