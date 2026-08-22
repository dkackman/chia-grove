import { log } from "../../logger.js";
import { DEFAULT_WHITELIST, buildWhitelistSet, type WhitelistEntry } from "./whitelist.js";

const FETCH_TIMEOUT_MS = 10_000;

export interface WhitelistRegistryOptions {
  /** Raw-content URL of the gist/file holding the WhitelistEntry[] JSON. Unset
   *  (e.g. WHITELIST_GIST_URL not configured) skips the fetch entirely and
   *  runs on the bundled DEFAULT_WHITELIST. */
  gistUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isWhitelistEntry(v: unknown): v is WhitelistEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (e.creatorDid !== undefined && typeof e.creatorDid !== "string") return false;
  if (e.collectionId !== undefined && typeof e.collectionId !== "string") return false;
  return e.creatorDid !== undefined || e.collectionId !== undefined;
}

/**
 * Loads the collection/creator allow-list from a remote gist at startup, so
 * the list can be curated without a build/deploy. Falls back to the bundled
 * DEFAULT_WHITELIST (see whitelist.ts) whenever the gist is unconfigured,
 * unreachable, or malformed — a bad or missing gist degrades the Vision-skip
 * optimization, never blocks startup or content-filter correctness.
 */
export class WhitelistRegistry {
  private set: Set<string>;
  private readonly gistUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: WhitelistRegistryOptions = {}) {
    this.set = buildWhitelistSet(DEFAULT_WHITELIST);
    this.gistUrl = opts.gistUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  }

  get(): Set<string> {
    return this.set;
  }

  /** Fetch once; on any failure, log a distinct error and keep the bundled default. */
  async start(): Promise<void> {
    if (!this.gistUrl) {
      log.info("whitelist registry has no gistUrl configured; using bundled default");
      return;
    }
    try {
      const entries = await this.fetchEntries(this.gistUrl);
      this.set = buildWhitelistSet(entries);
      log.info(
        { count: this.set.size, gistUrl: this.gistUrl },
        "whitelist registry loaded from gist"
      );
    } catch (err) {
      log.error(
        { err, gistUrl: this.gistUrl, event: "whitelist_gist_load_failed" },
        "whitelist registry failed to load gist; using bundled default"
      );
    }
  }

  private async fetchEntries(gistUrl: string): Promise<WhitelistEntry[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let body: unknown;
    try {
      const res = await this.fetchImpl(gistUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`whitelist gist fetch ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(body) || !body.every(isWhitelistEntry)) {
      throw new Error("whitelist gist payload is not a WhitelistEntry[]");
    }
    return body;
  }
}
