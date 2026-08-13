/**
 * Camera distance (along +z, looking at the box center) needed to fit a
 * centered `contentW × contentH` plane in view for a perspective camera with
 * vertical FOV `vFovDeg` and viewport `aspect` (width/height). Takes the larger
 * of the height-fit and width-fit so the whole board is visible on any aspect,
 * scaled by `margin` (>1 leaves breathing room). Pure.
 */
export function fitDistance(
  contentW: number,
  contentH: number,
  vFovDeg: number,
  aspect: number,
  margin = 1.06
): number {
  const half = Math.tan((vFovDeg * Math.PI) / 180 / 2);
  const fitH = contentH / 2 / half;
  const fitW = contentW / 2 / (half * aspect);
  return Math.max(fitH, fitW) * margin;
}
