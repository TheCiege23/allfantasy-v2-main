/** A defense in depth gate for the PWABuilder iOS app's Stripe routes. */
export function isAppleIosShellRequest(request: Request): boolean {
  const agent = request.headers.get("user-agent") ?? ""
  if (/\bPWAShell\b/.test(agent) && /iPhone|iPad|iPod/.test(agent)) return true
  const cookie = request.headers.get("cookie") ?? ""
  return /(?:^|;\s*)app-platform=iOS(?:%20|\+)App(?:%20|\+)Store(?:;|$)/i.test(cookie)
}
