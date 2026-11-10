import * as THREE from "three";
import { GALLERY } from "./palette.js";
import { WALL } from "./layout.js";
import { TRACK_START_X, TRACK_STEP, createWallMaterial } from "./wall-shader.js";
import { glowTexture } from "../shared/textures.js";
import { srgb } from "./media.js";

/** x of the return wall: the corner where the exhibition starts, left of column 0. */
export const CORNER_X = -9.5;
/** Benches stand this far apart along the wall, the first one at BENCH_FIRST_X. */
export const BENCH_STEP = 12;
export const BENCH_FIRST_X = 4.5;
const BENCH_Z = WALL.z + 1.7;
const BENCHES = 3;

/** Ceiling track: just under the picture rail, a little out from the wall. */
const TRACK_Y = 9.62;
const TRACK_Z = WALL.z + 1.5;
const TRACK_LEN = 90;
const CANS = 24;

/**
 * x of the benches to draw around a camera at `cameraX`: the BENCHES nearest
 * slots of an endless row (never left of the first). Pure, so it is testable.
 */
export function benchXs(cameraX: number, count = BENCHES): number[] {
  const nearest = Math.max(0, Math.round((cameraX - BENCH_FIRST_X) / BENCH_STEP));
  const first = Math.max(0, nearest - Math.floor(count / 2));
  return Array.from({ length: count }, (_, i) => BENCH_FIRST_X + (first + i) * BENCH_STEP);
}

/** First ceiling-spot column to draw around a camera at `cameraX` (never < 0). */
export function firstCanColumn(cameraX: number, count = CANS): number {
  return Math.max(0, Math.round(cameraX / TRACK_STEP) - Math.floor(count / 2));
}

function benchGeometry(): THREE.BufferGeometry[] {
  const seat = new THREE.BoxGeometry(2.7, 0.12, 0.62);
  seat.translate(0, 0.46, 0);
  const legs: THREE.BufferGeometry[] = [];
  for (const x of [-1.05, 1.05]) {
    const leg = new THREE.BoxGeometry(0.07, 0.4, 0.5);
    leg.translate(x, 0.2, 0);
    legs.push(leg);
  }
  return [seat, ...legs];
}

/** Painted wall lettering by the entrance; null where there is no DOM canvas. */
function titleTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "500 132px Georgia, 'Times New Roman', serif";
  ctx.fillText("Chia Grove", 40, 170);
  ctx.fillRect(44, 214, 300, 4);
  ctx.font = "italic 52px Georgia, 'Times New Roman', serif";
  ctx.fillText("works from the chain,", 40, 300);
  ctx.fillText("hung as they are spent", 40, 364);
  ctx.font = "600 30px Georgia, 'Times New Roman', serif";
  ctx.fillText("PERMANENT COLLECTION  ·  NEW ACQUISITIONS", 42, 452);
  const texture = srgb(new THREE.CanvasTexture(canvas));
  texture.anisotropy = 8;
  return texture;
}

export interface Room {
  /** Slide the repeating furniture along with the camera; set the track's glow. */
  update(cameraX: number, lamps: number): void;
}

/**
 * What makes the wall a room: the return wall at the corner where the hang
 * begins (with the exhibition title lettered beside it), a row of benches in
 * front of the art, and a ceiling track of spots whose scallops the wall
 * shader paints (wall-shader.ts). The benches and spots are a small fixed set
 * re-laid around the camera, so the room runs as far as the wall does.
 * Everything here is scenery: nothing is pickable.
 */
export function createRoom(scene: THREE.Scene): Room {
  const group = new THREE.Group();
  const inert = (mesh: THREE.Object3D): void => {
    mesh.raycast = () => {};
  };

  // the corner: a return wall running from the hang toward the viewer
  const side = new THREE.Mesh(new THREE.PlaneGeometry(44, 40), createWallMaterial(true));
  side.rotation.y = Math.PI / 2;
  side.position.set(CORNER_X, 8, WALL.z - 0.3 + 22);
  inert(side);
  group.add(side);

  const titleMap = titleTexture();
  if (titleMap) {
    const title = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 2.8),
      new THREE.MeshBasicMaterial({
        map: titleMap,
        color: GALLERY.matIvory,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        toneMapped: false,
      })
    );
    title.position.set(CORNER_X + 4.1, 5.9, WALL.z - 0.28);
    inert(title);
    group.add(title);
  }

  // benches: dark leather on slab legs, with a soft contact shadow
  const leather = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.4, metalness: 0.4 });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: 0x000000,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const [seatGeo, ...legGeos] = benchGeometry();
  const shadowGeo = new THREE.PlaneGeometry(3.6, 1.5).rotateX(-Math.PI / 2);
  const benches = Array.from({ length: BENCHES }, () => {
    const bench = new THREE.Group();
    bench.add(new THREE.Mesh(seatGeo, leather));
    for (const leg of legGeos) bench.add(new THREE.Mesh(leg, steel));
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.012;
    bench.add(shadow);
    bench.position.z = BENCH_Z;
    bench.traverse(inert);
    group.add(bench);
    return bench;
  });

  // ceiling track: a rail with one spot can per hanging column
  const railMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(TRACK_LEN, 0.05, 0.07), railMat);
  rail.position.set(0, TRACK_Y, TRACK_Z);
  inert(rail);
  group.add(rail);

  const canGeo = new THREE.CylinderGeometry(0.085, 0.11, 0.3, 12);
  canGeo.translate(0, -0.15, 0);
  canGeo.rotateX(-0.55); // nose tipped toward the wall
  const cans = new THREE.InstancedMesh(canGeo, railMat, CANS);
  cans.frustumCulled = false;
  inert(cans);
  group.add(cans);
  // the lit mouth of each can, seen as a warm glint under the track
  const glintMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: GALLERY.spot,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const glints = Array.from({ length: CANS }, () => {
    const glint = new THREE.Sprite(glintMat);
    glint.scale.setScalar(0.34);
    glint.raycast = () => {};
    group.add(glint);
    return glint;
  });

  scene.add(group);

  const matrix = new THREE.Matrix4();
  let laidBench = NaN;
  let laidCan = NaN;
  return {
    update(cameraX, lamps) {
      const xs = benchXs(cameraX);
      if (xs[0] !== laidBench) {
        laidBench = xs[0];
        benches.forEach((bench, i) => (bench.position.x = xs[i]));
      }
      const col = firstCanColumn(cameraX);
      if (col !== laidCan) {
        laidCan = col;
        for (let i = 0; i < CANS; i++) {
          const x = (col + i) * TRACK_STEP;
          cans.setMatrixAt(i, matrix.makeTranslation(x, TRACK_Y - 0.02, TRACK_Z));
          glints[i].position.set(x, TRACK_Y - 0.3, TRACK_Z - 0.16);
        }
        cans.instanceMatrix.needsUpdate = true;
        // the rail starts with the first column and runs on past the last spot
        rail.position.x = Math.max(TRACK_START_X + TRACK_LEN / 2, (col + CANS / 2) * TRACK_STEP);
      }
      glintMat.opacity = Math.min(1, 0.55 * lamps);
    },
  };
}
