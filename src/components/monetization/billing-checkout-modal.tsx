import { useState } from "react";
import { Check, Coins, Copy, CreditCard, ExternalLink, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CheckoutTargetPlan {
  id: string;
  name: string;
  price: string;
  cadence: string;
}

interface InvoicePayload {
  id: string;
  plan_id: string;
  plan_name: string;
  tier: string | null;
  payment_method: "stripe" | "onchain";
  asset: "USDC" | "KVNC" | "USD";
  amount_usd: string;
  amount_asset: string;
  treasury_address: string | null;
  treasury_configured: boolean;
  memo: string;
  status: "pending" | "paid" | "expired" | "cancelled";
  api_key_prefix: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}

interface BillingCheckoutModalProps {
  plan: CheckoutTargetPlan | null;
  onClose: () => void;
  onFallbackInquiry: () => void;
}

export function BillingCheckoutModal({
  plan,
  onClose,
  onFallbackInquiry,
}: BillingCheckoutModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "onchain">("stripe");
  const [asset, setAsset] = useState<"USDC" | "KVNC">("USDC");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [invoice, setInvoice] = useState<InvoicePayload | null>(null);
  const [stripeFallbackNotice, setStripeFallbackNotice] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!plan) return null;

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  async function handleCheckoutSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setLoading(true);
    setStripeFallbackNotice(false);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          paymentMethod,
          asset,
          email: email.trim() || undefined,
          organization: organization.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        mode?: "stripe" | "onchain";
        checkout_url?: string;
        stripe_fallback?: boolean;
        invoice?: InvoicePayload;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Unable to start checkout");
        return;
      }
      if (data.mode === "stripe" && data.checkout_url) {
        toast.success("Redirecting to Stripe Checkout…");
        window.location.assign(data.checkout_url);
        return;
      }
      if (data.invoice) {
        setInvoice(data.invoice);
        if (data.stripe_fallback) {
          setStripeFallbackNotice(true);
          toast.info("Card checkout is not enabled on this host — generated an on-chain invoice instead.");
        } else {
          toast.success(`Invoice ${data.invoice.id} created`);
        }
      }
    } catch {
      toast.error("Network error while creating checkout session");
    } finally {
      setLoading(false);
    }
  }

  async function refreshInvoiceStatus() {
    if (!invoice) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/billing/invoice/${encodeURIComponent(invoice.id)}`);
      const data = (await res.json()) as { ok?: boolean; invoice?: InvoicePayload; error?: string };
      if (!res.ok || !data.ok || !data.invoice) {
        toast.error(data.error ?? "Could not refresh invoice status");
        return;
      }
      setInvoice(data.invoice);
      toast.success(`Invoice status: ${data.invoice.status}`);
    } catch {
      toast.error("Network error while checking invoice status");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold">
              Self-Serve Billing &amp; API Key Provisioning
            </p>
            <h3 id="billing-modal-title" className="mt-1 font-display text-xl text-fg">
              {plan.name}{" "}
              <span className="font-mono text-base text-muted">
                ({plan.price} {plan.cadence})
              </span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
            aria-label="Close checkout dialog"
          >
            <X className="size-4" />
          </button>
        </div>

        {invoice ? (
          <div className="mt-5 space-y-4">
            {stripeFallbackNotice && (
              <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-fg">
                Stripe card checkout is not configured on this instance yet. You can settle
                immediately using the on-chain invoice below.
              </div>
            )}

            <div className="rounded-xl border border-border bg-bg p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono uppercase text-muted">Invoice Reference</span>
                <div className="flex items-center gap-1.5">
                  <code className="font-mono text-fg">{invoice.id}</code>
                  <button
                    type="button"
                    onClick={() => copyValue("Invoice ID", invoice.id)}
                    className="rounded p-1 text-muted hover:text-gold"
                    aria-label="Copy invoice ID"
                  >
                    {copiedField === "Invoice ID" ? (
                      <Check className="size-3.5 text-teal" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="font-mono uppercase text-muted">Amount Due</span>
                <span className="font-mono font-semibold text-fg">
                  {invoice.amount_asset}{" "}
                  <span className="text-muted">(${invoice.amount_usd} USD)</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="font-mono uppercase text-muted">Status</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] uppercase",
                    invoice.status === "paid"
                      ? "bg-teal/15 text-teal"
                      : invoice.status === "expired"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-gold/15 text-gold",
                  )}
                >
                  {invoice.status}
                </span>
              </div>

              {invoice.treasury_address && (
                <div className="space-y-1 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono uppercase text-muted">Treasury Address</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyValue("Treasury address", invoice.treasury_address ?? "")
                      }
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-gold hover:underline"
                    >
                      {copiedField === "Treasury address" ? (
                        <>
                          <Check className="size-3 text-teal" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <code className="block break-all rounded-md border border-border bg-surface px-2.5 py-2 font-mono text-[11px] text-fg">
                    {invoice.treasury_address}
                  </code>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[11px] text-muted">
                <span>Include invoice ID in transfer memo</span>
                <span>Expires {new Date(invoice.expires_at).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={refreshInvoiceStatus}
                disabled={refreshing}
              >
                <RefreshCw className={cn("mr-1.5 size-3.5", refreshing && "animate-spin")} />
                {refreshing ? "Checking…" : "Check Status"}
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setInvoice(null)}>
                  New Invoice
                </Button>
                <Button type="button" variant="gold" size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCheckoutSubmit} className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("stripe")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                  paymentMethod === "stripe"
                    ? "border-gold bg-gold/10 text-fg"
                    : "border-border bg-bg text-muted hover:text-fg",
                )}
              >
                <CreditCard className="size-3.5 text-gold" />
                <span>Card / Stripe</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("onchain")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                  paymentMethod === "onchain"
                    ? "border-gold bg-gold/10 text-fg"
                    : "border-border bg-bg text-muted hover:text-fg",
                )}
              >
                <Coins className="size-3.5 text-teal" />
                <span>On-Chain (USDC / KVNC)</span>
              </button>
            </div>

            {paymentMethod === "onchain" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Settlement Asset
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["USDC", "KVNC"] as const).map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setAsset(sym)}
                      className={cn(
                        "rounded-md border px-3 py-2 font-mono text-xs transition-colors",
                        asset === sym
                          ? "border-teal bg-teal/10 text-fg"
                          : "border-border bg-bg text-muted hover:text-fg",
                      )}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="checkout-email" className="mb-1 block text-xs font-medium text-muted">
                  Billing Email (for receipt &amp; key)
                </label>
                <input
                  id="checkout-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@company.com"
                  className="h-9 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="checkout-org" className="mb-1 block text-xs font-medium text-muted">
                  Organization (optional)
                </label>
                <input
                  id="checkout-org"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Acme Labs"
                  className="h-9 w-full rounded-md border border-border bg-bg px-3 text-xs text-fg focus:border-gold focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onFallbackInquiry();
                }}
                className="font-mono text-[11px] text-muted hover:text-gold"
              >
                Need custom invoice / PO? →
              </button>
              <Button type="submit" variant="gold" size="sm" disabled={loading}>
                {paymentMethod === "stripe" ? (
                  <>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    {loading ? "Starting Checkout…" : "Continue to Stripe"}
                  </>
                ) : (
                  <>
                    <Coins className="mr-1.5 size-3.5" />
                    {loading ? "Generating…" : `Generate ${asset} Invoice`}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
