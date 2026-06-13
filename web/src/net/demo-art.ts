import { mulberry32 } from "../themes/shared/util.js";

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic abstract artwork as an inline SVG data URI — works offline and
 * is exempt from CORS, so the demo gallery populates without network art.
 */
export function demoNftImage(seed: string): string {
  const rng = mulberry32(seedFrom(seed));
  const h1 = Math.floor(rng() * 360);
  const h2 = (h1 + 40 + Math.floor(rng() * 200)) % 360;
  const cx = 20 + Math.floor(rng() * 60);
  const cy = 20 + Math.floor(rng() * 60);
  const r = 18 + Math.floor(rng() * 26);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='hsl(${h1},65%,42%)'/>` +
    `<stop offset='1' stop-color='hsl(${h2},60%,22%)'/></linearGradient></defs>` +
    `<rect width='400' height='400' fill='url(#g)'/>` +
    `<circle cx='${cx * 4}' cy='${cy * 4}' r='${r * 4}' fill='hsl(${h2},70%,72%)' opacity='0.85'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
