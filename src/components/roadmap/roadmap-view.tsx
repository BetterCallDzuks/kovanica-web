import { Link } from "@tanstack/react-router";
import { Check, Circle, Loader } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "done" | "active" | "next";

type Item = {
  id: string;
  title: string;
  status: Status;
  blurb: string;
  note?: string;
};

/** Core Protocol Architecture & Wasmi Smart Contracts. */
const PROTOCOL: Item[] = [
  {
    id: "hybrid-consensus",
    title: "Hybrid PoW + GHOSTDAG Consensus",
    status: "done",
    blurb:
      "Hybrid Proof-of-Work block admission with GHOSTDAG graph ordering (4s target block interval, GHOSTDAG k=5, KovanicaHash PoW).",
    note: "Native PoW admission and GHOSTDAG topological sorting.",
  },
  {
    id: "account-ledger",
    title: "Account-Based Ledger & PRO-21 Addresses",
    status: "done",
    blurb:
      "Account-based state model with sequence nonces and canonical PRO-21 addresses (64 chars: kvnc + 57 base32 + dag).",
    note: "BLAKE3 KVNC-TX-v1 (KVNC/tx/v1) sighashes signed client-side with Ed25519 keys.",
  },
  {
    id: "wasmi-runtime",
    title: "Wasmi Deterministic Execution Runtime",
    status: "done",
    blurb:
      "Sandboxed WebAssembly runtime for deterministic smart contract execution, gas metering, and host storage interop.",
  },
  {
    id: "contract-multisig",
    title: "Multisig Contract (kovanica-multisig)",
    status: "done",
    blurb:
      "M-of-N threshold multi-signature Wasmi smart contract supporting partial signature aggregation and activation gating.",
  },
  {
    id: "contract-htlc",
    title: "HTLC Atomic Swaps (kovanica-htlc)",
    status: "done",
    blurb:
      "Hashed time-locked Wasmi smart contract for trustless cross-chain atomic swaps and conditional escrow release.",
  },
  {
    id: "contract-vault",
    title: "Time-Lock Vaults & Vesting (kovanica-vault)",
    status: "done",
    blurb:
      "Deterministic time-lock vault contract supporting linear treasury vesting schedules and revocable time locks.",
  },
  {
    id: "contract-token",
    title: "Fungible Token Standard (kovanica-token)",
    status: "done",
    blurb:
      "CW20-style deterministic WASM token contract with minting, transfers, allowances, and burn capabilities.",
  },
  {
    id: "contract-name-service",
    title: "Decentralized Name Registry (kovanica-name)",
    status: "done",
    blurb:
      "CW-style domain name registration, record management, and reverse resolution contract with sub-second lookups.",
    note: "Canonical name_register, name_transfer, and name_resolve entry points.",
  },
  {
    id: "peer-reputation",
    title: "P2P Peer Reputation & InboundGate Ban Scoring",
    status: "done",
    blurb:
      "Sub-second penalty matrix and socket-level IP banning for malformed frames (+50), invalid PoW/target (+100 instant ban), and flood spam (+20).",
    note: "Banned IPs rejected before socket buffer allocation.",
  },
  {
    id: "soak-simulation",
    title: "Mempool & Out-of-Gas Soak Simulation (SIM-1)",
    status: "done",
    blurb:
      "Multi-threaded 20-account concurrent stress test achieving 7,113.13 TPS, bounded RSS memory (13.59 MiB), and zero node panics with deterministic gas rollback.",
    note: "Deterministic out-of-gas rollback verified under Wasmi fuel limit.",
  },
];

const SURFACE: Item[] = [
  {
    id: "web-explorer",
    title: "BlockDAG Explorer",
    status: "done",
    blurb:
      "Interactive DAG canvas ordered by GHOSTDAG K=5, zoom and pan controls, and truthful live network telemetry.",
  },
  {
    id: "web-wallet",
    title: "Web Wallet & Signer",
    status: "done",
    blurb:
      "Client-side wallet supporting BIP-39 mnemonic derivation, PRO-21 address generation, and in-browser transaction signing.",
  },
  {
    id: "web-faucet",
    title: "Testnet Faucet",
    status: "done",
    blurb:
      "Automated testnet faucet dispensing 10 KVNC with rate limiting and canonical PRO-21 address verification.",
  },
  {
    id: "global-search",
    title: "Universal Explorer Global Search (PR #24)",
    status: "done",
    blurb:
      "Deep-linking resolver supporting canonical PRO-21 addresses (kvnc...dag), Ed25519 public keys, block/tx digests, token symbols, and NFT IDs.",
    note: "Instant resolution with asynchronous smart contract state probing.",
  },
  {
    id: "apps-ecosystem",
    title: "Desktop & Mobile Applications (kovanica-apps)",
    status: "done",
    blurb:
      "Native cross-platform shell suite: Android node & wallet with Rust FFI, Desktop node controller (node-desktop, console-desktop), and unified smart contract call dispatcher.",
    note: "100% clean builds across desktop and mobile suites.",
  },
  {
    id: "cli-tooling",
    title: "Node CLI & Tooling (kovanica-cli)",
    status: "done",
    blurb:
      "Full command-line toolkit for node administration, key generation, RPC inspection, and genesis orchestration.",
  },
];

const SDK: Item[] = [
  {
    id: "rust-crates",
    title: "Rust Workspace Crates",
    status: "done",
    blurb:
      "27 modular crates: kovanica-types, kovanica-crypto, kovanica-dag, kovanica-consensus, kovanica-mempool, kovanica-network, kovanica-runtime, kovanica-node, kovanica-rpc.",
  },
  {
    id: "ts-packages",
    title: "TypeScript SDK Packages",
    status: "done",
    blurb:
      "Modular client libraries: @kovanica/api-client, @kovanica/signer, @kovanica/console, and @kovanica/web.",
  },
  {
    id: "sdk-v030",
    title: "TypeScript SDK v0.3.0 Release",
    status: "done",
    blurb:
      "End-to-end typed smart contract encoders and decoders for Name Registry, NFT, and Escrow, BIP-39 HD wallet derivation, and strict 0x prefix enforcement.",
    note: "Published to npm registry with zero-dependency crypto runtime.",
  },
  {
    id: "playground-v030",
    title: "Interactive Contract Playground (kovanica-playground)",
    status: "done",
    blurb:
      "Browser-based contract testing environment pinned to SDK v0.3.0 with live Wasmi execution and hybrid PoW consensus visualization.",
    note: "All 7 test suites passing (65 tests) with clean production build.",
  },
  {
    id: "sdk-wasm",
    title: "WASM In-Browser Engine",
    status: "done",
    blurb:
      "Wasm-bindgen client engine for in-browser transaction preparation, BLAKE3 sighash derivation, and zero-knowledge seed protection.",
  },
  {
    id: "json-rpc",
    title: "JSON-RPC 2.0 Interface",
    status: "done",
    blurb:
      "Node-parity RPC endpoints for syncStatus, getLeaderHeader, getBalance, getNonce, sendRawTransaction, and DAG inspection.",
  },
];

const NEXT: Item[] = [
  {
    id: "hybrid-testnet-m8",
    title: "Canonical kovanica-testnet (Chain ID 2) Live Operation",
    status: "done",
    blurb:
      "Live operation of canonical hybrid PoW + GHOSTDAG testnet (network tag 2-24cdb5fadd98b207). Active 3-node cluster + observer + faucet on seed1.kovanica.online with non-compounding DAA.",
    note: "Over 4,700 committed rounds with 100% healthy consensus.",
  },
  {
    id: "audit-dossier",
    title: "External Security Audit Dossier & Inspection Harness",
    status: "active",
    blurb:
      "Immutable audit archive packaging (scripts/package-audit-dossier.sh) and automated reproduction harness (auditor-reproduce.sh) prepared for accredited external security firms.",
    note: "Scope covers KovanicaHash 2 MiB scratchpad, Wasmi sandbox, and P2P peer scorer.",
  },
  {
    id: "solo-miner",
    title: "Solo Miner Tooling & Stratum Gateway",
    status: "active",
    blurb:
      "Public CPU/GPU solo mining scripts, Stratum mining gateway dispatcher, and local hash-rate telemetry for decentralized mining participation.",
    note: "Zero stake in consensus path; 100% PoW block admission.",
  },
  {
    id: "ceremony-mainnet",
    title: "Mainnet Genesis Ceremony & Premine Lock Verification",
    status: "next",
    blurb:
      "Execution of the final genesis ceremony with the 5 zero-stake bootstrap seed operators, founder premine verification (200,000 KVNC), and frozen genesis bundle sign-off.",
    note: "Frozen mainnet network tag 1-f35df34c92001436.",
  },
  {
    id: "mainnet-readiness",
    title: "Mainnet Launch Event (1.1.2027)",
    status: "next",
    blurb:
      "Public launch on kovanica-mainnet (chain ID 1) with 90,200,000 KVNC hard cap, 82M mining subsidy budget (8,200,000-block × 3/4 decay eras), and zero stake in consensus.",
    note: "Target block time: 4000 ms, GHOSTDAG K = 5.",
  },
];

function StatusIcon({ status }: { status: Status }) {
  if (status === "done") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <Check className="size-4" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
        <Loader className="size-4 animate-spin" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
      <Circle className="size-3.5" strokeWidth={2} aria-hidden />
    </span>
  );
}

function statusLabel(s: Status): string {
  if (s === "done") return "Shipped";
  if (s === "active") return "In progress";
  return "Up next";
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h2 className="font-display text-xl tracking-tight text-fg">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2/80"
          >
            <StatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className="font-medium text-fg">{item.title}</h3>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-wide",
                    item.status === "done" && "text-emerald-400 font-semibold",
                    item.status === "active" && "text-amber-400 font-semibold",
                    item.status === "next" && "text-subtle",
                  )}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{item.blurb}</p>
              {item.note ? (
                <p className="mt-1.5 text-xs leading-relaxed text-subtle">{item.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RoadmapView() {
  const allItems = [...PROTOCOL, ...SURFACE, ...SDK, ...NEXT];
  const done = allItems.filter((i) => i.status === "done").length;
  const inProgress = allItems.filter((i) => i.status === "active").length;
  const queued = allItems.filter((i) => i.status === "next").length;
  const total = allItems.length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 md:px-6 md:py-10">
      <header>
        <p className="font-mono text-[10px] tracking-brand text-subtle uppercase">Protocol</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-fg md:text-4xl">Roadmap</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Development roadmap and architecture milestones for the Kovanica Layer-1 blockchain, core crates, Wasmi smart contracts, and mainnet launch focus areas.
        </p>
        <p className="mt-3 font-mono text-xs text-subtle">
          <strong className="text-emerald-400">{done} shipped</strong> ·{" "}
          <strong className="text-amber-400">{inProgress} in progress</strong> ·{" "}
          <span>{queued} queued</span> · {total} tracked milestones
        </p>
      </header>

      <Section title="Consensus & Wasmi Smart Contracts" items={PROTOCOL} />
      <Section title="Client Applications & Explorer" items={SURFACE} />
      <Section title="SDK & Developer Tooling" items={SDK} />
      <Section title="Next Focus Areas (Mainnet Roadmap)" items={NEXT} />

      <div className="rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted space-y-2">
        <p>
          <strong className="text-fg">Consensus:</strong> Hybrid PoW + GHOSTDAG (target block 4 s, GHOSTDAG K = 5, KovanicaHash PoW).
        </p>
        <p>
          <strong className="text-fg">Execution:</strong> Deterministic Wasmi WebAssembly runtime.
        </p>
        <p>
          <strong className="text-fg">Tokenomics:</strong> Native token <strong className="text-fg">KVNC</strong> (9 decimals, 90,200,000 hard cap, 82M mining subsidy budget, 2.5 KVNC initial block reward).
        </p>
        <p className="border-t border-border/60 pt-2 text-subtle">
          More details available in the{" "}
          <Link to="/docs" className="text-amber-400 underline-offset-2 hover:underline">
            Documentation
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
