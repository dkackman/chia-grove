/**
 * Small, high-precision starter set of adult-content terms. A whole-word match
 * (case-insensitive) in an NFT's name/description/collection-name text flags the
 * NFT as `sensitive` (blur), not `blocked` — keyword matching is fuzzy, so the
 * response is reversible. Tune this list via PR.
 */
export const LEXICON: string[] = [
  "porn",
  "xxx",
  "nsfw",
  "hentai",
  "nude",
  "nudity",
  "naked",
  "erotic",
  "erotica",
  "fetish",
  "hardcore",
  "explicit",
  "onlyfans",
];

const escape = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build one case-insensitive, word-boundary regex from a term list. */
const compile = (terms: string[]): RegExp | null =>
  terms.length === 0 ? null : new RegExp(`\\b(?:${terms.map(escape).join("|")})\\b`, "i");

const DEFAULT_RE = compile(LEXICON);

/**
 * True if `text` contains any term as a whole word (case-insensitive). Word
 * boundaries stop benign substrings (e.g. "sex" inside "Sussex") from matching.
 */
export function matchesLexicon(text: string, terms: string[] = LEXICON): boolean {
  if (text === "") return false;
  const re = terms === LEXICON ? DEFAULT_RE : compile(terms);
  return re !== null && re.test(text);
}
