import { describe, expect, it } from "vitest";
import { collectionPieces } from "../src/net/collection.js";

const id = (n: number): string => n.toString(16).padStart(64, "0");
const piece = (n: number, over: Record<string, unknown> = {}) => ({
  type: "sprout",
  kind: "nft",
  height: 10 + n,
  coinId: id(100 + n),
  amount: "1",
  launcherId: id(n),
  mediaKind: "image",
  ...over,
});

describe("collectionPieces", () => {
  it("keeps well-formed image pieces in order, up to the limit", () => {
    const out = collectionPieces({ pieces: [piece(1), piece(2), piece(3)] }, 2);
    expect(out.map((p) => p.launcherId)).toEqual([id(1), id(2)]);
  });

  it("never passes a piece marked sensitive or blocked", () => {
    const out = collectionPieces(
      {
        pieces: [
          piece(1, { mediaFilter: "sensitive" }),
          piece(2, { mediaFilter: "blocked" }),
          piece(3),
        ],
      },
      10
    );
    expect(out.map((p) => p.launcherId)).toEqual([id(3)]);
  });

  it("drops non-image, non-NFT, duplicate and malformed entries", () => {
    const out = collectionPieces(
      {
        pieces: [
          piece(1, { mediaKind: "video" }),
          piece(2, { kind: "cat" }),
          piece(3, { launcherId: "../../etc/passwd" }),
          piece(4, { height: "12" }),
          null,
          "nope",
          piece(5),
          piece(5),
        ],
      },
      10
    );
    expect(out.map((p) => p.launcherId)).toEqual([id(5)]);
  });

  it("treats a malformed body as an empty collection", () => {
    expect(collectionPieces(null, 10)).toEqual([]);
    expect(collectionPieces({}, 10)).toEqual([]);
    expect(collectionPieces({ pieces: "x" }, 10)).toEqual([]);
    expect(collectionPieces([piece(1)], 10)).toEqual([]);
  });
});
