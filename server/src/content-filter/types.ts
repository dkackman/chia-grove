export type Disposition = "blocked" | "sensitive" | "ok";

export type SignalName =
  | "chip7"
  | "mintgarden"
  | "mintgarden-creator"
  | "denylist"
  | "lexicon"
  | "safesearch";

export interface Verdict {
  disposition: Disposition;
  signals: SignalName[];
}
