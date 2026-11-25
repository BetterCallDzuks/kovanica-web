import { createFileRoute } from "@tanstack/react-router";

// /download/* redirects to the live kovanica-testnet artifacts on BetterCallDzuks/kovanica-l1.
// install.sh lives on main; node binaries and genesis bundles point to GitHub Releases
// until a v*-node tag release is published.
// Redirects (302) keep binary traffic off the Nitro server.

const RAW_MAIN = "https://raw.githubusercontent.com/BetterCallDzuks/kovanica-l1/main";
const NODE_RELEASES = "https://github.com/BetterCallDzuks/kovanica-l1/releases";

const DOWNLOADS: Record<string, string> = {
  "install.sh": `${RAW_MAIN}/node/scripts/install.sh`,
  "kovanica-node-linux-x64": NODE_RELEASES,
  "kovanica-node-linux-arm64": NODE_RELEASES,
  "kovanica-chain2-genesis.tar.gz": NODE_RELEASES,
};

export const Route = createFileRoute("/download/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = url.pathname.replace(/^\/download\//, "");
        const target = Object.hasOwn(DOWNLOADS, name) ? DOWNLOADS[name] : undefined;
        if (!target) {
          return new Response("not found", { status: 404 });
        }
        return Response.redirect(target, 302);
      },
    },
  },
});
