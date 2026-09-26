/**
 * Cheap hash / value-noise helpers shared by the grove's procedural shaders
 * (ground mycelium, aurora curtain, moon surface). Arithmetic-only hashes — no
 * textures or sin-based hashes, which band badly on mobile GPUs.
 */
export const NOISE_GLSL = /* glsl */ `
float gHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 gHash22(vec2 p) {
  float n = gHash21(p);
  return vec2(n, gHash21(p + n + 17.0));
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(gHash21(i), gHash21(i + vec2(1.0, 0.0)), u.x),
    mix(gHash21(i + vec2(0.0, 1.0)), gHash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float gFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * gNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s / 0.875;
}
`;
