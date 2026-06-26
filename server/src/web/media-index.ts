import type { MediaKind } from "@grove/shared";

export interface MediaEntry {
  url: string;
  kind: MediaKind;
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
  private readonly map = new Map<string, MediaEntry>();

  constructor(private readonly capacity: number) {}

  set(launcherId: string, entry: MediaEntry): void {
    this.map.delete(launcherId); // re-insert moves key to newest
    this.map.set(launcherId, entry);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get(launcherId: string): MediaEntry | undefined {
    return this.map.get(launcherId);
  }

  /** Remove an entry so /img?nft=<launcherId> can no longer resolve it. */
  delete(launcherId: string): void {
    this.map.delete(launcherId);
  }
}
