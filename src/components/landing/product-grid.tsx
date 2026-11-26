/**
 * Product grid — curated 3x2 flagship surface showcase.
 * - variant="landing" → absolute testnet/docs URLs (apex marketing page)
 * - variant="app"     → in-app TanStack Links (testnet host only; rarely used)
 */
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  Compass,
  Eye,
  FileText,
  Wallet,
} from "lucide-react";

const TESTNET = "https://testnet.kovanica.online";
const DOCS = "https://docs.kovanica.online";

type ProductTo =
  | "/explorer"
  | "/wallet"
  | "/swap"
  | "/rwa"
  | "/stealth"
  | "/docs";

type Product = {
  to: ProductTo;
  /** Absolute URL used on marketing landing so apex never “owns” protocol paths */
  external?: string;
  icon: typeof Compass;
  accent: string;
  title: string;
  body: string;
};

const PRODUCTS: Product[] = [
  {
    to: "/explorer",
    external: `${TESTNET}/explorer`,
    icon: Compass,
    accent: "text-blue",
    title: "BlockDAG Explorer",
    body: "Live multi-lane BlockDAG graph, transactions, mining telemetry, and contract inspector.",
  },
  {
    to: "/wallet",
    external: `${TESTNET}/wallet`,
    icon: Wallet,
    accent: "text-teal",
    title: "Non-Custodial Wallet",
    body: "BIP-44 keys, browser extension, Android wallet, QR receive, faucet, and Ed25519 sends.",
  },
  {
    to: "/swap",
    external: `${TESTNET}/swap`,
    icon: ArrowLeftRight,
    accent: "text-gold",
    title: "AMM Swap & Pools",
    body: "Constant-product DEX with 1-click atomic Approve → Swap batches and LP position tracking.",
  },
  {
    to: "/rwa",
    external: `${TESTNET}/rwa`,
    icon: Building2,
    accent: "text-gold",
    title: "Tokens, NFTs & RWA",
    body: "Create KVP-102 tokens, mint KVP-106 NFTs, and issue compliant real-world assets.",
  },
  {
    to: "/stealth",
    external: `${TESTNET}/stealth`,
    icon: Eye,
    accent: "text-teal",
    title: "Stealth Privacy",
    body: "KVP-103 dual-key Ed25519 ECDH one-time stealth addresses with fast view-tag scanning.",
  },
  {
    to: "/docs",
    external: DOCS,
    icon: FileText,
    accent: "text-blue",
    title: "Developer Docs & SDK",
    body: "Protocol specs, JSON-RPC 2.0 reference, interactive Playground, and TypeScript SDK v0.10.",
  },
];

export function ProductGrid({
  variant = "landing",
}: {
  variant?: "landing" | "app";
}) {
  return (
    <section className="mt-10 md:mt-14" aria-labelledby="products-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="products-heading"
          className="font-display text-2xl tracking-tight text-fg md:text-3xl"
        >
          Everything on Kovanica
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
          Live on Testnet
        </span>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((p) => (
          <ProductCard key={p.title} product={p} variant={variant} />
        ))}
      </ul>
      {variant === "landing" && (
        <p className="mt-4 text-center text-xs text-subtle">
          All 38 protocol surfaces live on{" "}
          <a href={TESTNET} className="underline hover:text-fg">
            testnet.kovanica.online
          </a>
          . Specs on{" "}
          <a href={DOCS} className="underline hover:text-fg">
            docs.kovanica.online
          </a>
          .
        </p>
      )}
    </section>
  );
}

function ProductCard({
  product,
  variant,
}: {
  product: Product;
  variant: "landing" | "app";
}) {
  const { to, external, icon: Icon, accent, title, body } = product;
  const className =
    "group flex h-full flex-col rounded-xl border border-border bg-surface p-4.5 transition-all duration-150 hover:border-gold/40 hover:bg-surface-2";
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface-2">
          <Icon className={`size-4 ${accent}`} />
        </span>
        <ArrowUpRight className="size-4 text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-gold" />
      </div>
      <h3 className="mt-3.5 font-display text-lg tracking-tight text-fg">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
    </>
  );

  return (
    <li>
      {variant === "landing" && external ? (
        <a href={external} className={className}>
          {inner}
        </a>
      ) : (
        <Link to={to} className={className}>
          {inner}
        </Link>
      )}
    </li>
  );
}
