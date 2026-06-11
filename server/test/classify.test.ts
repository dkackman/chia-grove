import { expect, test } from "vitest";
import {
  Cat,
  CatInfo,
  CatSpend,
  Clvm,
  Coin,
  Constants,
  NftMint,
  Simulator,
  standardPuzzleHash,
  type CoinSpend,
  type PublicKey,
} from "chia-wallet-sdk";
import { classifyBlock, type BlockInput } from "../src/classify/classify.js";
import type { SproutEvent } from "@grove/shared";

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
  for (const s of nftSprouts) expect(s.imageUrl).toBeUndefined(); // nil metadata

  expect(result.filter((s) => s.kind === "did").length).toBeGreaterThan(0);
  expect(result.filter((s) => s.kind === "xch").length).toBeGreaterThan(0);
  // no sprout is a launcher spend
  expect(result).toHaveLength(spends.length - launcherSpendCount);
});
