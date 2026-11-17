/**
 * iPhone or iPad, from what the browser reports — for copy that only makes sense there.
 *
 * ⚠ iPadOS Safari reports itself as a Mac ("Macintosh" in the user agent) by default, so an iPad is recognised by
 * a Mac user agent WITH a touch screen. Macs have no touch screen (maxTouchPoints is 0), which keeps them out.
 * Includes the AllFantasy iOS app: its WKWebView reports iPhone/iPad the same way.
 *
 * Pure, so it can run anywhere; pass navigator.userAgent and navigator.maxTouchPoints in the browser.
 */
export type AppleTouchDevice = 'iPhone' | 'iPad' | null

export function appleTouchDevice(userAgent: string | null | undefined, maxTouchPoints = 0): AppleTouchDevice {
  if (!userAgent) return null
  if (/\biPad\b/.test(userAgent)) return 'iPad'
  if (/\b(iPhone|iPod)\b/.test(userAgent)) return 'iPhone'
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return 'iPad'
  return null
}
