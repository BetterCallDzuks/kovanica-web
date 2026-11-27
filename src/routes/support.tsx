import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  GitBranch,
  Heart,
  Mail,
  Pickaxe,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { getMiningPoolFeeConfig, getSwapInterfaceFeeConfig } from "@/lib/monetization";
import { SURFACE } from "@/lib/surfaces";

export const Route = createFileRoute("/support")({
  component: SupportPage,
});

interface DonationChannel {
  id: string;
  symbol: string;
  network: string;
  address: string;
}

function readPublicEnv(key: string): string | undefined {
  const metaEnv =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      : undefined;
  const val = metaEnv?.[key] ?? (typeof process !== "undefined" ? process.env?.[key] : undefined);
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

function getConfiguredDonationChannels(): DonationChannel[] {
  const specs: Array<{ id: string; symbol: string; network: string; envKey: string }> = [
    { id: "btc", symbol: "BTC", network: "Bitcoin (SegWit / Taproot)", envKey: "VITE_DONATION_BTC" },
    { id: "eth", symbol: "ETH / USDC", network: "Ethereum & EVM L2s", envKey: "VITE_DONATION_ETH" },
    { id: "sol", symbol: "SOL", network: "Solana", envKey: "VITE_DONATION_SOL" },
    { id: "xmr", symbol: "XMR", network: "Monero", envKey: "VITE_DONATION_XMR" },
    { id: "kvnc", symbol: "KVNC", network: "Kovanica (PRO-21)", envKey: "VITE_DONATION_KVNC" },
  ];

  const channels: DonationChannel[] = [];
  for (const spec of specs) {
    const address = readPublicEnv(spec.envKey);
    if (address) {
      channels.push({
        id: spec.id,
        symbol: spec.symbol,
        network: spec.network,
        address,
      });
    }
  }
  return channels;
}

const FUNDING_ALLOCATIONS = [
  {
    icon: ShieldCheck,
    accent: "text-gold",
    title: "External Security Audit",
    desc: "Independent cryptographic & consensus review of kovanica-l1 (KovanicaHash PoW, GHOSTDAG, Wasmi execution, P2P) ahead of January 1, 2027 Mainnet launch.",
  },
  {
    icon: Server,
    accent: "text-teal",
    title: "Public Infrastructure & Nodes",
    desc: "24/7 operation of seed1, public JSON-RPC & WebSocket endpoints, BlockDAG Explorer, Stratum TLS mining pool, and the testnet faucet.",
  },
  {
    icon: Code2,
    accent: "text-blue",
    title: "Open-Source Protocol & Wallets",
    desc: "Full-time engineering across kovanica-l1, kovanica-sdk, browser extension, desktop & Android wallets, and developer Playground.",
  },
] as const;

const NON_FINANCIAL_WAYS = [
  {
    icon: Pickaxe,
    title: "Run a Testnet Node or Miner",
    desc: "Help stress-test KovanicaHash PoW, GHOSTDAG ordering, and peer discovery.",
    to: "/pool" as const,
    cta: "Mining Pool →",
  },
  {
    icon: GitBranch,
    title: "Review Code & Report Issues",
    desc: "Audit PRs, test releases, or open bug reports across our 5 public repositories.",
    href: SURFACE.github,
    cta: "GitHub Repositories →",
  },
  {
    icon: Sparkles,
    title: "Build on Testnet",
    desc: "Deploy Wasmi contracts, test KVP-102 tokens, KVP-103 stealth addresses, or AMM pools.",
    to: "/docs" as const,
    cta: "Read Docs →",
  },
] as const;

function SupportPage() {
  const donationChannels = getConfiguredDonationChannels();
  const githubSponsorsUrl =
    readPublicEnv("VITE_GITHUB_SPONSORS_URL") ?? "https://github.com/sponsors/BetterCallDzuks";
  const swapFee = getSwapInterfaceFeeConfig();
  const poolFee = getMiningPoolFeeConfig();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  async function copyAddress(channel: DonationChannel) {
    try {
      await navigator.clipboard.writeText(channel.address);
      setCopiedId(channel.id);
      toast.success(`Copied ${channel.symbol} address`);
      setTimeout(() => setCopiedId((prev) => (prev === channel.id ? null : prev)), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: "sponsorship",
          plan: "Community Donation / Grant Support",
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim() || undefined,
          details: details.trim(),
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reference_id?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not send message. Please check all fields.");
        return;
      }
      setSubmittedRef(data.reference_id ?? "received");
      setName("");
      setEmail("");
      setOrganization("");
      setDetails("");
      toast.success("Thank you! Your message has been received.");
    } catch {
      toast.error("Network error while sending message.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-8 md:px-8 md:py-12">
        {/* Hero */}
        <header className="space-y-4 border-b border-border pb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-xs text-gold">
            <Heart className="size-3.5" aria-hidden="true" />
            <span>Open-Source · Zero VC · Zero ICO · Community Supported</span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg md:text-4xl">
            Support &amp; Donations
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted md:text-base">
            Kovanica Protocol is built independently in the open with{" "}
            <strong className="text-fg">no venture capital, no token pre-sale, and no paywalls</strong>
            . Every node, wallet, SDK, and explorer surface is free and open-source. Voluntary
            donations and grants directly fund our external security audit and public infrastructure
            on the road to Mainnet (January 1, 2027).
          </p>
        </header>

        {/* Where support goes */}
        <section aria-labelledby="allocation-heading" className="space-y-4">
          <h2 id="allocation-heading" className="font-display text-2xl tracking-tight text-fg">
            What Your Support Funds
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {FUNDING_ALLOCATIONS.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="flex flex-col rounded-xl border border-border bg-surface p-5"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2">
                    <Icon className={`size-4 ${item.accent}`} aria-hidden="true" />
                  </span>
                  <h3 className="mt-3.5 font-display text-lg text-fg">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.desc}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* Direct Donations */}
        <section aria-labelledby="donate-heading" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="donate-heading" className="font-display text-2xl tracking-tight text-fg">
              Make a Donation
            </h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-subtle">
              100% Voluntary · Non-Refundable Gift
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* GitHub Sponsors */}
            <div className="flex flex-col justify-between rounded-xl border border-gold/30 bg-surface p-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold">
                  Recurring or One-Time
                </p>
                <h3 className="mt-1.5 font-display text-xl text-fg">GitHub Sponsors</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Sponsor core protocol development directly on GitHub with monthly or one-time
                  contributions and transparent public receipts.
                </p>
              </div>
              <div className="mt-5">
                <a
                  href={githubSponsorsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-gold-dark"
                >
                  <Heart className="size-4" aria-hidden="true" />
                  <span>Sponsor on GitHub</span>
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* Direct Grant / Audit Co-Funding */}
            <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-teal">
                  Grants &amp; Infrastructure
                </p>
                <h3 className="mt-1.5 font-display text-xl text-fg">
                  Audit Co-Funding &amp; Infra Grants
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Want to sponsor a bootstrap seed node, co-fund the external L1 security audit, or
                  donate via crypto/wire invoice? Reach out directly.
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  href="mailto:dev@kovanica.online?subject=Supporting%20Kovanica%20Protocol"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 text-sm font-medium text-fg transition-colors hover:border-gold/40 hover:text-gold"
                >
                  <Mail className="size-4 text-teal" aria-hidden="true" />
                  <span>dev@kovanica.online</span>
                </a>
              </div>
            </div>
          </div>

          {/* On-chain crypto donation addresses (shown when configured via VITE_DONATION_*) */}
          {donationChannels.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg text-fg">Direct Crypto Addresses</h3>
                <span className="font-mono text-[11px] text-muted">
                  Verify domain: kovanica.online
                </span>
              </div>
              <div className="divide-y divide-border/70">
                {donationChannels.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex flex-col justify-between gap-2 py-3 first:pt-1 last:pb-0 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs font-semibold text-gold">
                          {ch.symbol}
                        </span>
                        <span className="text-xs text-muted">{ch.network}</span>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-fg">{ch.address}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyAddress(ch)}
                      className="shrink-0 gap-1.5"
                    >
                      {copiedId === ch.id ? (
                        <>
                          <Check className="size-3.5 text-teal" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Non-financial contributions */}
        <section aria-labelledby="contribute-heading" className="space-y-4">
          <h2 id="contribute-heading" className="font-display text-2xl tracking-tight text-fg">
            Other Ways to Help
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {NON_FINANCIAL_WAYS.map((way) => {
              const Icon = way.icon;
              return (
                <div
                  key={way.title}
                  className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5"
                >
                  <div>
                    <Icon className="size-4 text-gold" aria-hidden="true" />
                    <h3 className="mt-3 font-display text-lg text-fg">{way.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{way.desc}</p>
                  </div>
                  <div className="mt-4">
                    {"to" in way ? (
                      <Link
                        to={way.to}
                        className="font-mono text-xs font-medium text-gold hover:underline"
                      >
                        {way.cta}
                      </Link>
                    ) : (
                      <a
                        href={way.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs font-medium text-gold hover:underline"
                      >
                        {way.cta}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Fee & Tokenomics Transparency */}
        <section
          aria-labelledby="transparency-heading"
          className="rounded-xl border border-border bg-surface/60 p-5 space-y-3"
        >
          <h2 id="transparency-heading" className="font-display text-xl text-fg">
            Protocol Sustainability &amp; Transparency
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="text-fg">Locked Tokenomics:</strong> 90.2M KVNC hard cap (82M PoW
              mining emission, 8M linear treasury over 8 years, 0.2M founder premine, 0 genesis
              allocation).
            </li>
            <li>
              <strong className="text-fg">Public Testnet &amp; Swap Interface:</strong> Free public
              RPC, Explorer, Faucet, and AMM interface (
              {swapFee.active
                ? `${(swapFee.feeBps / 100).toFixed(2)}% interface fee`
                : "0% interface fee on testnet"}
              ).
            </li>
            <li>
              <strong className="text-fg">Official Stratum Mining Pool:</strong>{" "}
              {poolFee.testnetFeePct}% fee on testnet · {poolFee.plannedMainnetFeePct.toFixed(1)}%
              planned mainnet pool fee to cover server &amp; bandwidth costs.
            </li>
            <li>
              <strong className="text-fg">No Tracking or Ads:</strong> Zero analytics cookies, zero
              third-party ad scripts, and strict self-custody across all web &amp; native wallets.
            </li>
          </ul>
        </section>

        {/* Contact / Support message form */}
        <section aria-labelledby="message-heading" className="space-y-4 border-t border-border pt-8">
          <div>
            <h2 id="message-heading" className="font-display text-2xl tracking-tight text-fg">
              Get in Touch
            </h2>
            <p className="mt-1 text-sm text-muted">
              Interested in sponsoring infrastructure, co-funding the security audit, or contributing
              a grant? Leave a note below and we will reply by email.
            </p>
          </div>

          {submittedRef ? (
            <div className="rounded-xl border border-teal/40 bg-teal/10 p-5 text-sm text-fg">
              <p className="font-medium text-teal">Thank you for supporting Kovanica!</p>
              <p className="mt-1 text-muted">
                Your message was logged with reference{" "}
                <code className="font-mono text-fg">{submittedRef}</code>. We will follow up via
                email shortly.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2"
            >
              {/* Honeypot field */}
              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                <span>Name *</span>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name or handle"
                  className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-gold"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
                <span>Email *</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-gold"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted sm:col-span-2">
                <span>Organization / Community (optional)</span>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Optional"
                  className="h-10 rounded-lg border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-gold"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted sm:col-span-2">
                <span>Message *</span>
                <textarea
                  required
                  minLength={10}
                  rows={4}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Tell us how you'd like to support Kovanica (donation, audit grant, seed node hosting, etc.)"
                  className="rounded-lg border border-border bg-bg p-3 text-sm text-fg outline-none focus:border-gold"
                />
              </label>
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <span className="text-xs text-subtle">
                  Zero tracking cookies · Direct email follow-up only
                </span>
                <Button type="submit" variant="gold" disabled={submitting} className="gap-2">
                  <Send className="size-3.5" />
                  <span>{submitting ? "Sending…" : "Send Message"}</span>
                </Button>
              </div>
            </form>
          )}
        </section>
      </main>
    </Shell>
  );
}
