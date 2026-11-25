import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { SURFACE, SURFACE_STATUS } from "../src/lib/surfaces";
import { hostRoleFromHost, networkFromHost } from "../src/lib/host";
import { LIVE_EXPLORER } from "../src/lib/networkConstants";
import {
  buildContractBatchSdkSnippet,
  buildContractCurlSnippet,
  buildContractSdkSnippet,
} from "../src/lib/contracts/dry-run";
import { Route as DownloadRoute } from "../src/routes/download/$";

const SRC_DIR = path.resolve(import.meta.dirname, "../src");

async function walkSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(full)));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test("SURFACE and SURFACE_STATUS expose canonical Kovanica endpoints without dead hosts or old orgs", () => {
  assert.equal(SURFACE.landing, "https://kovanica.online");
  assert.equal(SURFACE.testnet, "https://testnet.kovanica.online");
  assert.equal(SURFACE.mainnet, "https://mainnet.kovanica.online");
  assert.equal(SURFACE.dash, "https://dash.kovanica.online");
  assert.equal(SURFACE.api, "https://testnet.kovanica.online/api-reference");
  assert.equal(SURFACE.docs, "https://docs.kovanica.online");
  assert.equal(SURFACE.playground, "https://playground.kovanica.online");
  assert.equal(SURFACE.explorer, "https://testnet.kovanica.online/explorer");
  assert.equal(SURFACE.wallet, "https://testnet.kovanica.online/wallet");
  assert.equal(SURFACE.pool, "https://testnet.kovanica.online/pool");
  assert.equal(SURFACE.pools, "https://testnet.kovanica.online/pools");
  assert.equal(SURFACE.rpcTestnet, "https://rpc-testnet.kovanica.online/rpc");
  assert.equal(SURFACE.github, "https://github.com/BetterCallDzuks");
  assert.equal(SURFACE_STATUS.mainnet, "Mainnet (Launching)");

  for (const [key, value] of Object.entries(SURFACE)) {
    assert.ok(!value.includes("KovanicaDAG"), `SURFACE.${key} must not reference KovanicaDAG`);
    assert.ok(
      !value.includes("api.kovanica.online"),
      `SURFACE.${key} must not reference dead api.kovanica.online`,
    );
  }
});

test("hostRoleFromHost and networkFromHost resolve all roles and strip optional ports", () => {
  assert.equal(hostRoleFromHost("kovanica.online"), "landing");
  assert.equal(hostRoleFromHost("www.kovanica.online"), "landing");
  assert.equal(hostRoleFromHost("kovanica.online:3000"), "landing");
  assert.equal(hostRoleFromHost("www.kovanica.online:443."), "landing");
  assert.equal(hostRoleFromHost("explorer.kovanica.online"), "explorer");
  assert.equal(hostRoleFromHost("explorer.kovanica.online:8080"), "explorer");
  assert.equal(hostRoleFromHost("wallet.kovanica.online:3000"), "wallet");
  assert.equal(hostRoleFromHost("map.kovanica.online"), "map");
  assert.equal(hostRoleFromHost("faucet.kovanica.online"), "faucet");
  assert.equal(hostRoleFromHost("docs.kovanica.online"), "docs");
  assert.equal(hostRoleFromHost("api.kovanica.online"), "api");
  assert.equal(hostRoleFromHost("playground.kovanica.online"), "playground");
  assert.equal(hostRoleFromHost("dash.kovanica.online"), "dash");
  assert.equal(hostRoleFromHost("testnet.kovanica.online"), "testnet");
  assert.equal(hostRoleFromHost("mainnet.kovanica.online:8443"), "mainnet");
  assert.equal(hostRoleFromHost("localhost:3000"), "shared");

  assert.equal(networkFromHost("mainnet.kovanica.online:443"), "mainnet");
  assert.equal(networkFromHost("testnet.kovanica.online:3000"), "testnet");
});

test("/download/$ redirects install.sh and node archives to BetterCallDzuks/kovanica-l1", async () => {
  const serverOpts = DownloadRoute.options.server as
    | { handlers?: { GET?: (ctx: { request: Request }) => Promise<Response> } }
    | undefined;
  const getHandler = serverOpts?.handlers?.GET;
  assert.ok(typeof getHandler === "function", "/download/$ must define a GET handler");

  const installRes = await getHandler({
    request: new Request("https://kovanica.online/download/install.sh"),
  });
  assert.equal(installRes.status, 302);
  assert.equal(
    installRes.headers.get("location"),
    "https://raw.githubusercontent.com/BetterCallDzuks/kovanica-l1/main/node/scripts/install.sh",
  );

  for (const name of [
    "kovanica-node-linux-x64",
    "kovanica-node-linux-arm64",
    "kovanica-chain2-genesis.tar.gz",
  ]) {
    const res = await getHandler({
      request: new Request(`https://kovanica.online/download/${name}`),
    });
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      "https://github.com/BetterCallDzuks/kovanica-l1/releases",
    );
  }

  const missingRes = await getHandler({
    request: new Request("https://kovanica.online/download/nonexistent"),
  });
  assert.equal(missingRes.status, 404);
});

test("dry-run snippets default to https://rpc-testnet.kovanica.online/rpc when rpcUrl is omitted", () => {
  const contractAddress = "00".repeat(31) + "01";
  const curl = buildContractCurlSnippet({
    contractAddress,
    presetId: "name_resolve",
    fields: { name: "alice" },
  });
  assert.ok(curl.includes("https://rpc-testnet.kovanica.online/rpc"));
  assert.ok(!curl.includes("https://testnet.kovanica.online/rpc"));

  const sdk = buildContractSdkSnippet({
    contractAddress,
    presetId: "name_resolve",
    fields: { name: "alice" },
  });
  assert.ok(sdk.includes("https://rpc-testnet.kovanica.online/rpc"));
  assert.ok(!sdk.includes("https://testnet.kovanica.online/rpc"));

  const batchSdk = buildContractBatchSdkSnippet({
    items: [
      {
        id: "1",
        presetId: "name_resolve",
        contractAddress,
        entry: "name_resolve",
        fields: { name: "alice" },
        dataHex: "0x",
        byteLength: 0,
      },
    ],
  });
  assert.ok(batchSdk.includes("https://rpc-testnet.kovanica.online/rpc"));
  assert.ok(!batchSdk.includes("https://testnet.kovanica.online/rpc"));
});

test("LIVE_EXPLORER server proxy origin stays https://explorer.kovanica.online", () => {
  assert.equal(LIVE_EXPLORER, "https://explorer.kovanica.online");
});

test("src/ contains zero dead KovanicaDAG GitHub links, .kovanica.org domains, or unshaded Tailwind v4 tokens", async () => {
  const files = await walkSourceFiles(SRC_DIR);
  assert.ok(files.length > 50, "expected source files under src/");

  const unshadedTailwindRe =
    /(?:text|bg|border|ring|from|to|via|divide|outline|decoration|accent|caret|fill|stroke|shadow)-(?:emerald|purple|amber|rose|cyan|indigo|violet|green|yellow|orange|sky|lime|pink|fuchsia|slate|gray|zinc|neutral|stone)(?:$|[\s"'`:/])/;

  for (const file of files) {
    const rel = path.relative(SRC_DIR, file);
    const content = await readFile(file, "utf8");

    assert.ok(
      !content.includes("github.com/KovanicaDAG"),
      `${rel} must not contain github.com/KovanicaDAG`,
    );
    assert.ok(
      !content.includes("KovanicaDAG/kovanica-l1"),
      `${rel} must not contain KovanicaDAG/kovanica-l1`,
    );
    assert.ok(!/\.kovanica\.org\b/.test(content), `${rel} must not contain .kovanica.org`);
    assert.ok(
      !content.includes("https://testnet.kovanica.online/rpc"),
      `${rel} must not contain wrong RPC URL https://testnet.kovanica.online/rpc`,
    );
    assert.ok(
      !content.includes("/api/download/install.sh"),
      `${rel} must not contain /api/download/install.sh`,
    );
    assert.ok(
      !content.includes("https://explorer.kovanica.online/api/"),
      `${rel} must not point API snippets to explorer.kovanica.online/api/`,
    );
    assert.ok(!content.includes("surface-1"), `${rel} must not contain undefined surface-1 token`);
    assert.ok(
      !unshadedTailwindRe.test(content),
      `${rel} must not contain unshaded Tailwind v4 palette tokens`,
    );
  }
});
