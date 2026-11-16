# kovanica-web

Source of the public site **kovanica.online** (TanStack Start + Vite + Nitro 3).

Public copy matches the live testnet: kovanica-testnet chain ID 2, Hybrid PoW + GHOSTDAG, no stake, node tag `v0.3.0-node` (commit `e3fce499`), mainnet launch 1.1.2027. The testnet faucet is the existing `/faucet` route (fixed dispense; an unset `KOVANICA_FAUCET_URL` reports unavailable). Downloads under `/download` redirect to that tag on KovanicaDAG/kovanica-l1.

Brand tokens in `src/styles.css` stay ink (`--color-bg`), paper (`--color-fg`), and copper (`--color-gold`). Public copy does not describe another chain.

Agent rules and the full-scope plan: [docs/AGENT-RULES.md](https://github.com/KovanicaDAG/kovanica-l1/blob/main/docs/AGENT-RULES.md) and [docs/PLAN-FULL-SCOPE.md](https://github.com/KovanicaDAG/kovanica-l1/blob/main/docs/PLAN-FULL-SCOPE.md) in KovanicaDAG/kovanica-l1.

## Develop

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build:vps   # Nitro node-server preset, output in .output/
```

`@kovanica/sdk-wasm` is vendored as a prebuilt wasm-pack package in
`vendor/kovanica-sdk-wasm` (built from the Kovanica SDK `kovanica-wasm` bindings).

Runtime configuration comes from environment variables (`KOVANICA_*`, `GROK_AUTH_*`,
`GROK_PREVIEW_CLIENT_SECRET`); never commit hosts, IPs, ports, keys or secrets.
