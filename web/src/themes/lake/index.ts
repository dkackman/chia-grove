import * as THREE from "three";
import type { Visualization } from "../types.js";
import { catColor } from "../shared/cat-color.js";
import { startLake } from "./lake.js";
import { LAKE } from "./palette.js";
import { fishSize, schoolSize } from "./scales.js";
import { Shoal } from "./shoal.js";
import { Jellies } from "./jellies.js";

export const lake: Visualization = {
  id: "lake",
  label: "lake",
  legend: [
    ["sw-fish", "fish — XCH spend (size = amount)"],
    ["sw-school", "school — CAT (color = asset)"],
    ["sw-jelly", "jellyfish — NFT (clickable)"],
    ["sw-turtle", "turtle — DID"],
    ["sw-ripple", "ripple — new block"],
    ["sw-bubble", "bubbles — mempool"],
    ["sw-shaft", "light shafts — netspace"],
    ["sw-reorg", "strike — reorg"],
  ],
  start(canvas, feed) {
    const runtime = startLake(canvas, feed);
    const xchFish = new Shoal(runtime.scene, LAKE.xchFish);
    const catFish = new Shoal(runtime.scene, 0xffffff);
    const jellies = new Jellies(runtime.scene);
    const schoolColor = new THREE.Color();
    let hovered: { object: THREE.Object3D; index: number } | null = null;

    runtime.setSproutHandler((event, blocksSeen) => {
      if (event.kind === "xch") {
        xchFish.plant(event, blocksSeen, fishSize(event.amount), null);
        return;
      }
      if (event.kind === "cat") {
        const { h, s, l } = catColor(event.assetId ?? event.coinId);
        schoolColor.setHSL(h, s, l);
        const count = schoolSize(event.amount);
        for (let member = 0; member < count; member++) {
          catFish.plant(event, blocksSeen, 0.5, schoolColor, member);
        }
        return;
      }
      if (event.kind === "nft") {
        // an NFT spent more than once inside the window (a mint is an eve + lineage
        // spend; transfers spend it again) arrives as repeat events — one jellyfish
        // per launcher id, the way the gallery dedupes its canvases
        if (event.launcherId && jellies.has(event.launcherId)) return;
        jellies.plant(event, blocksSeen);
      }
    });
    runtime.setReorgHandler((forkHeight) => {
      xchFish.clearAbove(forkHeight);
      catFish.clearAbove(forkHeight);
      jellies.clearAbove(forkHeight);
    });
    runtime.setContentFlagHandler((launcherId) => jellies.markSensitive(launcherId));

    const frameCallbacks: Array<() => void> = [];
    runtime.setUpdateHandler((_dt, t, blocksSeen) => {
      xchFish.update(t, blocksSeen);
      catFish.update(t, blocksSeen);
      jellies.update(runtime.camera, t, blocksSeen);
      for (const fn of frameCallbacks) fn();
    });

    return {
      camera: runtime.camera,
      onFrame: (fn) => frameCallbacks.push(fn),
      isDragging: () => runtime.isDragging(),
      pickables: () => [...xchFish.pickables(), ...catFish.pickables(), ...jellies.pickables()],
      metaFor: (object, instanceId) =>
        xchFish.metaFor(object, instanceId) ??
        catFish.metaFor(object, instanceId) ??
        jellies.metaFor(object),
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
