import type { GroveEvent } from "@grove/shared";

/** Launcher id a content-flag event targets, or null for any other event. */
export function contentFlagTarget(event: GroveEvent): string | null {
  return event.type === "content-flag" ? event.launcherId : null;
}
