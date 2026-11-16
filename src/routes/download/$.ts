import { createFileRoute } from "@tanstack/react-router";

// /download/* redirects to the live kovanica-testnet artifacts.
// Tag v0.3.0-node is commit e3fce499afe6637b2a594b60306aef6312ef4bbf
// on KovanicaDAG/kovanica-l1 (chain ID 2, Hybrid PoW + GHOSTDAG, no stake).
// install.sh on that tag defaults to the same release.
// Redirects (302) keep binary traffic off the Nitro server.

const LIVE_NODE_TAG = "v0.3.0-node";
const RAW = `https://raw.githubusercontent.com/KovanicaDAG/kovanica-l1/${LIVE_NODE_TAG}`;
const NODE_RELEASE = `https://github.com/KovanicaDAG/kovanica-l1/releases/download/${LIVE_NODE_TAG}`;

const DOWNLOADS: Record<string, string> = {
  "install.sh": `${RAW}/node/scripts/install.sh`,
  "kovanica-node-linux-x64": `${NODE_RELEASE}/kovanica-node-x86_64-linux.tar.gz`,
  "kovanica-node-linux-arm64": `${NODE_RELEASE}/kovanica-node-aarch64-linux.tar.gz`,
  "kovanica-chain2-genesis.tar.gz": `${NODE_RELEASE}/kovanica-chain2-genesis.tar.gz`,
};

export const Route = createFileRoute("/download/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.pathname.replace(/^\/download\//, "");
        const target = DOWNLOADS[name];
        if (!target) {
          return new Response("not found", { status: 404 });
        }
        return Response.redirect(target, 302);
      },
    },
  },
});
