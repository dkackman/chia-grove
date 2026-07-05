export type Disposition = "blocked" | "sensitive" | "ok";

export interface Verdict {
  disposition: Disposition;
  /** True when an allow-list match (creator DID + collection id) resolved
   *  this "ok" verdict; used to skip the Vision SafeSearch check. Never set
   *  when disposition is not "ok" — the allow-list cannot override a
   *  negative signal. */
  whitelisted?: boolean;
}
