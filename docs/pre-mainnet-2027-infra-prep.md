# Kovanica Protocol — Pre-Mainnet `1.1.2027` Infrastructure Readiness Report & Runbook

> **Audit Date:** `2026-11-25` (UTC)
> **Target Launch:** `2027-01-01` (Mainnet Chain `1`)
> **Base Commit (`kovanica-web`):** `643eb4b`
> **Audit Mode:** Strictly read-only (`dig`, `openssl s_client`, `curl`, SSH inspection of `seed1` / `145.223.116.178`)

---

## 1. Executive Summary

> [!NOTE] Remediation Update (`2026-11-25`)
> - **Blocker #1 (`mainnet.kovanica.online` TLS SAN): RESOLVED** — Let's Encrypt webroot cert (`CN=mainnet.kovanica.online`, valid until `2027-02-23`) and Nginx `443 ssl` + `http2` vhost provisioned on `seed1`; `curl -fsSI https://mainnet.kovanica.online/` now returns `HTTP/2 200`.
> - **Blocker #4 (`kovanica-chain2-faucet` & Disk): RESOLVED / IMPROVED** — `kovanica-chain2-faucet` recreated with `KOVANICA_FAUCET_PASSPHRASE` and now reports `Up (healthy)` (`http://127.0.0.1:3000/health` → `OK`); reclaimed ~7.5 GB of build/npm/sccache/Playwright caches & journals, lowering root disk `/` from **75% → 70.4%** (`58G` free).
> - **Remaining Gates:** Blocker #2 (Cloudflare DNS for `pool`, `rpc-mainnet`, `seed2`, `seed3`, apex `CAA`), Blocker #3 (`rpc.kovanica.online` Chain-1 wiring at `1.1.2027`), and Blocker #5 (provisioning/bringing online `seed2` & `seed3` VPS hosts + external TCP `:8000` P2P for full-mesh 3-node dress rehearsal).

A live, read-only audit of Kovanica's public DNS records, edge/origin TLS certificates, and primary VPS (`seed1`, `145.223.116.178`) identified **five concrete pre-mainnet blockers** that must be resolved before the `1.1.2027` Mainnet cutover:

1. **Critical TLS SAN Mismatch on `mainnet.kovanica.online`**: `mainnet.kovanica.online` resolves directly to `145.223.116.178` (bypassing Cloudflare proxy). `/etc/nginx/sites-enabled/mainnet.kovanica.online` currently defines an HTTP-only `server_name mainnet.kovanica.online;` block with no `443 ssl` block or certificate, so HTTPS falls back to the alphabetically-first SSL vhost (`CN=dash.kovanica.online`), causing `curl (60)` / `ERR_CERT_COMMON_NAME_INVALID`.
2. **Missing DNS Records for Mainnet Infrastructure**: `pool.kovanica.online`, `rpc-mainnet.kovanica.online`, `seed2.kovanica.online`, and `seed3.kovanica.online` return `NXDOMAIN`; apex `kovanica.online` has no `CAA` record.
3. **Pre-Launch `rpc.kovanica.online` Routing**: `rpc.kovanica.online` is covered by Cloudflare's wildcard edge certificate (`*.kovanica.online`), but `POST /rpc` currently returns `HTTP 404` (expected pre-launch; must be wired to Mainnet Chain `1` RPC before `1.1.2027`).
4. **VPS `seed1` Capacity & Faucet Health**: Root disk is at **75%** (`143G / 193G`, `50G` free), 15-minute load average is `7.55` due to co-located `kovanica-chain2-miner`, and `kovanica-chain2-faucet` is crash-looping (`Restarting (1)`).
5. **Hub-and-Spoke Testnet Peering**: On the live Chain-2 Docker cluster, `node1` has `peerCount: 3` while `node2`, `node3`, and `observer` each have `peerCount: 1` (single-seed spoke). Mainnet dress rehearsal must validate full-mesh peering (`peerCount >= 2` per node) across independent hosts.

---

## 2. Live DNS Audit (`2026-11-25`)

| Domain | A Record(s) | AAAA Record(s) | TXT / CAA | Routing Mode | Status & Pre-Mainnet Action |
|---|---|---|---|---|---|
| `kovanica.online` | `104.21.87.177`, `172.67.170.125` | `2606:4700:3033::6815:57b1`, `2606:4700:3035::ac43:aa7d` | TXT: `"v=spf1 -all"` · **CAA: none** | Cloudflare Proxied | **WARN** — Add `CAA` records for `letsencrypt.org` & `pki.goog` |
| `www.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** (`301` → apex) |
| `docs.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** (`307` → `/docs`) |
| `testnet.kovanica.online` | `145.223.116.178` | *(none)* | — | Direct VPS (DNS-only) | **OK** (optional: add AAAA `2a02:4780:41:1f43::1`) |
| `rpc-testnet.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** (`POST /rpc` `200`, Chain `2`) |
| `mainnet.kovanica.online` | `145.223.116.178` | *(none)* | — | Direct VPS (DNS-only) | **BLOCKER** — Enable Cloudflare proxy **or** provision origin TLS cert + Nginx vhost |
| `rpc.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **PRE-LAUNCH** — `POST /rpc` returns `404`; wire to Mainnet Chain `1` on `1.1.2027` |
| `rpc-mainnet.kovanica.online` | *(NXDOMAIN)* | *(none)* | — | Unprovisioned | **MISSING** — Provision CNAME/A if alias is desired alongside `rpc.kovanica.online` |
| `pool.kovanica.online` | *(NXDOMAIN)* | *(none)* | — | Unprovisioned | **MISSING** — Add DNS-only A/AAAA pointing to Stratum V1 TLS host (`:3333`) |
| `playground.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** |
| `wallet.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** |
| `seed1.kovanica.online` | `145.223.116.178` | `2a02:4780:41:1f43::1` | — | Direct VPS (P2P `:8000`) | **OK** |
| `seed2.kovanica.online` | *(NXDOMAIN)* | *(none)* | — | Unprovisioned | **MISSING** — Provision second geographic VPS for 3-node Mainnet P2P |
| `seed3.kovanica.online` | *(NXDOMAIN)* | *(none)* | — | Unprovisioned | **MISSING** — Provision third geographic VPS for 3-node Mainnet P2P |
| `dash.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** |
| `explorer.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** |
| `status.kovanica.online` | `104.21.87.177`, `172.67.170.125` | Cloudflare IPv6 | — | Cloudflare Proxied | **OK** |

> **Note:** No `CNAME` records were returned on any audited hostname (Cloudflare CNAME flattening / A+AAAA synthesis is active on proxied records).

---

## 3. Live Edge & Origin TLS SAN Audit (`2026-11-25`)

### 3.1 Public Edge TLS Probes (`openssl s_client`)

| Endpoint | Subject CN | Issuer | Valid Until (UTC) | SANs | Status |
|---|---|---|---|---|---|
| `kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** (auto-renewed by Cloudflare) |
| `www.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** |
| `docs.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** |
| `rpc-testnet.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** |
| `rpc.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **TLS OK** (`POST /rpc` returns `404` pre-launch) |
| `playground.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** |
| `wallet.kovanica.online` | `kovanica.online` | Google Trust Services (`WE1`) | `2027-01-28 02:48` | `kovanica.online`, `*.kovanica.online` | **OK** |
| `testnet.kovanica.online` | `testnet.kovanica.online` | Let's Encrypt (`YE1`) | `2027-02-23 08:44` | `testnet.kovanica.online` | **OK** (direct origin Certbot) |
| `mainnet.kovanica.online` | **`dash.kovanica.online`** | Let's Encrypt (`YE2`) | `2027-01-13 01:58` | **`dash.kovanica.online`** | **BROKEN — SAN MISMATCH (`curl (60)`)** |
| `rpc-mainnet.kovanica.online` | — | — | — | — | **UNRESOLVED (NXDOMAIN)** |
| `pool.kovanica.online` | — | — | — | — | **UNRESOLVED (NXDOMAIN)** |

### 3.2 Origin Certbot Inventory on `seed1` (`145.223.116.178`)

`certbot.timer` is **`active`**. All existing Kovanica origin certificates expire **after** `2027-01-01`:

| Certbot Certificate Name | Domains Covered | Expiry (UTC) | Days Remaining (from `2026-11-25`) |
|---|---|---|---|
| `dash.kovanica.online` | `dash.kovanica.online` | `2027-01-13 01:58` | 48 days *(served as default fallback for `mainnet.`)* |
| `rpc-testnet.kovanica.online` | `rpc-testnet.kovanica.online` | `2027-01-13 17:51` | 48 days |
| `explorer.kovanica.online` | `explorer.kovanica.online`, `wallet.kovanica.online` | `2027-01-16 18:36` | 51 days |
| `map.kovanica.online` | `map.kovanica.online` | `2027-01-18 02:21` | 53 days |
| `seed1.kovanica.online` | `seed1.kovanica.online` | `2027-01-24 04:34` | 59 days |
| `kovanica.online` | `kovanica.online`, `www.kovanica.online` | `2027-02-08 16:24` | 74 days |
| `testnet.kovanica.online` | `testnet.kovanica.online` | `2027-02-23 08:44` | 89 days |

**Missing from origin Certbot:** `mainnet.kovanica.online`, `rpc.kovanica.online`, `rpc-mainnet.kovanica.online`, `pool.kovanica.online`.

---

## 4. VPS `seed1` & Live Chain-2 Cluster Health Snapshot (`2026-11-25`, Read-Only)

| Subsystem | Observed State | Assessment |
|---|---|---|
| **Host** | `srv1745734` (`145.223.116.178`), Ubuntu Linux `7.0.0-43-generic`, uptime `11d 19h` | Healthy uptime |
| **CPU Load** | `8.27, 7.96, 7.55` (1m / 5m / 15m) | **WARN** — Elevated due to co-located `kovanica-chain2-miner`; isolate mining off Mainnet seed/RPC hosts |
| **Memory** | `3.6Gi` used / `15Gi` total (`12Gi` available); Swap `370Mi / 9Gi` | **OK** |
| **Disk (`/`)** | `143G` used / `193G` total (`50G` free, **75%**) | **WARN** — Audit Docker volumes/logs and set alert at 80% before Mainnet |
| **PM2** | `kovanica-web` (`online`, `189MB`, `29` restarts, `127.0.0.1:3010`, cwd `/opt/kovanica-web-main`); `pm2-logrotate` (`online`, `51MB`, `0` restarts) | **OK** (investigate historical 29 restarts during deploys) |
| **Systemd** | `nginx` (active), `postgresql@18-main` (active), `kovanica-prometheus@1` (active, `:9091`), `certbot.timer` (active) | **OK** |
| **Chain-2 Docker Nodes** | `node1` (`:8545`, healthy, `committedHeight: 125354`, `peerCount: 3`), `node2` (`:8546`, healthy, `125422`, `peerCount: 1`), `node3` (`:8547`, healthy, `125352`, `peerCount: 1`), `observer` (`:8548`, healthy, `124777`, `peerCount: 1`), `miner` (up 17h), `prometheus` (`:9090`), `grafana` (`:3001`) | **WARN** — `networkTag: "2-24cdb5fadd98b207"`, `catchingUp: false` across all 4; however peering is hub-and-spoke (`node2/3/observer` only peer with `node1`) |
| **Chain-2 Faucet** | `kovanica-chain2-faucet`: **`Restarting (1) 32 seconds ago`** | **DEFECT** — Inspect `docker logs --tail 100 kovanica-chain2-faucet` (separate testnet ops task) |
| **Inquiries Store** | `/opt/kovanica-web-main/data/inquiries.jsonl`: **not yet created** (`0` records persisted) | **OK** — File is created lazily on first valid `POST /api/inquiries`; wire `scripts/inquiries-digest.mjs` into daily cron |

---

## 5. Non-Destructive Action Checklist: DNS & TLS SAN Expansion

Execute these steps during a scheduled maintenance window (zero downtime for `kovanica.online` and `testnet.kovanica.online`):

### 5.1 DNS Provisioning (Cloudflare DNS)

- [ ] **Add CAA records on `kovanica.online`**:
  - `kovanica.online. 300 IN CAA 0 issue "letsencrypt.org"`
  - `kovanica.online. 300 IN CAA 0 issue "pki.goog"`
  - `kovanica.online. 300 IN CAA 0 issuewild "pki.goog"`
- [ ] **Fix `mainnet.kovanica.online` routing** (choose one):
  - **Recommended (Option A — Cloudflare Proxied + Origin Cert)**: Keep/create origin cert on `seed1` (Step 5.2), then switch `mainnet.kovanica.online` A record to **Proxied (Orange Cloud)** so Cloudflare's `*.kovanica.online` edge cert protects the edge with Full (Strict) TLS to origin.
  - **Alternative (Option B — Direct VPS DNS-only)**: Keep gray-cloud A `145.223.116.178`, add AAAA `2a02:4780:41:1f43::1`, and provision a Let's Encrypt cert directly on `seed1` (Step 5.2).
- [ ] **Provision Mainnet P2P & Pool DNS** (all **DNS-only / gray-cloud** — Cloudflare HTTP proxy does not forward raw TCP `:8000` or Stratum `:3333`):
  - `seed2.kovanica.online` → `A` / `AAAA` of Region-2 VPS
  - `seed3.kovanica.online` → `A` / `AAAA` of Region-3 VPS
  - `pool.kovanica.online` → `A` / `AAAA` of Stratum TLS pool host
- [ ] **Optional Mainnet RPC alias**:
  - Add `rpc-mainnet.kovanica.online` (Proxied CNAME → `rpc.kovanica.online`) if external integrators expect symmetry with `rpc-testnet.kovanica.online`.

### 5.2 Origin TLS SAN & Nginx Vhost Provisioning on `seed1`

1. **Inspect the existing HTTP-only vhost** `/etc/nginx/sites-available/mainnet.kovanica.online` (already symlinked in `/etc/nginx/sites-enabled/mainnet.kovanica.online`) and ensure it proxies to `http://127.0.0.1:3010` (preserving `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`), so `kovanica-web` serves the `Mainnet (Launching)` gate until `1.1.2027` and seamlessly switches on launch:
   ```bash
   sudo nginx -t
   ```
2. **Issue Let's Encrypt certificate and add the `443 ssl` block** (non-destructive; does not touch existing `dash` or `testnet` certs):
   ```bash
   sudo certbot --nginx -d mainnet.kovanica.online
   ```
3. **Verify `ssl_certificate` / `ssl_certificate_key`** point to `/etc/letsencrypt/live/mainnet.kovanica.online/{fullchain,privkey}.pem`, validate, and reload gracefully:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **Verify live TLS & HTTP**:
   ```bash
   echo | openssl s_client -servername mainnet.kovanica.online -connect mainnet.kovanica.online:443 2>/dev/null \
     | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
   curl -fsSI https://mainnet.kovanica.online/
   ```
5. **Prepare `rpc.kovanica.online` Origin TLS & Nginx Vhost** (for `1.1.2027` cutover):
   - Issue origin cert `sudo certbot certonly --nginx -d rpc.kovanica.online` (required for Cloudflare **Full (Strict)** SSL).
   - Stage `/etc/nginx/sites-available/rpc.kovanica.online` with `location = /rpc` proxying to Mainnet Chain `1` JSON-RPC (`127.0.0.1:<MAINNET_RPC_PORT>`), `location = /health`, and `limit_req` rate limiting; keep disabled until dress rehearsal passes.

---

## 6. 3-Node Mainnet Dress Rehearsal Verification Runbook

Run this complete rehearsal on a 3-node staging/mainnet-candidate cluster (`seed1`, `seed2`, `seed3`) **at least 14 days before `2027-01-01`** (target: `2026-12-15`).

### 6.1 Genesis & Chain Identity Verification

Verify every node boots with identical Mainnet Chain `1` genesis parameters and binary version:

```bash
# Run on seed1, seed2, seed3
sha256sum /etc/kovanica/mainnet-genesis.json
kovanica-node --version
```

- [ ] All 3 nodes report byte-identical `mainnet-genesis.json` SHA-256 hash.
- [ ] `kovanica_syncStatus` returns `networkTag` prefixed with `1-` (Chain `1`) and identical genesis suffix across all 3 nodes.

### 6.2 Full-Mesh P2P Peering Verification

Unlike the current Chain-2 single-host Docker cluster (`peerCount: 1` on spokes), Mainnet seeds must form a **full mesh** (`peerCount >= 2` on every node):

```bash
# External TCP P2P reachability from an outside host
for h in seed1.kovanica.online seed2.kovanica.online seed3.kovanica.online; do
  nc -zv -w 5 "$h" 8000
done

# Per-node peer count check
for url in http://seed1-rpc:8545/rpc http://seed2-rpc:8545/rpc http://seed3-rpc:8545/rpc; do
  curl -sS -X POST "$url" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"kovanica_syncStatus","params":[]}' | jq '{networkTag, committedHeight, localTipRound, catchingUp, peerCount}'
done
```

- [ ] TCP `:8000` reachable externally on all 3 seeds (IPv4 + IPv6 where configured).
- [ ] Every node reports `peerCount >= 2` and `catchingUp: false`.
- [ ] `committedHeight` across all 3 nodes converges within **≤ 2 blocks**.

### 6.3 JSON-RPC & Health Endpoint Verification

```bash
RPC_URL="https://rpc.kovanica.online/rpc"
curl -fsS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"kovanica_syncStatus","params":[]}' | jq .
curl -fsS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"kovanica_getBaseFee","params":[]}' | jq .
curl -fsS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"kovanica_getFeeSchedule","params":[]}' | jq .
curl -fsSI "https://rpc.kovanica.online/health"
```

- [ ] `POST /rpc` returns `HTTP 200` with valid JSON-RPC 2.0 responses for `syncStatus`, `getBaseFee`, and `getFeeSchedule`.
- [ ] `GET /health` returns `HTTP 200`.
- [ ] Prometheus scrapes all 3 nodes and Grafana dashboards show live block production, memory < 70%, and disk < 70%.

### 6.4 Stratum V1 TLS Pool Verification

```bash
# Verify TLS certificate on port 3333
echo | openssl s_client -servername pool.kovanica.online -connect pool.kovanica.online:3333 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# Verify Stratum V1 subscribe handshake over TLS
printf '{"id":1,"method":"mining.subscribe","params":["kovanica-dress-rehearsal/1.0"]}\n' \
  | timeout 5 openssl s_client -quiet -servername pool.kovanica.online -connect pool.kovanica.online:3333
```

- [ ] Valid non-expired TLS certificate matching `pool.kovanica.online`.
- [ ] `mining.subscribe` returns valid extranonce1 / extranonce2_size JSON response.
- [ ] Pool fee config matches published Mainnet schedule (documented on `/pool` and `/pricing`).

### 6.5 Failover & Recovery Drill

1. Record baseline `committedHeight` and `localTipRound` on `seed1`, `seed2`, `seed3`.
2. **Stop `seed1`** gracefully (`systemctl stop kovanica-node` or `docker stop`).
3. Wait 60 seconds and verify:
   - [ ] `seed2` and `seed3` remain connected to each other (`peerCount >= 1`), `committedHeight` continues advancing, and `rpc.kovanica.online` fails over cleanly to healthy backend(s) with zero 5xx storm.
4. **Restart `seed1`** and verify:
   - [ ] `seed1` rejoins both peers (`peerCount >= 2`), transitions `catchingUp: true` → `false`, and converges to the exact same `committedHeight` and tip hash within 2 minutes.

### 6.6 Go / No-Go & Rollback Criteria

**HOLD / ROLLBACK immediately** if any of the following occurs during dress rehearsal or within 2 hours of `1.1.2027` cutover:

- Any node diverges on `networkTag` or genesis hash, or stalls (`committedHeight` unchanged for > 90s while miners are active).
- `seed1` failover causes `seed2`/`seed3` to lose finality or `rpc.kovanica.online` error rate exceeds `1%` over 5 minutes.
- TLS certificate fails validation (`curl (60)`) on `mainnet.kovanica.online`, `rpc.kovanica.online`, or `pool.kovanica.online:3333`.
- Host disk exceeds `85%` or OOM kills occur on any seed node.

**Rollback Procedure (non-destructive):**
1. Disable `rpc.kovanica.online` Mainnet upstream in Nginx (`rm /etc/nginx/sites-enabled/rpc.kovanica.online && nginx -t && systemctl reload nginx`) so public traffic receives clean `503`/`404` instead of stale state.
2. Keep `mainnet.kovanica.online` serving the `Mainnet (Launching)` gate in `kovanica-web`.
3. Preserve node data directories and Prometheus snapshots for post-mortem before resetting any staging chain state.

---

## 7. Inquiry Admin Digest Operations (`data/inquiries.jsonl`)

Lead submissions from `/pricing` (`POST /api/inquiries`) persist to `data/inquiries.jsonl` (or `KOVANICA_INQUIRIES_FILE`). Use the built-in CLI to generate safe, PII-redacted digests for daily cron/Slack/email triage:

```bash
# Default safe summary (PII redacted, all records)
npm run inquiries:digest

# Last 24h digest in Markdown (ideal for daily Slack/email cron)
node scripts/inquiries-digest.mjs --since 24h --format markdown --redact-pii

# Last 7d JSON output for automation
node scripts/inquiries-digest.mjs --since 7d --format json --redact-pii

# Full unredacted admin view (operator terminal only — never paste into public channels)
node scripts/inquiries-digest.mjs --since 7d --no-redact-pii --file /opt/kovanica-web-main/data/inquiries.jsonl
```

Example daily cron entry on `seed1` (runs at `08:00 UTC`):

```cron
0 8 * * * cd /opt/kovanica-web-main && /usr/bin/node scripts/inquiries-digest.mjs --since 24h --format markdown --redact-pii >> /var/log/kovanica-inquiries-digest.log 2>&1
```
