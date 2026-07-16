export type Disposition = "blocked" | "sensitive" | "ok";

export interface Verdict {
  disposition: Disposition;
  /** True when an allow-list match (creator DID + collection id) resolved
   *  this "ok" verdict; used to skip the Vision SafeSearch check. Never set
   *  when disposition is not "ok" — the allow-list cannot override a
   *  negative signal. */
  whitelisted?: boolean;
  /** Which cheap signal determined this verdict (e.g. "creator-verification",
   *  "denylist", "lexicon", "whitelist"). Undefined for a plain clean result
   *  where nothing fired. Carried through to the store and the
   *  "content-filter: verdict" log so every disposition is traceable to its cause. */
  signal?: string;
}
