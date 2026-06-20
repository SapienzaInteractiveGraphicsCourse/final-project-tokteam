import { riverCenter, riverHalfWidth } from './riverConstants.js';

const HALF = 90;
export const CELL = 2.0;
export const N = Math.round((2 * HALF) / CELL) + 1;
const VIS_CLEAR = 0.9;
export const BRIDGE_HALF_X = 2.4;

export const idx = (ix, iz) => iz * N + ix;
export const toCellX = (x) => Math.max(0, Math.min(N - 1, Math.round((x + HALF) / CELL)));
export const toCellZ = (z) => Math.max(0, Math.min(N - 1, Math.round((z + HALF) / CELL)));
export const cellToWorld = (i) => i * CELL - HALF;

const STATIC_CIRCLES = [
  [-50, -50, 20], [40, -40, 15], [-40, 40, 16], [-14, 23, 2.8],
  [10.5, 21.1, 3.5], // Shooting gallery booth collision
  [-5, -25, 1.3], [-5, -50, 1.3], [-5, -75, 1.3], [5, -25, 1.3], [5, -50, 1.3], [5, -75, 1.3],
  [-5, 25, 1.3], [-5, 50, 1.3], [-5, 75, 1.3], [5, 25, 1.3], [5, 50, 1.3], [5, 75, 1.3],
];

export class NavGrid {
  constructor({ obstacles = [], coasterFootprint = null } = {}) {
    this.blocked = new Uint8Array(N * N);
    this.cost = new Float32Array(N * N);

    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = cellToWorld(ix);
        const z = cellToWorld(iz);
        let blocked = false;

        if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) {
          blocked = true;
        }

        if (!blocked) {
          const dRiver = Math.abs(z - riverCenter(x)) - riverHalfWidth(x);
          if (dRiver < 1.6 && Math.abs(x) > BRIDGE_HALF_X) {
            blocked = true;
          }
        }

        if (!blocked && z < -73 && Math.abs(x) < 14) {
          blocked = true;
        }

        if (!blocked) {
          for (const [cx, cz, cr] of STATIC_CIRCLES) {
            const dx = x - cx;
            const dz = z - cz;
            if (dx * dx + dz * dz < (cr + VIS_CLEAR) * (cr + VIS_CLEAR)) {
              blocked = true;
              break;
            }
          }
        }

        if (!blocked && coasterFootprint) {
          const pad = Math.min(coasterFootprint.pad, 4.0) + VIS_CLEAR;
          const pad2 = pad * pad;
          const a = coasterFootprint.pts;
          for (let i = 0; i < a.length; i += 2) {
            const dx = x - a[i];
            const dz = z - a[i + 1];
            if (dx * dx + dz * dz < pad2) {
              blocked = true;
              break;
            }
          }
        }

        if (!blocked) {
          for (const o of obstacles) {
            const dx = x - o.x;
            const dz = z - o.z;
            const rr = o.r + VIS_CLEAR;
            if (dx * dx + dz * dz < rr * rr) {
              blocked = true;
              break;
            }
          }
        }

        this.blocked[idx(ix, iz)] = blocked ? 1 : 0;

        let c = 1.7;
        const onPath = Math.abs(x) <= 3.4;
        const onRiver = Math.abs(z - riverCenter(x)) - riverHalfWidth(x) < 1.6;
        if (onPath) {
          c = 1.0;
        } else if (x * x + z * z < 14 * 14 && !onRiver) {
          c = 1.25;
        }
        this.cost[idx(ix, iz)] = c;
      }
    }

    const base = this.cost.slice();
    for (let iz = 1; iz < N - 1; iz++) {
      for (let ix = 1; ix < N - 1; ix++) {
        if (this.blocked[idx(ix, iz)]) continue;
        let nearWall = false;
        for (let dz = -1; dz <= 1 && !nearWall; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (this.blocked[idx(ix + dx, iz + dz)]) {
              nearWall = true;
              break;
            }
          }
        }
        if (nearWall) {
          this.cost[idx(ix, iz)] = base[idx(ix, iz)] + 1.6;
        }
      }
    }
  }

  isFree(ix, iz) {
    return ix >= 0 && ix < N && iz >= 0 && iz < N && !this.blocked[idx(ix, iz)];
  }

  isFreeWorld(x, z) {
    return this.isFree(toCellX(x), toCellZ(z));
  }

  snap(x, z) {
    let ix = toCellX(x);
    let iz = toCellZ(z);
    if (this.isFree(ix, iz)) return [ix, iz];
    for (let r = 1; r < N; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          if (this.isFree(ix + dx, iz + dz)) return [ix + dx, iz + dz];
        }
      }
    }
    return [ix, iz];
  }

  lineClear(ix0, iz0, ix1, iz1) {
    let dx = Math.abs(ix1 - ix0);
    let dz = Math.abs(iz1 - iz0);
    let sx = ix0 < ix1 ? 1 : -1;
    let sz = iz0 < iz1 ? 1 : -1;
    let err = dx - dz;
    let x = ix0;
    let z = iz0;

    while (true) {
      if (!this.isFree(x, z)) return false;
      if (x === ix1 && z === iz1) return true;
      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        z += sz;
      }
    }
  }
}
