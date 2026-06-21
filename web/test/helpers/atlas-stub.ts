// web/test/helpers/atlas-stub.ts
import * as THREE from "three";

// A DataTexture stand-in so FlapGrid tests need no <canvas>/DOM.
export function buildGlyphAtlasStub(): THREE.CanvasTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex as unknown as THREE.CanvasTexture;
}
