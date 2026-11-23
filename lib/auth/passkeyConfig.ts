/**
 * Who a passkey belongs to (the WebAuthn "relying party"), and the device words people see. PURE.
 *
 * 🛑 THE RP ID IS PERMANENT. A passkey is bound to the rpID it was made under; change it and every
 * passkey anyone has saved stops working, with no way to move them. Production is fixed to
 * `www.allfantasy.ai` — the canonical host every link uses — rather than `allfantasy.ai`, because
 * the apex is redirected to www by Cloudflare, and Apple refuses a redirected
 * apple-app-site-association: an iOS app passkey (a later build) needs the file on the rpID's own
 * host. PASSKEY_RP_ID exists for a staging host, never to "tidy" production.
 *
 * Outside production the rpID and origin come from the request itself (localhost, a preview
 * port), so a dev box works with no setup. The browser refuses a passkey whose rpID does not
 * match the page it is on, so this cannot be used to make a passkey for someone else's site.
 */

export const PRODUCTION_PASSKEY_RP_ID = "www.allfantasy.ai"
export const PASSKEY_RP_NAME = "AllFantasy"

export type RelyingParty = { rpID: string; origins: string[] }

function originOf(value: string | null | undefined): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url : null
  } catch {
    return null
  }
}

/**
 * The relying party for this request. `requestOrigin` is the page's origin (the `Origin` header,
 * or the URL's origin); it is used only outside production.
 */
export function passkeyRelyingParty(
  requestOrigin: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): RelyingParty | null {
  const configured = env.PASSKEY_RP_ID?.trim()
  const extra = (env.PASSKEY_EXTRA_ORIGINS ?? "")
    .split(",")
    .map((value) => originOf(value.trim())?.origin)
    .filter((value): value is string => Boolean(value))

  if (env.NODE_ENV === "production") {
    const rpID = configured || PRODUCTION_PASSKEY_RP_ID
    return { rpID, origins: Array.from(new Set([`https://${rpID}`, ...extra])) }
  }

  const fromRequest = originOf(requestOrigin)
  if (configured) return { rpID: configured, origins: Array.from(new Set([`https://${configured}`, ...extra, ...(fromRequest ? [fromRequest.origin] : [])])) }
  if (!fromRequest) return null
  return { rpID: fromRequest.hostname, origins: Array.from(new Set([fromRequest.origin, ...extra])) }
}

export type PasskeyDevice = "iphone" | "ipad" | "mac" | "android" | "windows" | "other"

export function passkeyDevice(userAgent: string | null | undefined): PasskeyDevice {
  const ua = userAgent ?? ""
  if (/iPhone|iPod/i.test(ua)) return "iphone"
  if (/iPad/i.test(ua)) return "ipad"
  if (/Android/i.test(ua)) return "android"
  // iPadOS Safari reports itself as a Mac; the label stays honest enough ("Mac") either way.
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac"
  if (/Windows/i.test(ua)) return "windows"
  return "other"
}

/** What the unlock is called on this device: the words on the buttons. */
export function biometricName(device: PasskeyDevice): string {
  switch (device) {
    case "iphone":
    case "ipad":
      return "Face ID"
    case "mac":
      return "Touch ID"
    case "android":
      return "your fingerprint"
    case "windows":
      return "Windows Hello"
    default:
      return "a passkey"
  }
}

/** The name a saved passkey gets in settings: the kind of device it was made on. */
export function passkeyLabel(device: PasskeyDevice): string {
  switch (device) {
    case "iphone":
      return "iPhone"
    case "ipad":
      return "iPad"
    case "mac":
      return "Mac"
    case "android":
      return "Android phone"
    case "windows":
      return "Windows computer"
    default:
      return "Passkey"
  }
}
