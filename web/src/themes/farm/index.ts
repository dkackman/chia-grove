import * as THREE from "three";
import type { Visualization } from "../types.js";
import { glowTexture } from "../shared/textures.js";
import { createFrameLimiter } from "../shared/frame-limiter.js";
import { Motes } from "../shared/motes.js";
import { createPostFx } from "../shared/postfx.js";
import { createOrbitControl } from "../shared/orbit.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";
import { CropSystem } from "./crops.js";
import { Tractor } from "./tractor.js";
import { createField } from "./field.js";
import { createScenery } from "./scenery.js";
import { createProps } from "./props.js";
import { createFarmSky } from "./sky.js";
import { createTerrain } from "./terrain.js";
import { Chickens } from "./chickens.js";
import { Crows } from "./crows.js";
import { Turbines } from "./turbines.js";

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
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const orbit = createOrbitControl(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FARM.sky);
    scene.fog = new THREE.FogExp2(FARM.haze, 0.005);

    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3f5a33, 0.72));

    // no tone-map curve, so the bright daylight palette is preserved; a high
    // threshold means only the sun and the brightest highlights bloom softly
    const postfx = createPostFx(renderer, scene, camera, {
      bloomStrength: 0.04,
      bloomRadius: 0.35,
      bloomThreshold: 0.85,
    });

    const sky = createFarmSky(scene);
    createTerrain(scene, renderer.capabilities.getMaxAnisotropy());
    const field = createField(scene, reducedMotion);
    createScenery(scene);
    createProps(scene);
    const glow = glowTexture();
    const crops = new CropSystem(scene, glow);
    const tractor = new Tractor(scene, reducedMotion, glow);
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

    let blockIndex = 0;
    let currentRow = 0;
    let plantIndex = 0;
    let clockT = 0;
    const frameCallbacks: Array<() => void> = [];

    feed.onEvent((event) => {
      switch (event.type) {
        case "block":
          currentRow = blockIndex % FIELD.rows;
          blockIndex += 1;
          plantIndex = 0;
          tractor.startRow(currentRow, clockT);
          field.plow(currentRow);
          chickens.chase(0, rowZ(currentRow), clockT);
          turbines.gust(clockT);
          break;
        case "sprout":
          crops.plant(event, currentRow, plantIndex);
          plantIndex += 1;
          break;
        case "ambient":
          sky.setNetspace(event.netspace);
          chickens.setMempool(event.mempoolSize);
          break;
        case "reorg": {
          // sweep the crows over the last ~6 plowed rows
          const newest = rowZ(currentRow);
          const oldest = rowZ(Math.max(0, currentRow - 5));
          crows.fly(Math.min(newest, oldest), Math.max(newest, oldest), clockT);
          crops.clearAbove(event.forkHeight);
          crops.wilt(clockT);
          break;
        }
      }
    });
    feed.onStatus((status) => sky.setSignalLost(status === "stale"));

    const timer = new THREE.Timer();
    const limiter = createFrameLimiter();
    function frame(): void {
      requestAnimationFrame(frame);
      if (!limiter.shouldRender(performance.now())) return;
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.1);
      const t = timer.getElapsed();
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
      camera.lookAt(0, 1, -6);

      sky.update(dt, t);
      field.update(t);
      tractor.update(t);
      crops.update(t, dt, tractor);
      chickens.update(t, dt);
      crows.update(t);
      turbines.update(t, dt);
      motes.update(t, dt);
      for (const fn of frameCallbacks) fn();
      postfx.render();
    }
    frame();

    addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      postfx.setSize(innerWidth, innerHeight);
    });

    return {
      camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => orbit.isDragging(),
      pickables: () => crops.pickables(),
      metaFor: (object, instanceId) => crops.metaFor(object, instanceId),
      setHovered: (object, instanceId) => crops.setHovered(object, instanceId),
    };
  },
};
