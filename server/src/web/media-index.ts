import type { MediaKind } from "@grove/shared";
import { BoundedMap } from "../util/bounded-map.js";

export interface MediaEntry {
  url: string;
  kind: MediaKind;
  // Secondary URL the /img proxy falls back to when `url` fails (non-2xx or a
  // fetch error). Set when ContentFilter upgrades `url` to the Archive CDN — it
  // keeps the original on-chain art URL here so an intermittent Archive outage
  // doesn't make the art unrenderable (which would trip the client's
  // image→video kind-escalation and show a still image as a black <video>).
  fallbackUrl?: string;
  // Static thumbnail image served by /thumbnail?nft= for video NFTs. The gallery
  // loads this as the poster instead of trying to decode a video frame, avoiding
  // a blank wall before the user clicks play.
  thumbnailUrl?: string;
}

/**
 * Bounded NFT launcherId → media-URL map. Lets the image proxy resolve an NFT
 * launcher id to the on-chain art URL the server itself decoded, so /img never
 * accepts an arbitrary client-supplied URL. Keyed by launcherId (stable across
 * every spend of an NFT) so entries coalesce and the proxy URL stays cacheable.
 * Cap should be >= the event ring buffer so anything a client can replay stays
 * resolvable; oldest entries evict first.
 */
export class MediaIndex {
  private readonly store: BoundedMap<string, MediaEntry>;
  /**
   * Entries held outside the bounded map so they never evict: the gallery's
   * permanent collection (web/collection.ts), whose art must stay resolvable
   * long after its last spend has aged out of the live window. A live entry
   * for the same launcher wins; the pin is the fallback.
   */
  private readonly pinned = new Map<string, MediaEntry>();

  constructor(capacity: number) {
    this.store = new BoundedMap(capacity);
  }

  set(launcherId: string, entry: MediaEntry): void {
    this.store.set(launcherId, entry);
  }

  get(launcherId: string): MediaEntry | undefined {
    return this.store.get(launcherId) ?? this.pinned.get(launcherId);
  }

  /** Remove an entry (pinned or not) so /img?nft=<launcherId> can no longer resolve it. */
  delete(launcherId: string): void {
    this.store.delete(launcherId);
    this.pinned.delete(launcherId);
  }

  /** Keep `entry` resolvable regardless of eviction, until `unpin`/`delete`. */
  pin(launcherId: string, entry: MediaEntry): void {
    this.pinned.set(launcherId, entry);
  }

  /** Drop a pin; a live entry for the launcher (if any) is untouched. */
  unpin(launcherId: string): void {
    this.pinned.delete(launcherId);
  }

  /** Iterate every live [launcherId, entry] pair (insertion order); pins are not included. */
  entries(): IterableIterator<[string, MediaEntry]> {
    return this.store.entries();
  }
}
