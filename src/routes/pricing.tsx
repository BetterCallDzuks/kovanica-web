import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowLeftRight,
  Building2,
  Check,
  ExternalLink,
  Megaphone,
  Pickaxe,
  Send,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { SponsorSlot } from "@/components/monetization/sponsor-slot";
import {
  ENTERPRISE_OFFERS,
  INQUIRY_TOPIC_LABELS,
  LISTING_AND_SPONSOR_OFFERS,
  RPC_TIERS,
  RWA_PLANS,
  getMiningPoolFeeConfig,
  getPartnerLinks,
  getSwapInterfaceFeeConfig,
  type InquiryTopic,
} from "@/lib/monetization";
import { cn } from "@/lib/utils";

const VALID_TOPICS = new Set<InquiryTopic>([
  "rpc",
  "rwa",
  "listing",
  "sponsorship",
  "enterprise",
  "pool",
]);

export const Route = createFileRoute("/pricing")({
  validateSearch: (search: Record<string, unknown>): { topic?: InquiryTopic } => {
    const raw = typeof search.topic === "string" ? search.topic : undefined;
    if (raw && VALID_TOPICS.has(raw as InquiryTopic)) {
      return { topic: raw as InquiryTopic };
    }
    return {};
  },
  component: PricingPage,
});

function PricingPage() {
  const { topic: initialTopic } = Route.useSearch();
  const [topic, setTopic] = useState<InquiryTopic>(initialTopic ?? "rpc");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const swapFee = getSwapInterfaceFeeConfig();
  const poolFee = getMiningPoolFeeConfig();
  const partnerLinks = getPartnerLinks();

  function jumpToInquiry(nextTopic: InquiryTopic, planName: string) {
    setTopic(nextTopic);
    setSelectedPlan(planName);
    setSubmittedRef(null);
    const el = document.getElementById("inquiry-form");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic,
          plan: selectedPlan || undefined,
          name,
          email,
          organization: organization || undefined,
          details,
          website,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reference_id?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Could not submit inquiry");
        return;
      }
      setSubmittedRef(data.reference_id ?? "recorded");
      setName("");
      setEmail("");
      setOrganization("");
      setDetails("");
      toast.success(`Inquiry recorded (${data.reference_id})`);
    } catch {
      toast.error("Network error while submitting inquiry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-8 md:px-8 md:py-12">
        {/* Hero */}
        <header className="space-y-3 border-b border-border pb-8">
          <p className="font-mono text-[11px] tracking-brand text-gold uppercase">
            Kovanica Ecosystem Services · Zero Tracking Cookies
          </p>
          <h1 className="font-display text-3xl tracking-tight text-fg italic md:text-5xl">
            Pricing &amp; Services
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            Sustainable infrastructure and B2B services built on Kovanica — independent of KVNC
            token price, with zero third-party ad scripts or tracking cookies. Public testnet
            access remains free for developers and users.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="gold" size="sm" onClick={() => jumpToInquiry("rpc", "Builder ($49/mo)")}>
              Request RPC API Key
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jumpToInquiry("rwa", "Institutional Compliance")}
            >
              RWA Issuer SaaS
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jumpToInquiry("listing", "Verified Token Listing")}
            >
              Verify Token / Sponsor
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jumpToInquiry("enterprise", "Enterprise Support")}
            >
              Enterprise Support
            </Button>
          </div>
        </header>

        {/* 1. Managed RPC, WebSocket & Indexer API */}
        <section aria-labelledby="rpc-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-blue">
                <Server className="size-3.5" />
                <span>1 · Infrastructure SaaS</span>
              </div>
              <h2 id="rpc-heading" className="mt-1 font-display text-2xl text-fg">
                Managed RPC, WebSocket &amp; Indexer API
              </h2>
            </div>
            <Link to="/api-reference" className="font-mono text-xs text-muted hover:text-gold">
              View JSON-RPC Reference →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {RPC_TIERS.map((tier) => (
              <div
                key={tier.id}
                className={cn(
                  "flex flex-col justify-between rounded-xl border bg-surface p-5",
                  tier.badge ? "border-gold/50" : "border-border",
                )}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-fg">{tier.name}</h3>
                    {tier.badge && (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[10px] uppercase text-gold">
                        {tier.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-2xl font-semibold text-fg">{tier.price}</span>
                    <span className="font-mono text-xs text-muted">{tier.cadence}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted">{tier.description}</p>
                  <ul className="space-y-1.5 pt-2 text-xs text-muted">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-teal" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-5">
                  {tier.id === "rpc-free" ? (
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link to="/docs">{tier.ctaLabel}</Link>
                    </Button>
                  ) : (
                    <Button
                      variant={tier.badge ? "gold" : "outline"}
                      size="sm"
                      className="w-full"
                      onClick={() => jumpToInquiry(tier.topic, `${tier.name} (${tier.price})`)}
                    >
                      {tier.ctaLabel}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. RWA Issuer & Compliance SaaS */}
        <section aria-labelledby="rwa-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gold">
                <Building2 className="size-3.5" />
                <span>2 · B2B Tokenization</span>
              </div>
              <h2 id="rwa-heading" className="mt-1 font-display text-2xl text-fg">
                RWA Issuer &amp; Compliance Portal
              </h2>
            </div>
            <div className="flex gap-3 font-mono text-xs">
              <Link to="/wallet/rwa-issue" className="text-muted hover:text-gold">
                Try Issue RWA →
              </Link>
              <Link to="/wallet/rwa-manage" className="text-muted hover:text-gold">
                Try Manage RWA →
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {RWA_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col justify-between rounded-xl border bg-surface p-5",
                  plan.badge ? "border-gold/50" : "border-border",
                )}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-fg">{plan.name}</h3>
                    {plan.badge && (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[10px] uppercase text-gold">
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-2xl font-semibold text-fg">{plan.price}</span>
                    <span className="font-mono text-xs text-muted">{plan.cadence}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted">{plan.description}</p>
                  <ul className="space-y-1.5 pt-2 text-xs text-muted">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-teal" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-5">
                  <Button
                    variant={plan.badge ? "gold" : "outline"}
                    size="sm"
                    className="w-full"
                    onClick={() => jumpToInquiry(plan.topic, `${plan.name} (${plan.price})`)}
                  >
                    {plan.ctaLabel}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3 & 4. Transparent Protocol-Adjacent Interface & Pool Fees */}
        <section aria-labelledby="fees-heading" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gold">
                <ArrowLeftRight className="size-3.5" />
                <span>3 · Swap &amp; Bridge Interface</span>
              </div>
              <span className="rounded-full border border-border bg-bg px-2.5 py-0.5 font-mono text-[11px] text-fg">
                {swapFee.active ? `${(swapFee.feeBps / 100).toFixed(2)}% active` : "0.00% on testnet"}
              </span>
            </div>
            <h2 id="fees-heading" className="font-display text-xl text-fg">
              Front-End Swap &amp; Bridge Fee
            </h2>
            <p className="text-xs leading-relaxed text-muted">
              Optional, transparent interface fee (0.00% on testnet; configurable up to 0.25% at
              mainnet launch) applied strictly on hosted web/extension UX routing — never at the L1
              consensus layer. Direct RPC and SDK users always pay zero interface fee.
            </p>
            <div className="pt-1">
              <Link to="/swap" className="font-mono text-xs text-gold hover:underline">
                Open AMM Swap →
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-blue">
                <Pickaxe className="size-3.5" />
                <span>4 · Official Mining Pool</span>
              </div>
              <span className="rounded-full border border-border bg-bg px-2.5 py-0.5 font-mono text-[11px] text-fg">
                {poolFee.testnetFeePct}% testnet · {poolFee.plannedMainnetFeePct.toFixed(1)}% mainnet
              </span>
            </div>
            <h2 className="font-display text-xl text-fg">Stratum V1 TLS Mining Pool</h2>
            <p className="text-xs leading-relaxed text-muted">
              Encrypted Stratum V1 TLS pool with automatic VarDiff and graceful drain. Testnet
              mining is 0% fee; mainnet official pool operates at a transparent{" "}
              {poolFee.plannedMainnetFeePct.toFixed(1)}% pool fee to fund global seed &amp; relay
              infrastructure.
            </p>
            <div className="flex items-center gap-4 pt-1">
              <Link to="/pool" className="font-mono text-xs text-gold hover:underline">
                Configure Miner →
              </Link>
              <button
                type="button"
                onClick={() => jumpToInquiry("pool", "Institutional Hashrate / Custom Pool")}
                className="font-mono text-xs text-muted hover:text-fg"
              >
                Institutional Hashrate Inquiry →
              </button>
            </div>
          </div>
        </section>

        {/* 5. Verified Listings & Privacy-First Sponsorships */}
        <section aria-labelledby="listings-heading" className="space-y-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-teal">
              <Megaphone className="size-3.5" />
              <span>5 · Listings &amp; Zero-Cookie Sponsorships</span>
            </div>
            <h2 id="listings-heading" className="mt-1 font-display text-2xl text-fg">
              Verified Listings &amp; Ecosystem Sponsorships
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {LISTING_AND_SPONSOR_OFFERS.map((offer) => (
              <div
                key={offer.id}
                className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-fg">{offer.name}</h3>
                    {offer.badge && (
                      <span className="rounded-full bg-teal/15 px-2 py-0.5 font-mono text-[10px] uppercase text-teal">
                        {offer.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-2xl font-semibold text-fg">{offer.price}</span>
                    <span className="font-mono text-xs text-muted">{offer.cadence}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted">{offer.description}</p>
                  <ul className="space-y-1.5 pt-2 text-xs text-muted">
                    {offer.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-teal" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="pt-5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => jumpToInquiry(offer.topic, `${offer.name} (${offer.price})`)}
                  >
                    {offer.ctaLabel}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <SponsorSlot surface="pricing" showPlaceholder />

          {partnerLinks.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {partnerLinks.map((partner) => (
                <a
                  key={partner.id}
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-gold/40 hover:bg-surface-2"
                >
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-subtle">
                      {partner.category} · Partner Link
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-fg">{partner.label}</div>
                    <div className="mt-0.5 text-xs text-muted">{partner.description}</div>
                  </div>
                  <ExternalLink className="mt-1 size-4 shrink-0 text-gold" />
                </a>
              ))}
            </div>
          )}
        </section>

        {/* 6. Exchange & Enterprise Integration Support */}
        <section aria-labelledby="enterprise-heading" className="space-y-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-blue">
              <Wrench className="size-3.5" />
              <span>6 · Engineering &amp; SLA Support</span>
            </div>
            <h2 id="enterprise-heading" className="mt-1 font-display text-2xl text-fg">
              Exchange &amp; Enterprise Integration
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ENTERPRISE_OFFERS.map((item) => (
              <div
                key={item.title}
                className="flex flex-col justify-between rounded-xl border border-border bg-surface p-5"
              >
                <div className="space-y-2">
                  <div className="font-mono text-xs text-gold">{item.price}</div>
                  <h3 className="text-base font-semibold text-fg">{item.title}</h3>
                  <p className="text-xs leading-relaxed text-muted">{item.desc}</p>
                </div>
                <div className="pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => jumpToInquiry("enterprise", item.title)}
                  >
                    Request Scope
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Inquiry Form (persisted via POST /api/inquiries) */}
        <section
          id="inquiry-form"
          aria-labelledby="inquiry-heading"
          className="rounded-2xl border border-border bg-surface p-6 md:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 id="inquiry-heading" className="font-display text-2xl text-fg">
                Request API Key, Onboarding or Sponsorship
              </h2>
              <p className="mt-1 text-xs text-muted">
                Submissions are recorded directly on Kovanica infrastructure — no third-party CRM
                trackers or marketing cookies.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/10 px-2.5 py-1 font-mono text-[11px] text-teal">
              <ShieldCheck className="size-3.5" />
              <span>Zero Tracking Cookies</span>
            </span>
          </div>

          {submittedRef ? (
            <div className="mt-6 rounded-xl border border-teal/40 bg-teal/10 p-5 space-y-2">
              <p className="text-sm font-semibold text-fg">Inquiry recorded</p>
              <p className="text-xs text-muted">
                Reference ID: <code className="font-mono text-fg">{submittedRef}</code>. Our team
                will follow up via the contact email you provided.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setSubmittedRef(null)}
              >
                Submit another request
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {/* Honeypot field hidden from human users */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="hidden"
                aria-hidden="true"
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="inq-topic" className="mb-1 block text-xs font-medium text-muted">
                    Service Category
                  </label>
                  <select
                    id="inq-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value as InquiryTopic)}
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                  >
                    {(Object.keys(INQUIRY_TOPIC_LABELS) as InquiryTopic[]).map((key) => (
                      <option key={key} value={key}>
                        {INQUIRY_TOPIC_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="inq-plan" className="mb-1 block text-xs font-medium text-muted">
                    Plan / Package (optional)
                  </label>
                  <input
                    id="inq-plan"
                    type="text"
                    value={selectedPlan}
                    onChange={(e) => setSelectedPlan(e.target.value)}
                    placeholder="e.g. Builder ($49), Verified Token Listing"
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="inq-name" className="mb-1 block text-xs font-medium text-muted">
                    Your Name *
                  </label>
                  <input
                    id="inq-name"
                    type="text"
                    required
                    minLength={2}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Novak"
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="inq-email" className="mb-1 block text-xs font-medium text-muted">
                    Contact Email *
                  </label>
                  <input
                    id="inq-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@company.com"
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="inq-org" className="mb-1 block text-xs font-medium text-muted">
                    Organization / Project
                  </label>
                  <input
                    id="inq-org"
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="inq-details" className="mb-1 block text-xs font-medium text-muted">
                  Project Details &amp; Volume / Timeline *
                </label>
                <textarea
                  id="inq-details"
                  required
                  minLength={10}
                  rows={4}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Tell us about your expected RPS, asset class, token contract address, or sponsorship timeline..."
                  className="w-full rounded-md border border-border bg-bg p-3 text-xs text-fg focus:border-gold focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end">
                <Button type="submit" variant="gold" disabled={submitting}>
                  <Send className="mr-1.5 size-3.5" />
                  {submitting ? "Submitting…" : "Submit Request"}
                </Button>
              </div>
            </form>
          )}
        </section>
      </main>
    </Shell>
  );
}
