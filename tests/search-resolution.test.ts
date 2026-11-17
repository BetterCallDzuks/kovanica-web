import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseSearchQuery,
  resolveSearchQuery,
  resolveSearchQueryAsync,
  buildHexCandidates,
} from "../src/lib/search/resolver";

// Frozen protocol vectors from protocol/testvectors/vectors.json
const ADDR_1 = "kvnc8d4z00xwk6jz6c4r4rgz5mcdwdjny9thrh3y8f36cpy2rz6emg54rufktdag";
const PUBKEY_1 = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

const ADDR_2 = "kvnck2559l6vnpcchmtkuf2eslmdtxc6wtfm9nf9zqqructs4336nla58y78mdag";
const PUBKEY_2 = "b2a942ff4c98718bed76e255987f6d59b1a72d3b2cd2510003e6170ac63a9ffb";

const SAMPLE_HASH_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const SAMPLE_HASH_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const SAMPLE_HASH_3 = "3333333333333333333333333333333333333333333333333333333333333333";

test("1. Canonical PRO-21 addresses (64-char kvnc...dag) resolve to address / account views", () => {
  // Test valid lowercase address
  const res1 = resolveSearchQuery(ADDR_1);
  assert.equal(res1.ok, true);
  assert.equal(res1.parse.type, "address");
  assert.equal(res1.target?.type, "address");
  assert.equal(res1.target?.path, "/wallet");
  assert.deepEqual(res1.target?.search, { address: ADDR_1 });
  assert.equal(res1.target?.url, `/wallet?address=${ADDR_1}`);

  // Test case insensitivity and whitespace trimming
  const res2 = resolveSearchQuery(`  ${ADDR_2.toUpperCase()} `);
  assert.equal(res2.ok, true);
  assert.equal(res2.parse.type, "address");
  assert.equal(res2.target?.url, `/wallet?address=${ADDR_2}`);

  // Test explicit address prefix: addr:, address:, account:
  for (const prefix of ["addr:", "address:", "account:"]) {
    const res = resolveSearchQuery(`${prefix}${ADDR_1}`);
    assert.equal(res.ok, true);
    assert.equal(res.target?.type, "address");
    assert.equal(res.target?.url, `/wallet?address=${ADDR_1}`);
  }
});

test("1b. 64-char hex public keys resolve to address / account views", () => {
  // Explicit pubkey prefix
  const res1 = resolveSearchQuery(`pubkey:${PUBKEY_1}`);
  assert.equal(res1.ok, true);
  assert.equal(res1.target?.type, "address");
  assert.equal(res1.target?.url, `/wallet?address=${ADDR_1}`);

  const res2 = resolveSearchQuery(`key:0x${PUBKEY_2}`);
  assert.equal(res2.ok, true);
  assert.equal(res2.target?.type, "address");
  assert.equal(res2.target?.url, `/wallet?address=${ADDR_2}`);

  // 66-hex versioned public key (00 + 64 hex)
  const res3 = resolveSearchQuery(`00${PUBKEY_1}`);
  assert.equal(res3.ok, true);
  assert.equal(res3.target?.type, "address");
  assert.equal(res3.target?.url, `/wallet?address=${ADDR_1}`);

  // Address candidate generated in ambiguous hex candidate list
  const cand = buildHexCandidates(PUBKEY_1);
  const accountCand = cand.find((c) => c.type === "address");
  assert.ok(accountCand);
  assert.equal(accountCand.url, `/wallet?address=${ADDR_1}`);
});

test("2. Token / Collection IDs route to collection, nft, or rwa views", () => {
  // Collection ID with prefix
  const resCol = resolveSearchQuery(`collection:${SAMPLE_HASH_1}`);
  assert.equal(resCol.ok, true);
  assert.equal(resCol.target?.type, "collection");
  assert.equal(resCol.target?.path, "/wallet/collection/$collectionId");
  assert.deepEqual(resCol.target?.params, { collectionId: SAMPLE_HASH_1 });
  assert.equal(resCol.target?.url, `/wallet/collection/${SAMPLE_HASH_1}`);

  const resColShort = resolveSearchQuery(`col:0x${SAMPLE_HASH_1}`);
  assert.equal(resColShort.ok, true);
  assert.equal(resColShort.target?.url, `/wallet/collection/${SAMPLE_HASH_1}`);

  // NFT Asset ID with prefix
  const resNft = resolveSearchQuery(`nft:${SAMPLE_HASH_2}`);
  assert.equal(resNft.ok, true);
  assert.equal(resNft.target?.type, "nft");
  assert.equal(resNft.target?.path, "/wallet/nft/$assetId");
  assert.deepEqual(resNft.target?.params, { assetId: SAMPLE_HASH_2 });
  assert.equal(resNft.target?.url, `/wallet/nft/${SAMPLE_HASH_2}`);

  // RWA Asset ID with prefix
  const resRwa = resolveSearchQuery(`rwa:${SAMPLE_HASH_3}`);
  assert.equal(resRwa.ok, true);
  assert.equal(resRwa.target?.type, "rwa");
  assert.equal(resRwa.target?.path, "/explorer/rwa/$assetId");
  assert.deepEqual(resRwa.target?.params, { assetId: SAMPLE_HASH_3 });
  assert.equal(resRwa.target?.url, `/explorer/rwa/${SAMPLE_HASH_3}`);

  // Token ID or symbol
  const resTokenSymbol = resolveSearchQuery("KUNA");
  assert.equal(resTokenSymbol.ok, true);
  assert.equal(resTokenSymbol.target?.type, "token");
  assert.equal(resTokenSymbol.target?.url, "/wallet/token-listings");

  const resTokenPrefix = resolveSearchQuery("token:PAPER");
  assert.equal(resTokenPrefix.ok, true);
  assert.equal(resTokenPrefix.target?.type, "token");
  assert.equal(resTokenPrefix.target?.url, "/wallet/token-listings");
});

test("2b. Asynchronous probing resolves 32-byte hex to RWA, NFT, or Collection", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Stub fetch to simulate an RWA asset endpoint response
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/api/rwa/${SAMPLE_HASH_1}`)) {
        return Response.json({ asset_id: SAMPLE_HASH_1, kind: "rwa" });
      }
      if (url.includes(`/api/nft/${SAMPLE_HASH_2}`)) {
        return Response.json({ asset_id: SAMPLE_HASH_2, kind: "nft" });
      }
      if (url.includes(`/api/collection/${SAMPLE_HASH_3}`)) {
        return Response.json({ collection_id: SAMPLE_HASH_3, assets: [] });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const rwaRes = await resolveSearchQueryAsync(SAMPLE_HASH_1, { probeEndpoints: true });
    assert.equal(rwaRes.ok, true);
    assert.equal(rwaRes.target?.type, "rwa");
    assert.equal(rwaRes.target?.url, `/explorer/rwa/${SAMPLE_HASH_1}`);

    const nftRes = await resolveSearchQueryAsync(SAMPLE_HASH_2, { probeEndpoints: true });
    assert.equal(nftRes.ok, true);
    assert.equal(nftRes.target?.type, "nft");
    assert.equal(nftRes.target?.url, `/wallet/nft/${SAMPLE_HASH_2}`);

    const colRes = await resolveSearchQueryAsync(SAMPLE_HASH_3, { probeEndpoints: true });
    assert.equal(colRes.ok, true);
    assert.equal(colRes.target?.type, "collection");
    assert.equal(colRes.target?.url, `/wallet/collection/${SAMPLE_HASH_3}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("3. 32-byte / 64-char hex block digests and transaction hashes route to block / transaction views", () => {
  // Explicit block prefix
  const resBlock = resolveSearchQuery(`block:${SAMPLE_HASH_1}`);
  assert.equal(resBlock.ok, true);
  assert.equal(resBlock.target?.type, "block");
  assert.equal(resBlock.target?.path, "/explorer");
  assert.deepEqual(resBlock.target?.search, { block: SAMPLE_HASH_1 });
  assert.equal(resBlock.target?.url, `/explorer?block=${SAMPLE_HASH_1}`);

  // Explicit tx prefix
  const resTx = resolveSearchQuery(`tx:${SAMPLE_HASH_2}`);
  assert.equal(resTx.ok, true);
  assert.equal(resTx.target?.type, "tx");
  assert.equal(resTx.target?.path, "/explorer");
  assert.deepEqual(resTx.target?.search, { tx: SAMPLE_HASH_2 });
  assert.equal(resTx.target?.url, `/explorer?tx=${SAMPLE_HASH_2}`);

  // Matching in-memory DAG blocks
  const mockBlocks = [
    {
      id: SAMPLE_HASH_1,
      txs: [{ id: SAMPLE_HASH_2 }],
    },
  ];

  // Raw 64-hex matching block
  const resDagBlock = resolveSearchQuery(SAMPLE_HASH_1, { blocks: mockBlocks });
  assert.equal(resDagBlock.ok, true);
  assert.equal(resDagBlock.target?.type, "block");
  assert.equal(resDagBlock.target?.url, `/explorer?block=${SAMPLE_HASH_1}`);

  // Raw 64-hex matching tx inside block
  const resDagTx = resolveSearchQuery(SAMPLE_HASH_2, { blocks: mockBlocks });
  assert.equal(resDagTx.ok, true);
  assert.equal(resDagTx.target?.type, "tx");
  assert.equal(resDagTx.target?.url, `/explorer?tx=${SAMPLE_HASH_2}`);
});

test("4. Clear error/unrecognized feedback or empty states for malformed search queries without throwing router exceptions", () => {
  // Empty query
  const resEmpty = resolveSearchQuery("");
  assert.equal(resEmpty.ok, false);
  assert.equal(resEmpty.empty, true);
  assert.ok(resEmpty.error);

  const resWhitespace = resolveSearchQuery("    ");
  assert.equal(resWhitespace.ok, false);
  assert.equal(resWhitespace.empty, true);

  // Malformed PRO-21 address: invalid length (< 64 chars)
  const resShortAddr = resolveSearchQuery("kvnc12345dag");
  assert.equal(resShortAddr.ok, false);
  assert.equal(resShortAddr.parse.type, "malformed");
  assert.match(resShortAddr.error!, /expected exactly 64 characters/i);

  // Malformed PRO-21 address: invalid checksum
  const badChecksumAddr = "kvnc" + "0".repeat(57) + "dag";
  const resBadChecksum = resolveSearchQuery(badChecksumAddr);
  assert.equal(resBadChecksum.ok, false);
  assert.equal(resBadChecksum.parse.type, "malformed");
  assert.match(resBadChecksum.error!, /malformed pro-21 address/i);

  // Malformed hex hash: length != 64
  const resShortHex = resolveSearchQuery("0x1234567890abcdef");
  assert.equal(resShortHex.ok, false);
  assert.equal(resShortHex.parse.type, "malformed");
  assert.match(resShortHex.error!, /expected 64 hex characters/i);

  // Prefixed with invalid payload
  const resBadPrefixedBlock = resolveSearchQuery("block:not_a_hex_digest");
  assert.equal(resBadPrefixedBlock.ok, false);
  assert.equal(resBadPrefixedBlock.parse.type, "malformed");
  assert.match(resBadPrefixedBlock.error!, /expected 64 hex characters/i);

  const resBadPrefixedAddr = resolveSearchQuery("addr:kvncinvalid");
  assert.equal(resBadPrefixedAddr.ok, false);
  assert.equal(resBadPrefixedAddr.parse.type, "malformed");
  assert.match(resBadPrefixedAddr.error!, /not a valid pro-21 address/i);

  // Unrecognized random query
  const resRandom = resolveSearchQuery("arbitrary text query 123");
  assert.equal(resRandom.ok, false);
  assert.equal(resRandom.parse.type, "unrecognized");
  assert.match(resRandom.error!, /unrecognized search query/i);

  // Completely safe: None of these throw any router exceptions!
  assert.doesNotThrow(() => parseSearchQuery("!@#$%^&*()_+"));
  assert.doesNotThrow(() => resolveSearchQuery("!@#$%^&*()_+"));
  assert.doesNotThrow(() => resolveSearchQuery("undefined"));
  assert.doesNotThrow(() => resolveSearchQuery("null"));
});
