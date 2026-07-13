import * as THREE from "three";
import { TURF_RADIUS } from "./layout.js";
import { mulberry32 } from "../shared/util.js";

/** Fixed seed — the countryside must be identical on every reload and replay. */
const SEED = 0x5eedfa12;

export const CANVAS_SIZE = 2048;

const SPAN = TURF_RADIUS * 2;

/**
 * A world coordinate → a canvas pixel, on either axis. The turf's RingGeometry
 * UVs span the disc's bounding square, and CanvasTexture's v-flip cancels the
 * sign flip between the ring's local y and world z, so the canvas is a plain
 * north-up map: x = −140 at the left edge, z = −140 (the hills) at the top.
 */
export function toPx(world: number): number {
  return ((world + TURF_RADIUS) / SPAN) * CANVAS_SIZE;
}

/** A world length → canvas pixels. */
function scalePx(length: number): number {
  return (length / SPAN) * CANVAS_SIZE;
}

/**
 * A neighbouring field: a patch a few percent off the turf's tone, combed with
 * mowing stripes at its own angle. The body is blurred so the parcel has no hard
 * border, but the stripes are clipped square — mowing really does stop dead at a
 * field boundary, and that crispness is what reads as "worked".
 */
function paintParcel(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  cx: number,
  cz: number,
  w: number,
  d: number
): void {
  const W = scalePx(w);
  const D = scalePx(d);
  const light = rand() < 0.5;

  ctx.save();
  ctx.translate(toPx(cx), toPx(cz));
  ctx.rotate((rand() - 0.5) * 0.5);

  ctx.filter = "blur(18px)";
  ctx.fillStyle = light ? "rgba(190,214,150,0.15)" : "rgba(74,102,58,0.15)";
  ctx.fillRect(-W / 2, -D / 2, W, D);
  ctx.filter = "none";

  ctx.beginPath();
  ctx.rect(-W / 2, -D / 2, W, D);
  ctx.clip();
  ctx.rotate(rand() * Math.PI);
  ctx.fillStyle = light ? "rgba(255,255,255,0.05)" : "rgba(30,50,24,0.06)";
  const pitch = 14 + rand() * 18;
  const reach = Math.max(W, D);
  for (let s = -reach; s < reach; s += pitch * 2) {
    ctx.fillRect(s, -reach, pitch, reach * 2);
  }
  ctx.restore();
}

/**
 * Parcels on the wings and beyond the barn, as [cx, cz, w, d]. All of them clear
 * of the field itself (x ∈ [−26, 26], z ∈ [−32, 26]): the crop rows are the
 * subject and nothing may be painted under them.
 */
const PARCELS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-56, 6, 40, 34],
  [-58, -34, 44, 30],
  [-50, 44, 36, 28],
  [-88, 10, 34, 44],
  [56, 4, 42, 36],
  [60, -36, 38, 30],
  [50, 46, 34, 26],
  [92, 12, 32, 42],
  [0, -54, 54, 26],
  [-30, 52, 40, 26],
  [34, 54, 38, 24],
];

/**
 * The field's footprint, punched back out of the canvas as the last step of
 * `landscapeTexture()`. The crop rows are the subject of the scene, so nothing
 * may be painted under them; erasing this rectangle guarantees that
 * structurally rather than relying on every shape above it being hand-tuned to
 * stay clear. Covers x ∈ [−25, 25], z ∈ [−22, 22] — margin of ≥ 1.6 world
 * units beyond the soil strips on every side, enough that even the blurred
 * inner edge of the cut cannot tint a strip.
 */
export const FIELD_CLEAR = { halfX: 25, halfZ: 22 } as const;

/**
 * The lane out of the barn doors, running east along the field's far headland
 * and away toward the horizon. [x, z] control points. It threads the corridor
 * between the barn's front wall (z ≈ −23.7) and the field's far soil strip
 * (z ≈ −19.6) — which is exactly where a farm lane belongs — so the z values
 * near the barn are tightly constrained and should not be nudged casually.
 */
const LANE: ReadonlyArray<readonly [number, number]> = [
  [-9, -21.3],
  [4, -22],
  [22, -22.6],
  [40, -22.2],
  [68, -24.6],
  [104, -30],
  [128, -33],
];

/** Trace the lane's centreline; the caller strokes it. */
function lanePath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(toPx(LANE[0][0]), toPx(LANE[0][1]));
  for (let i = 1; i < LANE.length - 1; i++) {
    const [x, z] = LANE[i];
    const [nx, nz] = LANE[i + 1];
    ctx.quadraticCurveTo(toPx(x), toPx(z), toPx((x + nx) / 2), toPx((z + nz) / 2));
  }
  const last = LANE[LANE.length - 1];
  ctx.lineTo(toPx(last[0]), toPx(last[1]));
}

/**
 * The overlay: everything about the landscape that is painted rather than built.
 * Draped on a clone of the turf's displaced geometry so it follows the rolling
 * ground instead of z-fighting a flat plane against it.
 *
 * Creates a canvas, so it must only ever be called at scene construction — never
 * at module load. The tests run in node, where there is no `document`.
 */
export function landscapeTexture(): THREE.CanvasTexture {
  const rand = mulberry32(SEED);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d")!;

  for (const [cx, cz, w, d] of PARCELS) {
    paintParcel(ctx, rand, cx, cz, w, d);
  }

  // the lane: a soft band of dust, then two worn ruts inside it. Narrowed from
  // the wide/soft band this would otherwise want, because near the barn the
  // lane has only the corridor between the barn's front wall (z ≈ −23.7) and
  // the field-clear cut (z ≈ −22) to live in — a wider band would mostly be
  // erased there and read as a truncated stub instead of a lane leaving the
  // doors.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Composited against the turf (121,168,97), a paint colour's red-minus-green
  // must clear the turf's green-over-red gap of 47 before it can read as earth
  // rather than khaki: result R−G = a·(pr−pg) − 47·(1−a). These two are checked
  // against that formula (≈ +16 and +17), not just eyeballed.
  ctx.filter = "blur(9px)";
  ctx.strokeStyle = "rgba(150,104,70,0.68)";
  ctx.lineWidth = scalePx(2.4);
  lanePath(ctx);
  ctx.stroke();
  ctx.filter = "blur(2px)";
  ctx.strokeStyle = "rgba(108,66,42,0.72)";
  ctx.lineWidth = scalePx(0.7);
  for (const offset of [-0.65, 0.65]) {
    ctx.save();
    ctx.translate(0, scalePx(offset));
    lanePath(ctx);
    ctx.stroke();
    ctx.restore();
  }

  // the barnyard: packed bare earth under the barn and the silo, feathered into
  // the turf, with an apron fanning out from the doors. Worn ground is what makes
  // the farmstead read as worked in rather than set down on a lawn.
  ctx.filter = "blur(16px)";
  ctx.fillStyle = "rgba(152,112,72,0.8)";
  for (const [x, z, rx, rz] of [
    [-10, -26, 7.5, 5.5], // the barn
    [-4.6, -26, 3.6, 3.6], // the silo
    // the apron in front of the doors, pulled into the corridor between the
    // barn wall and the field-clear cut so its body isn't half erased
    [-9, -22.6, 8.5, 1.6],
  ] as ReadonlyArray<readonly [number, number, number, number]>) {
    ctx.save();
    ctx.translate(toPx(x), toPx(z));
    ctx.scale(scalePx(rx), scalePx(rz));
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.filter = "none";

  // Whatever the parcels, the lane and the apron do near the field, the crop rows
  // must come out clean — they are the subject of the scene. Punching the field's
  // footprint back out of the canvas guarantees that structurally, so a future nudge
  // to a lane control point cannot silently smear packed earth across the rows.
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(8px)"; // feather the cut, so the field's edge is not a crisp rectangle
  ctx.fillStyle = "#000";
  ctx.fillRect(
    toPx(-FIELD_CLEAR.halfX),
    toPx(-FIELD_CLEAR.halfZ),
    toPx(FIELD_CLEAR.halfX) - toPx(-FIELD_CLEAR.halfX),
    toPx(FIELD_CLEAR.halfZ) - toPx(-FIELD_CLEAR.halfZ)
  );
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
