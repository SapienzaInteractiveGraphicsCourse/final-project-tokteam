export const RIVER_X_MIN = -100;
export const RIVER_X_MAX = 100;

export function riverCenter(x) {
  return 14 * Math.sin(x * 0.04) + 3 * Math.sin(x * 0.11);
}

export function riverHalfWidth(x) {
  return 6 + 2 * Math.sin(x * 0.07 + 0.3);
}


