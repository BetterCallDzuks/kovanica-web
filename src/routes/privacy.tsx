import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { Shell } from "@/components/layout/shell";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-8 py-6">
        <header className="space-y-3 border-b border-border pb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-xs text-gold">
            <ShieldCheck className="size-3.5" />
            <span>Zero Telemetry · Local Custody Only</span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
            Privacy Policy — Kovanica Wallet &amp; Protocol
          </h1>
          <p className="text-sm text-muted">
            Effective Date: November 25, 2026 · Publisher: Kovanica Protocol (
            <span className="font-mono text-fg">kovanica.online</span>) · Applies to Kovanica Wallet
            (Chrome Web Store &amp; Firefox Add-ons) and Kovanica web interfaces.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-medium text-fg">1. Overview</h2>
          <p className="text-sm leading-relaxed text-muted">
            Kovanica Wallet is a <strong className="text-fg">self-custodial</strong>, open-source
            browser extension wallet for the Kovanica (KVNC) Layer-1 blockchain. Privacy and local
            custody are core architectural invariants:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="text-fg">Zero Telemetry:</strong> We do not collect, log, or
              transmit analytics, crash reports, usage metrics, device identifiers, or browsing
              history.
            </li>
            <li>
              <strong className="text-fg">Zero Plaintext Key Storage:</strong> Your BIP-39 mnemonic
              phrase and Ed25519 private keys are never transmitted to any server and are never
              stored in plaintext.
            </li>
            <li>
              <strong className="text-fg">Zero Third-Party Tracking:</strong> The extension contains
              no third-party SDKs, advertising pixels, or external script loaders.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-medium text-fg">
            2. Data Stored Locally on Your Device
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Kovanica Wallet stores data exclusively inside your browser&apos;s local extension
            storage (<code className="font-mono text-fg">chrome.storage.local</code> /{" "}
            <code className="font-mono text-fg">browser.storage.local</code>):
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="text-fg">
                Encrypted Wallet Vault (
                <code className="font-mono">kovanica_encrypted_vault_v1</code>):
              </strong>{" "}
              Encrypted locally using the browser&apos;s Web Crypto API (PBKDF2-SHA256 with{" "}
              <code className="font-mono">&gt;= 600,000</code> iterations and AES-256-GCM with
              random 16-byte salt and 12-byte IV). Decrypted secrets exist only in ephemeral
              extension memory while unlocked and are wiped when you lock the wallet or when the
              auto-lock alarm fires.
            </li>
            <li>
              <strong className="text-fg">
                Scoped Session Key Metadata (
                <code className="font-mono">kovanica_session_keys_v1</code>):
              </strong>{" "}
              Stores public session key identifiers and policy parameters (label, allowed
              contracts/methods, spend cap, expiry round, revocation status) created by you for
              Wave C session keys.
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-muted">
            This data never leaves your browser profile unless you explicitly export your recovery
            phrase yourself.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-medium text-fg">
            3. Network &amp; RPC Communications
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            To display balances, nonces, dynamic Wave B fee estimates, and broadcast transactions
            you explicitly approve, Kovanica Wallet communicates <strong className="text-fg">only</strong>{" "}
            with the Kovanica network RPC and WebSocket endpoint corresponding to your selected
            network:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/40">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface/80 font-mono text-subtle">
                <tr>
                  <th className="px-3 py-2">Network</th>
                  <th className="px-3 py-2">JSON-RPC Endpoint</th>
                  <th className="px-3 py-2">WebSocket Endpoint</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-mono text-fg">
                <tr>
                  <td className="px-3 py-2 font-sans font-medium">Kovanica Mainnet (Chain 1)</td>
                  <td className="px-3 py-2">https://rpc.kovanica.online/rpc</td>
                  <td className="px-3 py-2">wss://rpc.kovanica.online/ws</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-sans font-medium">Kovanica Testnet (Chain 2)</td>
                  <td className="px-3 py-2">https://rpc-testnet.kovanica.online/rpc</td>
                  <td className="px-3 py-2">wss://rpc-testnet.kovanica.online/ws</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-sans font-medium">Local Devnet</td>
                  <td className="px-3 py-2">http://127.0.0.1:8545/rpc</td>
                  <td className="px-3 py-2">ws://127.0.0.1:8545/ws</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              <strong className="text-fg">Read queries:</strong> Your public PRO-21 account address
              (<code className="font-mono text-fg">kvnc...dag</code> /{" "}
              <code className="font-mono text-fg">tknc...dag</code>) to fetch balance, nonce, and
              fee parameters.
            </li>
            <li>
              <strong className="text-fg">Broadcasts:</strong> Cryptographically signed transaction
              payloads only when you explicitly initiate a transfer or approve a dApp transaction.
            </li>
            <li>
              <strong className="text-fg">Transport metadata:</strong> As with any direct
              HTTPS/WebSocket request, the RPC server observes your IP address at the transport
              layer. Kovanica Wallet does not attach cookies, analytics headers, or cross-session
              tracking identifiers.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-medium text-fg">
            4. Decentralized Application (<code className="font-mono">window.kovanica</code>){" "}
            Interactions
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              The extension injects a read-only <code className="font-mono text-fg">window.kovanica</code>{" "}
              provider object and an isolated message bridge on HTTPS and localhost pages so
              Kovanica dApps can detect the wallet.
            </li>
            <li>
              The content script does not read, scrape, or transmit webpage DOM content or your
              browsing history.
            </li>
            <li>
              Every <code className="font-mono text-fg">connect</code>,{" "}
              <code className="font-mono text-fg">signTransaction</code>,{" "}
              <code className="font-mono text-fg">signBatchTransaction</code>,{" "}
              <code className="font-mono text-fg">signSponsoredTransaction</code>, and{" "}
              <code className="font-mono text-fg">signMessage</code> request opens an isolated
              approval popup requiring your explicit approval.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl font-medium text-fg">
            5. Data Sharing, Sale &amp; Retention
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            We do not sell, rent, or transfer user data to any third party. Because all wallet data
            is stored locally in your browser, removing the extension or clearing extension storage
            permanently deletes all local vault and session data from your device. Always back up
            your BIP-39 recovery phrase before uninstalling.
          </p>
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-display text-xl font-medium text-fg">6. Open Source &amp; Contact</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Repository:{" "}
              <a
                href="https://github.com/BetterCallDzuks/kovanica-apps"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-gold underline-offset-4 hover:underline"
              >
                github.com/BetterCallDzuks/kovanica-apps
              </a>
            </li>
            <li>
              Security &amp; Privacy Inquiries:{" "}
              <a
                href="https://github.com/BetterCallDzuks/kovanica-apps/issues"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-gold underline-offset-4 hover:underline"
              >
                github.com/BetterCallDzuks/kovanica-apps/issues
              </a>
            </li>
          </ul>
        </section>
      </div>
    </Shell>
  );
}
