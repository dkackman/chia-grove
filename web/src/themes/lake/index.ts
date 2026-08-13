import * as THREE from "three";
import type { Visualization } from "../types.js";
import { catColor } from "../shared/cat-color.js";
import { startLake } from "./lake.js";
import { seatOffset } from "./layout.js";
import { LAKE } from "./palette.js";
import { fishSize, schoolSize } from "./scales.js";
import { Shoal } from "./shoal.js";
import { Jellies } from "./jellies.js";
import { Turtles } from "./turtles.js";
import { Vfx } from "./vfx.js";
import { Bands } from "./bands.js";
import { Pending } from "./pending.js";
import { createLakeStrip } from "./strip.js";

export const lake: Visualization = {
  id: "lake",
  label: "lake",
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-pending", "shoal near the surface — mempool"],
    ["sw-rim", "ring — one block (bright = busy)"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startLake(canvas, feed);
    const xchFish = new Shoal(runtime.scene, LAKE.xchFish);
    const catFish = new Shoal(runtime.scene, 0xffffff);
    const jellies = new Jellies(runtime.scene);
    const turtles = new Turtles(runtime.scene);
    const vfx = new Vfx(runtime.scene);
    const bands = new Bands(runtime.scene);
    const pending = new Pending(runtime.scene);
    const stripRoot = document.getElementById("lake-strip");
    // A missing #lake-strip element would otherwise take the whole theme down
    // at startup over a status readout; skip the strip and let the scene run.
    const strip = stripRoot ? createLakeStrip(stripRoot) : null;
    const clock = { t: 0 };
    const schoolColor = new THREE.Color();
    let hovered: { object: THREE.Object3D; index: number } | null = null;

    runtime.setSproutHandler((event, blocksSeen) => {
      if (event.mint) vfx.beacon(seatOffset(event.coinId).radius, clock.t);
      if (event.kind === "xch") {
        xchFish.plant(event, blocksSeen, fishSize(event.amount), null, 0, clock.t);
        return;
      }
      if (event.kind === "cat") {
        const { h, s, l } = catColor(event.assetId ?? "0".repeat(64));
        schoolColor.setHSL(h, s, l);
        const count = schoolSize(event.amount);
        for (let member = 0; member < count; member++) {
          catFish.plant(event, blocksSeen, 0.5, schoolColor, member, clock.t);
        }
        return;
      }
      if (event.kind === "nft") {
        // an NFT spent more than once inside the window (a mint is an eve + lineage
        // spend; transfers spend it again) arrives as repeat events — one jellyfish
        // per launcher id, the way the gallery dedupes its canvases
        if (event.launcherId && jellies.has(event.launcherId)) return;
        jellies.plant(event, blocksSeen, clock.t);
        return;
      }
      if (event.kind === "did") turtles.plant(event, blocksSeen, clock.t);
    });
    runtime.setReorgHandler((forkHeight) => {
      xchFish.clearAbove(forkHeight);
      catFish.clearAbove(forkHeight);
      jellies.clearAbove(forkHeight);
      turtles.clearAbove(forkHeight);
      bands.clearAbove(forkHeight);
      vfx.strike(clock.t);
    });
    runtime.setContentFlagHandler((launcherId) => jellies.markSensitive(launcherId));
    runtime.setBlockHandler((event, blocksSeen) => {
      bands.push(event, blocksSeen);
      pending.release(event.spendCount, clock.t);
      runtime.water.ripple(clock.t);
    });
    runtime.setAmbientHandler((event) => {
      pending.setMempool(event.mempoolSize, event.mempoolCost);
      strip?.setMempool(event.mempoolSize);
      strip?.setNetspace(event.netspace);
    });

    const frameCallbacks: Array<() => void> = [];
    // blocksSmooth, not blocksSeen: rendering rides the eased float so the
    // lake glides between bands. Planting (above) uses the integer counter.
    runtime.setUpdateHandler((dt, t, blocksSmooth) => {
      clock.t = t;
      bands.update(blocksSmooth, runtime.camera);
      pending.update(dt, t);
      xchFish.update(t, blocksSmooth);
      catFish.update(t, blocksSmooth);
      jellies.update(runtime.camera, t, blocksSmooth);
      turtles.update(dt, t, blocksSmooth);
      vfx.update(dt, t);
      for (const fn of frameCallbacks) fn();
    });

    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [
        ...xchFish.pickables(),
        ...catFish.pickables(),
        ...jellies.pickables(),
        ...turtles.pickables(),
      ],
      metaFor: (object, instanceId) =>
        xchFish.metaFor(object, instanceId) ??
        catFish.metaFor(object, instanceId) ??
        jellies.metaFor(object) ??
        turtles.metaFor(object),
      setHovered: (object, instanceId) => {
        if (hovered) {
          if (!xchFish.setHighlight(hovered.object, hovered.index, false)) {
            catFish.setHighlight(hovered.object, hovered.index, false);
          }
          hovered = null;
        }
        if (object && instanceId !== undefined) {
          if (
            xchFish.setHighlight(object, instanceId, true) ||
            catFish.setHighlight(object, instanceId, true)
          ) {
            hovered = { object, index: instanceId };
          }
        }
      },
    };
  },
};
