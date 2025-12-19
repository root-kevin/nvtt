export function pxPerFoot(gridSizePx) {
  const grid = Number(gridSizePx);
  if (!Number.isFinite(grid) || grid <= 0) return 0;
  return grid / 5;
}

export function feetToPx(feet, gridSizePx) {
  const perFoot = pxPerFoot(gridSizePx);
  if (!Number.isFinite(perFoot) || perFoot <= 0) return null;
  const value = Number(feet);
  if (!Number.isFinite(value)) return null;
  return value * perFoot;
}

export function pxToFeet(px, gridSizePx) {
  const perFoot = pxPerFoot(gridSizePx);
  if (!Number.isFinite(perFoot) || perFoot <= 0) return null;
  const value = Number(px);
  if (!Number.isFinite(value)) return null;
  return value / perFoot;
}
