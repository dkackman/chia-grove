import { expect, test } from "vitest";
import {
  Cat,
  CatInfo,
  CatSpend,
  Clvm,
  Coin,
  Constants,
  NftMetadata,
  NftMint,
  Simulator,
  standardPuzzleHash,
  type CoinSpend,
  type PublicKey,
} from "chia-wallet-sdk";
import { blockEvent, classifyBlock, type BlockInput } from "../src/classify/classify.js";
import type { SproutEvent } from "@grove/shared";
import { MediaIndex } from "../src/web/media-index.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function block(spends: CoinSpend[], height = 100): BlockInput {
  return {
    height,
    headerHash: "aa".repeat(32),
    timestamp: 1_718_000_000,
    fees: 25n,
    spends,
  };
}

function sprouts(spends: CoinSpend[]): SproutEvent[] {
  return classifyBlock(block(spends)).filter((e): e is SproutEvent => e.type === "sprout");
}

// Mirrors the createDid helper in the SDK's own nfts.spec.ts.
function createDid(clvm: Clvm, parentCoinId: Buffer, pk: PublicKey) {
  const p2PuzzleHash = standardPuzzleHash(pk);
  const eveDid = clvm.createEveDid(parentCoinId, p2PuzzleHash);
  clvm.spendDid(
    eveDid.did,
    clvm.standardSpend(
      pk,
      clvm.delegatedSpend([
        clvm.createCoin(eveDid.did.info.innerPuzzleHash(), 1n, clvm.alloc([p2PuzzleHash])),
      ])
    )
  );
  return {
    did: eveDid.did.child(p2PuzzleHash, eveDid.did.info.metadata),
    parentConditions: eveDid.parentConditions,
  };
}

test("emits a block event first with counts and fees", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const events = classifyBlock(block(clvm.coinSpends()));
  expect(events[0]).toEqual({
    type: "block",
    height: 100,
    headerHash: "aa".repeat(32),
    timestamp: 1_718_000_000,
    spendCount: 1,
    fees: "25",
  });
});

// blockEvent() is the same shape classifyBlock() uses for its first event; it
// exists standalone so server/src/index.ts's onBlock can fall back to a bare
// block event (advancing ingest past the block) if classification or
// enrichment throws, without duplicating this literal — see index.ts.
test("blockEvent() matches classifyBlock()'s own first event for the same input", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const b = block(clvm.coinSpends());
  expect(blockEvent(b)).toEqual(classifyBlock(b)[0]);
});

// classifySpend's catch block (classify.ts:113-119) is only reachable by an
// actual throw from deserializeWithBackrefs/parse* — every other test above
// exercises the "parse returns null" miss path, which takes a different
// branch entirely. Corrupting `solution` to bytes that fail CLVM deserialization
// is the most direct way to trigger a genuine throw (confirmed empirically:
// deserializeWithBackrefs throws "Eval error: bad encoding" on non-CLVM bytes).
test("classifySpend falls back to a base xch sprout when puzzle/solution parsing throws", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const [spend] = clvm.coinSpends();
  const corrupted = {
    coin: spend.coin,
    puzzleReveal: spend.puzzleReveal,
    solution: Buffer.from([0xff, 0xff, 0xff, 0xff]),
  } as CoinSpend;

  const result = sprouts([corrupted]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    kind: "xch",
    amount: "1000",
    coinId: hex(alice.coin.coinId()),
  });
});

test("standard spend classifies as xch with mojo amount", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const result = sprouts(clvm.coinSpends());
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    kind: "xch",
    amount: "1000",
    height: 100,
    coinId: hex(alice.coin.coinId()),
  });
  expect(result[0].mint).toBeUndefined();
});

test("cat spend carries deterministic assetId", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1n);
  const tail = clvm.nil();
  const assetId = tail.treeHash();
  const catInfo = new CatInfo(assetId, null, alice.puzzleHash);

  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(catInfo.puzzleHash(), 1n)])
  );
  const eve = new Cat(new Coin(alice.coin.coinId(), catInfo.puzzleHash(), 1n), null, catInfo);
  clvm.spendCats([
    new CatSpend(
      eve,
      clvm.standardSpend(
        alice.pk,
        clvm.delegatedSpend([
          clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
          clvm.runCatTail(tail, clvm.nil()),
        ])
      )
    ),
  ]);

  const result = sprouts(clvm.coinSpends());
  const cats = result.filter((s) => s.kind === "cat");
  expect(cats).toHaveLength(1);
  expect(cats[0].assetId).toBe(hex(assetId));
});

test("nft mint flow yields nft sprout with mint flag and did sprout; launcher spends excluded", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(2n);

  const { did, parentConditions: didParentConditions } = createDid(
    clvm,
    alice.coin.coinId(),
    alice.pk
  );
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend(didParentConditions.concat([clvm.createCoin(alice.puzzleHash, 0n)]))
  );

  const mintCoin = new Coin(alice.coin.coinId(), alice.puzzleHash, 0n);
  const {
    nfts: [nft],
    parentConditions: mintParentConditions,
  } = clvm.mintNfts(mintCoin.coinId(), [
    new NftMint(
      clvm.nil(),
      Constants.nftMetadataUpdaterDefaultHash(),
      alice.puzzleHash,
      alice.puzzleHash,
      300,
      null
    ),
  ]);
  clvm.spendStandardCoin(mintCoin, alice.pk, clvm.delegatedSpend(mintParentConditions));
  clvm.spendNft(
    nft,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.transferNft(did.info.launcherId, [], did.info.innerPuzzleHash()),
      ])
    )
  );
  clvm.spendDid(
    did,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.createPuzzleAnnouncement(nft.info.launcherId),
      ])
    )
  );

  const spends = clvm.coinSpends();
  const result = sprouts(spends);

  const launcherHash = hex(Constants.singletonLauncherHash());
  const launcherSpendCount = spends.filter((s) => hex(s.coin.puzzleHash) === launcherHash).length;
  expect(launcherSpendCount).toBeGreaterThan(0);

  const nftSprouts = result.filter((s) => s.kind === "nft");
  expect(nftSprouts).toHaveLength(2); // eve (mint) + child transfer
  const mints = nftSprouts.filter((s) => s.mint === true);
  expect(mints).toHaveLength(1);
  expect(mints[0].launcherId).toBe(hex(nft.info.launcherId));
  const transfers = nftSprouts.filter((s) => !s.mint);
  expect(transfers).toHaveLength(1);
  expect(transfers[0].launcherId).toBe(hex(nft.info.launcherId));
  for (const s of nftSprouts) expect(s.mediaKind).toBeUndefined(); // nil metadata
  for (const s of nftSprouts) {
    expect(s.nftId).toMatch(/^nft1[ac-hj-np-z02-9]{58}$/); // bech32m, 62 chars total
  }

  expect(result.filter((s) => s.kind === "did").length).toBeGreaterThan(0);
  expect(result.filter((s) => s.kind === "xch").length).toBeGreaterThan(0);
  // no sprout is a launcher spend
  expect(result).toHaveLength(spends.length - launcherSpendCount);
});

test("classifies a heterogeneous block (cat + nft + did + xch) correctly", () => {
  // Guards classifyBlock's parse allocator against cross-spend contamination
  // when every kind is parsed in one block: a CAT built independently is
  // concatenated with a full NFT-mint flow (which also yields DID + XCH), so a
  // single classifyBlock pass parses all four kinds back to back.
  const sim = new Simulator();

  const catClvm = new Clvm();
  const catOwner = sim.bls(1n);
  const tail = catClvm.nil();
  const assetId = tail.treeHash();
  const catInfo = new CatInfo(assetId, null, catOwner.puzzleHash);
  catClvm.spendStandardCoin(
    catOwner.coin,
    catOwner.pk,
    catClvm.delegatedSpend([catClvm.createCoin(catInfo.puzzleHash(), 1n)])
  );
  const eve = new Cat(new Coin(catOwner.coin.coinId(), catInfo.puzzleHash(), 1n), null, catInfo);
  catClvm.spendCats([
    new CatSpend(
      eve,
      catClvm.standardSpend(
        catOwner.pk,
        catClvm.delegatedSpend([
          catClvm.createCoin(catOwner.puzzleHash, 1n, catClvm.alloc([catOwner.puzzleHash])),
          catClvm.runCatTail(tail, catClvm.nil()),
        ])
      )
    ),
  ]);

  const nftClvm = new Clvm();
  const alice = sim.bls(2n);
  const { did, parentConditions: didParentConditions } = createDid(
    nftClvm,
    alice.coin.coinId(),
    alice.pk
  );
  nftClvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    nftClvm.delegatedSpend(didParentConditions.concat([nftClvm.createCoin(alice.puzzleHash, 0n)]))
  );
  const mintCoin = new Coin(alice.coin.coinId(), alice.puzzleHash, 0n);
  const {
    nfts: [nft],
    parentConditions: mintParentConditions,
  } = nftClvm.mintNfts(mintCoin.coinId(), [
    new NftMint(
      nftClvm.nil(),
      Constants.nftMetadataUpdaterDefaultHash(),
      alice.puzzleHash,
      alice.puzzleHash,
      300,
      null
    ),
  ]);
  nftClvm.spendStandardCoin(mintCoin, alice.pk, nftClvm.delegatedSpend(mintParentConditions));
  nftClvm.spendNft(
    nft,
    nftClvm.standardSpend(
      alice.pk,
      nftClvm.delegatedSpend([
        nftClvm.createCoin(alice.puzzleHash, 1n, nftClvm.alloc([alice.puzzleHash])),
        nftClvm.transferNft(did.info.launcherId, [], did.info.innerPuzzleHash()),
      ])
    )
  );
  nftClvm.spendDid(
    did,
    nftClvm.standardSpend(
      alice.pk,
      nftClvm.delegatedSpend([
        nftClvm.createCoin(alice.puzzleHash, 1n, nftClvm.alloc([alice.puzzleHash])),
        nftClvm.createPuzzleAnnouncement(nft.info.launcherId),
      ])
    )
  );

  const result = sprouts(catClvm.coinSpends().concat(nftClvm.coinSpends()));

  const cats = result.filter((s) => s.kind === "cat");
  expect(cats).toHaveLength(1);
  expect(cats[0].assetId).toBe(hex(assetId)); // deterministic id survives co-parsing
  expect(result.filter((s) => s.kind === "nft").length).toBeGreaterThanOrEqual(1);
  expect(result.filter((s) => s.kind === "did").length).toBeGreaterThan(0);
  expect(result.filter((s) => s.kind === "xch").length).toBeGreaterThan(0);
});

test("nft with http art url writes to MediaIndex and emits mediaKind", () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(2n);

  const { did, parentConditions: didParentConditions } = createDid(
    clvm,
    alice.coin.coinId(),
    alice.pk
  );
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend(didParentConditions.concat([clvm.createCoin(alice.puzzleHash, 0n)]))
  );

  const artUrl = "https://example.com/art.png";
  const metadata = new NftMetadata(1n, 1n, [artUrl], null, [], null, []);
  const metadataProgram = clvm.nftMetadata(metadata);

  const mintCoin = new Coin(alice.coin.coinId(), alice.puzzleHash, 0n);
  const {
    nfts: [nft],
    parentConditions: mintParentConditions,
  } = clvm.mintNfts(mintCoin.coinId(), [
    new NftMint(
      metadataProgram,
      Constants.nftMetadataUpdaterDefaultHash(),
      alice.puzzleHash,
      alice.puzzleHash,
      300,
      null
    ),
  ]);
  clvm.spendStandardCoin(mintCoin, alice.pk, clvm.delegatedSpend(mintParentConditions));
  clvm.spendNft(
    nft,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.transferNft(did.info.launcherId, [], did.info.innerPuzzleHash()),
      ])
    )
  );
  clvm.spendDid(
    did,
    clvm.standardSpend(
      alice.pk,
      clvm.delegatedSpend([
        clvm.createCoin(alice.puzzleHash, 1n, clvm.alloc([alice.puzzleHash])),
        clvm.createPuzzleAnnouncement(nft.info.launcherId),
      ])
    )
  );

  const media = new MediaIndex(100);
  const events = classifyBlock(block(clvm.coinSpends()), undefined, media);

  const nftWithArt = events.find(
    (e): e is SproutEvent => e.type === "sprout" && e.kind === "nft" && e.mediaKind !== undefined
  );
  expect(nftWithArt).toBeDefined();
  expect(nftWithArt!.mediaKind).toBe("image");
  // resolvable by launcherId (stable across spends), not the per-spend coinId
  expect(media.get(nftWithArt!.launcherId!)).toEqual({ url: artUrl, kind: "image" });
  expect(nftWithArt!.launcherId).toBe(hex(nft.info.launcherId));
});
