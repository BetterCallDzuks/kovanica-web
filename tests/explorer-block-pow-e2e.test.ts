import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function isVpsBuildStale(outputEntry = ".output/server/index.mjs"): boolean {
  if (!existsSync(outputEntry)) return true;
  const outputMtime = statSync(outputEntry).mtimeMs;
  const newestMtime = (target: string): number => {
    if (!existsSync(target)) return 0;
    const st = statSync(target);
    if (!st.isDirectory()) return st.mtimeMs;
    let max = st.mtimeMs;
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      max = Math.max(max, newestMtime(join(target, entry.name)));
    }
    return max;
  };
  return ["src", "public", "vite.config.ts", "package.json"].some(
    (p) => newestMtime(p) > outputMtime,
  );
}

const TIP_ID = "0x3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const GENESIS_ID = "0x17e79432dfbee3adad15d7a851ff78ebafcefbc547073883489cd9cbdaae60fa";
const POW_HASH = "0x00000000aabbccdd11223344556677889900aabbccdd11223344556677889900";
const STATE_ROOT = "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";
const TX_MERKLE_ROOT = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const POW_TIMESTAMP_SEC = 1_760_000_000;
const POW_TIMESTAMP_ISO = new Date(POW_TIMESTAMP_SEC * 1000).toISOString();

const MOCK_STATE = {
  selected: "seed1",
  mining: true,
  faucet: false,
  allow_reset: false,
  operator: false,
  network: "kovanica-testnet",
  chain_id: 2,
  listen: "0.0.0.0:8000",
  peers: ["seed1.kovanica.online:8000"],
  mesh: {
    now: Date.now(),
    queued: 0,
    nodes: [
      {
        name: "seed1",
        blocks: 12450,
        tip: TIP_ID,
        peers: ["seed1.kovanica.online:8000"],
        mempool: 0,
      },
    ],
    events: [],
  },
  node: {
    blocks: 12450,
    tips: [TIP_ID],
    selected_tip: TIP_ID,
    blue_score: 12450,
    blue_work: 1245000,
    k: 5,
    subsidy: 2500000000,
    issuance: 2500000000,
    halving_era: 8200000,
    min_fee: 10000,
    genesis: GENESIS_ID,
    supply: 90200000000000000,
    token: "KVNC",
    decimals: 9,
    miner: "Miner 0x1",
    atom: 1000000000,
    ui: "hybrid",
    utxos: 0,
    chain_len: 12450,
    mempool: 0,
    tx_count: 1,
    mining_info: {
      target_bits: 0x1d00ffff,
      difficulty: 1.0,
      target_block_time_ms: 4000,
      ghostdag_k: 5,
      mining_enabled: true,
      pow_algorithm: "KovanicaHash",
    },
    dag: [
      {
        id: TIP_ID,
        parents: [GENESIS_ID],
        selected_parent: GENESIS_ID,
        work: 12450,
        timestamp_ms: Date.now(),
        nonce: 987654321,
        blue_score: 12450,
        colour: "chain",
        txs: [],
        target_bits: 0x1d00ffff,
        difficulty: 1.0,
        pow_hash: POW_HASH,
        state_root: STATE_ROOT,
        tx_merkle_root: TX_MERKLE_ROOT,
        pow_timestamp: POW_TIMESTAMP_SEC,
      },
      {
        id: GENESIS_ID,
        parents: [],
        selected_parent: null,
        work: 0,
        timestamp_ms: Date.now() - 60_000,
        nonce: 0,
        blue_score: 0,
        colour: "genesis",
        txs: [],
      },
    ],
    order: [GENESIS_ID, TIP_ID],
    pending: [],
  },
  wallets: [],
  source: "testnet",
};

let port: number;
let serverProcess: ChildProcess;
let browser: Browser;
let baseUrl: string;

async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('button[title="Mainnet"]') ?? document.body;
      if (!el) return false;
      return Object.keys(el).some(
        (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"),
      );
    },
    undefined,
    { timeout: 30_000 },
  );
}

before(async () => {
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  if (isVpsBuildStale()) {
    const { execSync } = await import("node:child_process");
    execSync("npm run build:vps", { stdio: "inherit" });
  }

  serverProcess = spawn("node", [".output/server/index.mjs"], {
    env: { ...process.env, NITRO_PORT: String(port), HOST: "127.0.0.1", PORT: String(port) },
    stdio: "pipe",
  });

  const start = Date.now();
  let online = false;
  while (Date.now() - start < 15_000) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) {
        online = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!online) {
    throw new Error(`Local test server on port ${port} failed to become ready`);
  }

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  await browser?.close();
  if (serverProcess) {
    serverProcess.kill("SIGINT");
  }
});

test("Explorer block detail view toggles PoW proof drawer open/closed and displays PoW fields", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const isLoopback =
        url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]";

      if (!isLoopback) {
        await route.abort("blockedbyclient");
        return;
      }

      if (url.pathname === "/api/state") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_STATE),
        });
        return;
      }

      await route.continue();
    });

    await page.goto(`${baseUrl}/explorer`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);

    const drawer = page.getByTestId("block-pow-drawer");
    const toggle = page.getByTestId("block-pow-drawer-toggle");
    await drawer.waitFor({ state: "visible", timeout: 15_000 });

    // Collapsed by default
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByTestId("block-pow-drawer-content").count(), 0);

    // Toggle open
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await page.getByTestId("block-pow-drawer-content").waitFor({ state: "visible" });

    // Verify all 7 PoW header & proof fields
    assert.equal(
      (await page.getByTestId("pow-field-target-bits").innerText()).trim(),
      "0x1d00ffff",
    );
    assert.equal(
      (await page.getByTestId("pow-field-difficulty").innerText()).trim(),
      "1.00",
    );
    assert.ok(
      (await page.getByTestId("pow-field-nonce").innerText()).includes("987,654,321"),
      "Nonce field must render formatted decimal nonce",
    );
    assert.equal(
      (await page.getByTestId("pow-field-pow-hash").innerText()).trim(),
      POW_HASH,
    );
    assert.equal(
      (await page.getByTestId("pow-field-state-root").innerText()).trim(),
      STATE_ROOT,
    );
    assert.equal(
      (await page.getByTestId("pow-field-tx-merkle-root").innerText()).trim(),
      TX_MERKLE_ROOT,
    );
    assert.equal(
      (await page.getByTestId("pow-field-pow-timestamp").innerText()).trim(),
      POW_TIMESTAMP_ISO,
    );

    // Copy buttons present for hashes/roots
    await page.getByTestId("pow-copy-pow-hash").waitFor({ state: "visible" });
    await page.getByTestId("pow-copy-state-root").waitFor({ state: "visible" });
    await page.getByTestId("pow-copy-tx-merkle-root").waitFor({ state: "visible" });

    // Toggle closed
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByTestId("block-pow-drawer-content").count(), 0);

    // Navigate to genesis block (missing optional PoW fields) and verify graceful fallbacks
    await page.goto(`${baseUrl}/explorer?block=${GENESIS_ID}`, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await toggle.waitFor({ state: "visible", timeout: 15_000 });
    await toggle.click();
    await page.getByTestId("block-pow-drawer-content").waitFor({ state: "visible" });

    assert.equal(
      (await page.getByTestId("pow-field-target-bits").innerText()).trim(),
      "n/a",
    );
    assert.equal(
      (await page.getByTestId("pow-field-pow-hash").innerText()).trim(),
      "n/a",
    );
    assert.ok(
      (await page.getByTestId("pow-field-nonce").innerText()).includes("0"),
      "Genesis block nonce 0 must be displayed truthfully",
    );
  } finally {
    await context.close();
  }
});
