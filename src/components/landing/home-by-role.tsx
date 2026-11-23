/**
 * Host-role switch for the `/` route.
 *
 * Wire this from index.tsx (or whatever renders `/`) instead of always
 * mounting HomeLanding — otherwise testnet/mainnet become a copy of the
 * marketing page.
 *
 * Depends on existing host helpers from DOMAIN-HOST-ROLE-FIX:
 *   hostRoleFromHost / isLandingHost in src/lib/host.ts (or site/src/lib/host.ts)
 *
 * If those helpers live under a different path, adjust the import only.
 */
import { HomeLanding } from "./home";
import { HomeTestnet } from "./testnet-home";
import { HomeMainnet } from "./mainnet-home";
import { type HostRole } from "@/lib/host";

export function HomeByRole({ role }: { role: HostRole }) {
  switch (role) {
    case "landing":
      return <HomeLanding />;
    case "mainnet":
      return <HomeMainnet />;
    case "testnet":
    case "shared":
      return <HomeTestnet />;
    default:
      // docs / api / faucet should redirect at the root gate; fallback to testnet home
      return <HomeTestnet />;
  }
}
