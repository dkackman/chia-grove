import * as THREE from "three";
import type { Visualization } from "../types.js";
import { glowTexture } from "../shared/textures.js";
import { createRenderLoop } from "../shared/render-loop.js";
import { Motes } from "../shared/motes.js";
import { createPostFx } from "../shared/postfx.js";
import { createOrbitControl } from "../shared/orbit.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";
import { CropSystem } from "./crops.js";
import { PASS_SECONDS, Tractor } from "./tractor.js";
import { createField } from "./field.js";
import { createScenery } from "./scenery.js";
import { createProps } from "./props.js";
import { createFarmSky } from "./sky.js";
import { createTerrain } from "./terrain.js";
import { chaseCount, Chickens } from "./chickens.js";
import { Crows } from "./crows.js";
import { Turbines } from "./turbines.js";
import { applyCloudShadows } from "./clouds.js";
import { blockAgeSeconds, contiguousBand, isReplayBlock, RowPlanner } from "./rows.js";

export const farm: Visualization = {
  id: "farm",
  label: "farm",
  legend: [
    ["sw-wheat", "wheat — XCH spend (taller = larger)"],
    ["sw-gourd", "gourd — CAT transfer (color = asset, plumper = larger)"],
    ["sw-sunflower", "sunflower — NFT (blooms big on mint)"],
    ["sw-scarecrow", "scarecrow — DID activity"],
    ["sw-chicken", "chickens — mempool"],
    ["sw-sun", "sunlight — netspace"],
    ["sw-tractor", "tractor pass — new block"],
    ["sw-crow", "crows — reorg"],
  ],
  start(canvas, feed) {
    const loop = createRenderLoop(canvas);
    const { renderer } = loop;
    let reducedMotion = loop.reducedMotion;
    const orbit = createOrbitControl(canvas);

    const scene = new THREE.Scene();
    // the sky dome (sky.ts) covers the background; this is only a fallback
    scene.background = new THREE.Color(FARM.haze);
    scene.fog = new THREE.FogExp2(FARM.haze, 0.0038);

    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a6238, 0.8));

    // no tone-map curve, so the bright daylight palette is preserved; a high
    // threshold means only the sun and the brightest highlights bloom softly
    const postfx = createPostFx(renderer, scene, camera, {
      bloomStrength: 0.12,
      bloomRadius: 0.35,
      bloomThreshold: 0.85,
    });

    const sky = createFarmSky(scene, reducedMotion);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    createTerrain(scene, anisotropy);
    const field = createField(scene, reducedMotion, anisotropy);
    createScenery(scene);
    createProps(scene);
    const glow = glowTexture();
    const crops = new CropSystem(scene, glow);
    const tractor = new Tractor(scene, reducedMotion, glow);
    loop.onReducedMotionChange((reduced) => {
      reducedMotion = reduced;
      tractor.setReducedMotion(reduced);
    });
    const chickens = new Chickens(scene, reducedMotion ? 40 : 120);
    const crows = new Crows(scene, reducedMotion ? 10 : 24);
    const turbines = new Turbines(scene, reducedMotion);
    // pollen drifting in the sun, centred over the rows — atmosphere only
    const motes = new Motes(scene, {
      count: reducedMotion ? 35 : 100,
      color: 0xfff0c0,
      size: 0.2,
      opacity: 0.3,
      radius: 26,
      centerZ: -2,
      minY: 0.6,
      maxY: 9,
      windX: 1,
      windZ: 0.6,
      windSpeed: 0.6,
      gust: 0.45,
      rise: 0.12,
      motion: reducedMotion ? 0.12 : 1,
    });

    // every lit material, built above, takes the drifting cloud shadows
    applyCloudShadows(scene);

    const rows = new RowPlanner(FIELD.rows);
    let plantIndex = 0;
    let clockT = 0;

    feed.onEvent((event) => {
      switch (event.type) {
        case "block": {
          const row = rows.next(event.height);
          // the field wrapped (or a reorg rewound onto this row): clear what
          // still stands there before it is re-plowed
          crops.clearRow(row);
          plantIndex = 0;
          const now = Date.now();
          if (isReplayBlock(event.timestamp, now)) {
            // snapshot history: no pass, no hens, no gust — the row simply
            // appears plowed as long ago as the block was made
            const passStart = tractor.startRow(row, clockT, blockAgeSeconds(event.timestamp, now));
            field.plow(row, passStart, clockT);
            break;
          }
          const passStart = tractor.startRow(row, clockT);
          field.plow(row, passStart, clockT);
          chickens.chase(
            rowZ(row),
            passStart + PASS_SECONDS + 2,
            chaseCount(event.mempoolIncluded, chickens.visibleCount())
          );
          turbines.gust(clockT);
          break;
        }
        case "sprout":
          crops.plant(event, rows.currentRow, plantIndex);
          plantIndex += 1;
          break;
        case "ambient":
          sky.setNetspace(event.netspace);
          chickens.setMempool(event.mempoolSize);
          break;
        case "reorg": {
          // rewind so the replacement blocks re-plow the invalidated rows
          const removed = rows.rewind(event.forkHeight);
          crops.clearAbove(event.forkHeight);
          const recent = rows.recentRows(6);
          // sweep the crows over the invalidated rows and the recent ones
          // beside them (never across the wrap from row 0 to the far end)
          const band = contiguousBand([...removed, ...recent]);
          if (band.length > 0) {
            const zs = band.map(rowZ);
            crows.fly(Math.min(...zs) - 0.4, Math.max(...zs) + 0.4, clockT);
          }
          crops.wilt(clockT, recent);
          break;
        }
      }
    });
    feed.onStatus((status) => sky.setSignalLost(status === "stale"));

    function update(dt: number, t: number): void {
      clockT = t;

      // drift along the field's near edge, looking across the rows at the barn
      const autoX = reducedMotion ? 8 : Math.sin(t * 0.02) * 16;
      const autoZ = rowZ(0) + 14 + (reducedMotion ? 0 : Math.cos(t * 0.013) * 2);

      // rotate the drift position around the look target (0, _, -6) on the XZ
      // plane by the user's accumulated orbit offset
      const ltX = 0,
        ltZ = -6;
      const dx = autoX - ltX;
      const dz = autoZ - ltZ;
      const a = orbit.getOffset();
      const cosA = Math.cos(a),
        sinA = Math.sin(a);
      camera.position.set(
        ltX + dx * cosA - dz * sinA,
        11 + Math.sin(t * 0.05) * 0.6,
        ltZ + dx * sinA + dz * cosA
      );
      camera.lookAt(0, 2.4, -6);

      sky.update(dt, t);
      field.update(t);
      tractor.update(t);
      crops.update(t, dt, tractor);
      chickens.update(t, dt, tractor.position(t));
      crows.update(t);
      turbines.update(t, dt);
      motes.update(t, dt);
    }
    loop.start({ camera, postfx, update });

    return {
      camera,
      onFrame: loop.onFrame,
      isDragging: () => orbit.isDragging(),
      pickables: () => crops.pickables(),
      metaFor: (object, instanceId) => crops.metaFor(object, instanceId),
      setHovered: (object, instanceId) => crops.setHovered(object, instanceId),
    };
  },
};
