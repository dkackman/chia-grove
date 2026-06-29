export type Disposition = "blocked" | "sensitive" | "ok";

export interface Verdict {
  disposition: Disposition;
}
