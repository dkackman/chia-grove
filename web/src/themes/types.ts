import type * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";

/**
 * The detail-card payload for a picked object. Usually a single spend; the board
 * also surfaces aggregated XCH/CAT rows, where `amount` is the block-wide total
 * and `aggregate.count` is how many spends it folds in. The card uses the count
 * to avoid presenting an aggregate as if it were one coin.
 */
export type CardMeta = SproutEvent & { aggregate?: { count: number } };

/** What the shared UI (picker, detail card) needs from a running scene. */
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): CardMeta | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}

export interface Visualization {
  id: string;
  label: string;
  legend: ReadonlyArray<readonly [swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}
