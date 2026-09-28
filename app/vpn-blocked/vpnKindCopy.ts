/**
 * What /vpn-blocked says for each kind of anonymizer the gate can see. Plain
 * data with no imports, so the client retry panel can use it without pulling
 * the vendor lookup into the browser bundle.
 *
 * ⚠ The kinds mirror `AnonymizerKind` in lib/geo/geoIpParse — `satisfies`
 * below fails the typecheck if one is added there and not here.
 */

import type { AnonymizerKind } from "@/lib/geo/geoIpParse"

export interface VpnKindCopy {
  title: string
  /** Finishes "We can still see …". */
  detected: string
  lead: string
  steps: string[]
}

export const VPN_KIND_COPY = {
  privacy_relay: {
    title: "Turn off iCloud Private Relay to use AllFantasy.ai",
    detected: "iCloud Private Relay (or Cloudflare WARP)",
    lead:
      "Your VPN may already be off — but Safari is also sending you through iCloud Private Relay, which is switched on " +
      "for many iPhones by default. It hides which state you're in, so it has to be off for this site.",
    steps: [
      "Safari on iPhone or iPad: tap the page menu at the left of the address bar (it shows aA on older iPhones) and choose Show IP Address, then tap Try again.",
      "Or turn it off everywhere: Settings → your name → iCloud → Private Relay.",
      "Safari on Mac: View → Reload and Show IP Address.",
      "Using the Cloudflare WARP / 1.1.1.1 app? Switch it off.",
    ],
  },
  vpn: {
    title: "Turn off your VPN to use AllFantasy.ai",
    detected: "a VPN",
    lead: "We can still see a VPN on this connection. Many VPN apps quietly reconnect on their own after you close them.",
    steps: [
      "Open your VPN app and tap Disconnect.",
      "iPhone: open Settings → VPN and check it says Not Connected. If it keeps turning back on, go to Settings → General → VPN & Device Management → VPN, tap ⓘ next to it and turn off Connect On Demand.",
      "Android: Settings → Network & internet → VPN, tap ⚙ next to it and turn off Always-on VPN.",
      "Also using Safari? iCloud Private Relay counts too — tap the page menu in the address bar and choose Show IP Address.",
    ],
  },
  proxy: {
    title: "Turn off your proxy to use AllFantasy.ai",
    detected: "a proxy",
    lead: "Your connection goes through a proxy. Work, school, hotel and public Wi-Fi often do this without telling you.",
    steps: [
      "Switch to mobile data (turn Wi-Fi off), then tap Try again.",
      "If you set up a proxy yourself on iPhone: Settings → Wi-Fi → ⓘ next to your network → Configure Proxy → Off.",
      "Turn off any VPN or privacy app that may be routing your traffic.",
    ],
  },
  hosting: {
    title: "Switch networks to use AllFantasy.ai",
    detected: "a data-centre (cloud server) address",
    lead:
      "Your connection is coming from a cloud server rather than a home or mobile network. That's almost always a VPN, a privacy app, or a work network.",
    steps: [
      "Turn off any VPN, privacy or ad-blocking app that routes your traffic.",
      "Switch to mobile data (turn Wi-Fi off), then tap Try again.",
      "Safari: tap the page menu in the address bar and choose Show IP Address.",
    ],
  },
  tor: {
    title: "Tor can't be used with AllFantasy.ai",
    detected: "Tor",
    lead: "Tor hides which state you're in, so the app can't be used through it.",
    steps: ["Open allfantasy.ai in a regular browser such as Safari or Chrome."],
  },
} satisfies Record<AnonymizerKind, VpnKindCopy>

export function vpnKindCopy(kind: unknown): VpnKindCopy | null {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(VPN_KIND_COPY, kind)
    ? VPN_KIND_COPY[kind as AnonymizerKind]
    : null
}
