/**
 * Which "turn the relay off" steps to show someone the VPN gate refused for being
 * on a privacy-relay network (`why=relay` on /vpn-blocked).
 *
 * iCloud Private Relay covers SAFARI only — Chrome or Firefox on an iPhone send
 * their traffic directly, so a relay address from one of those is almost
 * certainly Cloudflare WARP (the 1.1.1.1 app), which leaves through the same
 * Cloudflare network. Hence the browser test, not just the device test.
 *
 * ⚠ iPadOS Safari sends a Mac user agent by default, so "mac-safari" also covers
 * iPads; the Mac steps carry the iPad variant for that reason.
 */

export type RelayHelpVariant = "ios-safari" | "mac-safari" | "other"

const IOS_DEVICE = /\b(?:iPhone|iPad|iPod)\b/
const IOS_OTHER_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|GSA|YaBrowser|DuckDuckGo)\b/
const NOT_SAFARI = /\b(?:Chrome|Chromium|CriOS|Edg|EdgA|OPR|Firefox|FxiOS)\//

export function relayHelpVariant(userAgent: string | null | undefined): RelayHelpVariant {
  const ua = userAgent ?? ""
  if (IOS_DEVICE.test(ua)) return IOS_OTHER_BROWSER.test(ua) ? "other" : "ios-safari"
  if (/\bMacintosh\b/.test(ua) && /\bVersion\/[\d.]+.*\bSafari\//.test(ua) && !NOT_SAFARI.test(ua)) {
    return "mac-safari"
  }
  return "other"
}
