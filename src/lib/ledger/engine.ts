import { hashHex } from "./hash";
import { HALVING_ERA } from "../api/contract";
import { ATOM, K, SUBSIDY, type Block, type Colour, type Tx } from "./types";
import {
  bytesToHex,
  buildNameRegisterCall,
  buildHtlcCreateCall,
  buildNftMintCall,
  buildEscrowCreateCall,
} from "../contracts/decoders";

const TREASURY = "cecc1507dc1ddd7295951c290888f095adb9044d1b73d696e6df065d683bd4fc";

function txId(payload: string): string {
  return hashHex(`tx:${payload}`);
}

export function genesisBlock(): Block {
  const coinbase: Tx = {
    id: txId("genesis-coinbase"),
    coinbase: true,
    to: TREASURY,
    amount: SUBSIDY,
  };
  const id = hashHex("kovanica-genesis-v1");
  return {
    id,
    parents: [],
    selectedParent: null,
    work: 1,
    timestamp: 0,
    nonce: 0,
    blueScore: 0,
    colour: "genesis",
    height: 0,
    txs: [coinbase],
  };
}

function colourOf(height: number, isChain: boolean): Colour {
  if (height === 0) return "genesis";
  if (isChain) return "chain";
  return height % 7 === 0 ? "red" : "blue";
}

export function seedDag(): Block[] {
  const g = genesisBlock();
  const blocks: Block[] = [g];
  let tip = g.id;
  let side = g.id;

  for (let i = 1; i <= 8; i += 1) {
    const parents = i % 3 === 0 ? [tip, side] : [tip];
    const sampleTxs: Tx[] = [];
    if (i === 1) {
      sampleTxs.push({
        id: txId("sample-transfer-1"),
        coinbase: false,
        from: TREASURY,
        to: "44".repeat(32),
        amount: 25 * ATOM,
        kind: "Transfer",
      });
    } else if (i === 2) {
      sampleTxs.push({
        id: txId("sample-name-register"),
        coinbase: false,
        kind: "Call",
        contract: "11".repeat(32),
        method: "name_register",
        args: bytesToHex(
          buildNameRegisterCall("alice", new Uint8Array(32).fill(0x11), [
            "https://relay1.kovanica.online",
            "https://relay2.kovanica.online",
          ]),
        ),
        amount: 0,
        call_value: 0,
        gas_limit: 100_000,
      });
    } else if (i === 3) {
      sampleTxs.push({
        id: txId("sample-htlc-create"),
        coinbase: false,
        kind: "Call",
        contract: "22".repeat(32),
        method: "htlc_create",
        args: bytesToHex(
          buildHtlcCreateCall(
            new Uint8Array(32).fill(0xaa),
            1750000000n,
            new Uint8Array(32).fill(0xbb),
          ),
        ),
        amount: 5 * ATOM,
        call_value: 5 * ATOM,
        gas_limit: 100_000,
      });
    } else if (i === 4) {
      sampleTxs.push({
        id: txId("sample-nft-mint"),
        coinbase: false,
        kind: "Call",
        contract: "33".repeat(32),
        method: "nft_mint",
        args: bytesToHex(
          buildNftMintCall(
            new Uint8Array(32).fill(0xcc),
            new Uint8Array(32).fill(0xdd),
            42n,
            "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
          ),
        ),
        amount: 0,
        call_value: 0,
        gas_limit: 120_000,
      });
    } else if (i === 5) {
      sampleTxs.push({
        id: txId("sample-escrow-create"),
        coinbase: false,
        kind: "Call",
        contract: "44".repeat(32),
        method: "escrow_create",
        args: bytesToHex(
          buildEscrowCreateCall(
            [new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22)],
            2,
            500_000_000n,
            1750000000n,
          ),
        ),
        amount: 500_000_000,
        call_value: 500_000_000,
        gas_limit: 150_000,
      });
    } else if (i === 6) {
      sampleTxs.push({
        id: txId("sample-deploy"),
        coinbase: false,
        kind: "Deploy",
        amount: 0,
      });
    }

    const next = mineBlock(blocks, parents, TREASURY, {
      nonce: i * 17,
      timestamp: i * 4_000,
      txs: sampleTxs,
    });
    blocks.push(next);
    if (i % 2 === 0) side = next.id;
    else tip = next.id;
  }

  return recast(blocks);
}

export function mineBlock(
  blocks: Block[],
  parentIds?: string[],
  miner?: string,
  opts?: { nonce?: number; timestamp?: number; txs?: Tx[] },
): Block {
  const tips = tipsOf(blocks);
  const parents = (parentIds && parentIds.length ? parentIds : pickParents(tips)).slice(0, K);
  const selectedParent = heaviest(blocks, parents);
  const parent = blocks.find((b) => b.id === selectedParent);
  const height = (parent?.height ?? -1) + 1;
  const blueScore = (parent?.blueScore ?? 0) + 1;
  const nonce = opts?.nonce ?? Math.floor(Math.random() * 1e9);
  const timestamp = opts?.timestamp ?? Date.now();
  const coinbase: Tx = {
    id: txId(`cb:${height}:${timestamp}:${miner ?? "none"}`),
    coinbase: true,
    to: miner,
    amount: subsidyAt(height),
  };
  const id = hashHex(`${parents.join(",")}|${height}|${nonce}|${timestamp}|${miner ?? ""}`);
  return {
    id,
    parents,
    selectedParent,
    work: 1,
    timestamp,
    nonce,
    blueScore,
    colour: "blue",
    height,
    txs: [coinbase, ...(opts?.txs ?? [])],
  };
}


export function recast(blocks: Block[]): Block[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const genesis = blocks.find((b) => b.parents.length === 0) ?? blocks[0];
  const chain = new Set<string>();
  let cursor: string | null = selectedTip(blocks);
  while (cursor) {
    chain.add(cursor);
    cursor = byId.get(cursor)?.selectedParent ?? null;
  }
  return blocks.map((b) => ({
    ...b,
    colour: b.id === genesis.id ? "genesis" : chain.has(b.id) ? "chain" : colourOf(b.height, false),
  }));
}

export function selectedTip(blocks: Block[]): string {
  let best = blocks[0];
  for (const b of blocks) {
    if (b.blueScore > best.blueScore) best = b;
    else if (b.blueScore === best.blueScore && b.id > best.id) best = b;
  }
  return best.id;
}

export function tipsOf(blocks: Block[]): string[] {
  const referenced = new Set(blocks.flatMap((b) => b.parents));
  return blocks.filter((b) => !referenced.has(b.id)).map((b) => b.id);
}

export function linearize(blocks: Block[]): string[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const b = byId.get(id);
    if (!b) return;
    for (const p of b.parents) visit(p);
    out.push(id);
  };
  for (const t of tipsOf(blocks)) visit(t);
  return out;
}

function pickParents(tips: string[]): string[] {
  if (tips.length === 0) return [];
  const shuffled = [...tips].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(K, shuffled.length));
}

function heaviest(blocks: Block[], ids: string[]): string {
  const set = new Set(ids);
  const candidates = blocks.filter((b) => set.has(b.id));
  if (candidates.length === 0) return ids[0];
  return selectedTip(candidates);
}

export function subsidyAt(height: number): number {
  const s0 = SUBSIDY;
  const eraLen = HALVING_ERA;
  const era = Math.floor(height / eraLen);
  let s = s0;
  for (let e = 1; e <= era; e++) {
    s = Math.floor(s * 3 / 4);
  }
  return Math.max(s, Math.max(1, Math.floor(SUBSIDY / 500_000)));
}

export function supplyOf(blocks: Block[]): number {
  return blocks.reduce((s, b) => s + b.txs.reduce((t, x) => t + x.amount, 0), 0);
}

export { TREASURY };
