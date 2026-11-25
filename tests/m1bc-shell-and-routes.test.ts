import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = process.cwd();
const SRC_DIR = join(WEB_ROOT, "src");

function walk(dir: string, exts: Set<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, exts, out);
    } else if (exts.has(abs.slice(abs.lastIndexOf(".")))) {
      out.push(abs);
    }
  }
  return out;
}

test("all key app, DeFi, RWA, wallet, and info routes wrap in unified <Shell>", () => {
  const walletRoute = readFileSync(join(SRC_DIR, "routes/wallet.tsx"), "utf8");
  assert.ok(walletRoute.includes("<Shell>"), "wallet.tsx must render <Shell>");
  assert.ok(
    !/if\s*\(\s*!isExact\s*\)\s*\{\s*return\s*<Outlet\s*\/>\s*;?\s*\}/.test(walletRoute),
    "wallet.tsx must not bypass <Shell> on child /wallet/* routes",
  );

  const requiredShellRoutes = [
    "routes/explorer.tsx",
    "routes/wallet.tsx",
    "routes/swap.tsx",
    "routes/pools.tsx",
    "routes/pool.tsx",
    "routes/rwa.tsx",
    "routes/multi-asset.tsx",
    "routes/stealth.tsx",
    "routes/nft.tsx",
    "routes/faucet.tsx",
    "routes/network.tsx",
    "routes/multisig.tsx",
    "routes/htlc.tsx",
    "routes/vaults.tsx",
    "routes/map.tsx",
    "routes/roadmap.tsx",
    "routes/docs.tsx",
    "routes/api-reference.tsx",
  ];

  for (const rel of requiredShellRoutes) {
    const abs = join(SRC_DIR, rel);
    assert.ok(existsSync(abs), `Missing route file ${rel}`);
    const content = readFileSync(abs, "utf8");
    assert.ok(content.includes("<Shell"), `${rel} must wrap its view in <Shell>`);
  }
});

test("rwa-issue.tsx uses SPA <Link to='/wallet'> instead of window.location.href", () => {
  const rwaIssue = readFileSync(join(SRC_DIR, "routes/wallet/rwa-issue.tsx"), "utf8");
  assert.ok(
    !/window\.location\.href\s*=\s*["']\/wallet["']/.test(rwaIssue),
    "rwa-issue.tsx must not hard-reload via window.location.href",
  );
  assert.ok(rwaIssue.includes('to="/wallet"'), "rwa-issue.tsx must link to /wallet via SPA <Link>");
});

test("zero orphaned routes in routeTree.gen.ts and zero banned links in src/", () => {
  const routeTree = readFileSync(join(SRC_DIR, "routeTree.gen.ts"), "utf8");
  const fullPaths = new Set<string>();
  const re = /fullPath:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(routeTree)) !== null) {
    if (m[1]) fullPaths.add(m[1]);
  }
  assert.ok(fullPaths.size > 0, "Expected routes in routeTree.gen.ts");

  const uiFiles = walk(SRC_DIR, new Set([".ts", ".tsx"])).filter(
    (f) => !f.endsWith("routeTree.gen.ts") && !f.includes("/api/"),
  );
  const combined = uiFiles.map((f) => readFileSync(f, "utf8")).join("\n");

  const skip = new Set(["/", "/api/$", "/download/$"]);
  const orphaned: string[] = [];
  for (const r of fullPaths) {
    if (skip.has(r)) continue;
    const needle = r.includes("$") ? r.slice(0, r.indexOf("$")) : r;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pat = new RegExp(`(?:to|href)=["'\`]${escaped}|to:\\s*["'\`]${escaped}`);
    if (!pat.test(combined)) {
      orphaned.push(r);
    }
  }
  assert.deepEqual(orphaned, [], `Orphaned routes found: ${orphaned.join(", ")}`);

  for (const f of walk(SRC_DIR, new Set([".ts", ".tsx"]))) {
    const text = readFileSync(f, "utf8");
    assert.ok(!/KovanicaDAG\/kovanica/i.test(text), `Banned KovanicaDAG link in ${f}`);
    assert.ok(!/https?:\/\/api\.kovanica\.online/i.test(text), `Dead api.kovanica.online in ${f}`);
    assert.ok(!/\bpool\.kovanica\.online\b/i.test(text), `Dead pool.kovanica.online in ${f}`);
    assert.ok(!/\.kovanica\.org\b/i.test(text), `Banned .kovanica.org in ${f}`);
    assert.ok(!/\/api\/supply\b/.test(text), `Unimplemented /api/supply reference in ${f}`);
  }
});

test("kovanica-web design tokens and typography are preserved in src/styles.css", () => {
  const styles = readFileSync(join(SRC_DIR, "styles.css"), "utf8");
  const expectedTokens: Record<string, string> = {
    "--color-bg": "#09090b",
    "--color-surface": "#121214",
    "--color-surface-2": "#1a1a1e",
    "--color-border": "#2a2a30",
    "--color-fg": "#f2f1ee",
    "--color-muted": "#9a9aa3",
    "--color-subtle": "#6b6b74",
    "--color-gold": "#F2A900",
    "--color-teal": "#2fbaa4",
    "--color-blue": "#8aa0b4",
  };
  for (const [token, hex] of Object.entries(expectedTokens)) {
    const re = new RegExp(`${token}:\\s*${hex}`, "i");
    assert.ok(re.test(styles), `Missing design token ${token}: ${hex} in src/styles.css`);
  }
  assert.ok(styles.includes("Fraunces"), "Fraunces font must be preserved");
  assert.ok(styles.includes("IBM Plex Sans"), "IBM Plex Sans font must be preserved");
  assert.ok(styles.includes("IBM Plex Mono"), "IBM Plex Mono font must be preserved");
});

test("wallet child routes do not double-wrap <Shell> and Shell guards against nesting", () => {
  const shellSource = readFileSync(join(SRC_DIR, "components/layout/shell.tsx"), "utf8");
  assert.ok(
    shellSource.includes("ShellContext"),
    "shell.tsx must guard against nested <Shell> renders via ShellContext",
  );

  const walletChildDir = join(SRC_DIR, "routes/wallet");
  for (const abs of walk(walletChildDir, new Set([".ts", ".tsx"]))) {
    const content = readFileSync(abs, "utf8");
    assert.ok(
      !/<Shell[\s>]/.test(content),
      `Child wallet route ${abs} must not wrap itself in <Shell> (parent routes/wallet.tsx already renders <Shell>)`,
    );
  }
});

test("Shell defines 5 canonical function tabs with unique routes and HomeTestnet reuses NAV_GROUPS", () => {
  const shellSource = readFileSync(join(SRC_DIR, "components/layout/shell.tsx"), "utf8");
  const testnetHomeSource = readFileSync(
    join(SRC_DIR, "components/landing/testnet-home.tsx"),
    "utf8",
  );

  for (const id of ["explore", "trade", "assets", "wallet", "build"]) {
    assert.ok(
      shellSource.includes(`id: "${id}"`),
      `Shell NAV_GROUPS must include canonical function group "${id}"`,
    );
  }

  const navBlockMatch = shellSource.match(/export const NAV_GROUPS = \[([\s\S]*?)\] as const;/);
  assert.ok(navBlockMatch, "NAV_GROUPS export must exist in shell.tsx");
  const routes = [...navBlockMatch[1].matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(
    new Set(routes).size,
    routes.length,
    `Duplicate route found across Shell NAV_GROUPS: ${routes.join(", ")}`,
  );
  assert.ok(
    testnetHomeSource.includes('from "@/components/layout/shell"') &&
      testnetHomeSource.includes("NAV_GROUPS"),
    "HomeTestnet must reuse NAV_GROUPS from shell.tsx so tab names and groupings stay 100% consistent",
  );
});
