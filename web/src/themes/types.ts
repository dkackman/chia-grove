import type * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { GroveFeed } from "../net/feed.js";

/** What the shared UI (picker, detail card) needs from a running scene. */
export interface VisualizationHandle {
  camera: THREE.PerspectiveCamera;
  onFrame(fn: () => void): void;
  /** When true, main.ts skips the shared canvas picker; the theme wires its own input. */
  selfManagedInput?: boolean;
  isDragging?(): boolean;
  pickables?(): THREE.Object3D[];
  metaFor?(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null;
  setHovered?(object: THREE.Object3D | null, instanceId: number | undefined): void;
}

export interface Visualization {
  id: string;
  label: string;
  legend: ReadonlyArray<readonly [swatchClass: string, label: string]>;
  start(canvas: HTMLCanvasElement, feed: GroveFeed): VisualizationHandle;
}
