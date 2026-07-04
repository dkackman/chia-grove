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

  constructor(capacity: number) {
    this.store = new BoundedMap(capacity);
  }

  set(launcherId: string, entry: MediaEntry): void {
    this.store.set(launcherId, entry);
  }

  get(launcherId: string): MediaEntry | undefined {
    return this.store.get(launcherId);
  }

  /** Remove an entry so /img?nft=<launcherId> can no longer resolve it. */
  delete(launcherId: string): void {
    this.store.delete(launcherId);
  }
}
