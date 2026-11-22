import { headers } from 'next/headers'

/**
 * This request's CSP nonce, as middleware set it (lib/security/cspReportOnly.ts, Phase 3),
 * or undefined in `next dev` and in the allowlist-only CSP modes.
 *
 * ⚠ READS `x-nonce` AND NOTHING ELSE, ON PURPOSE. The root layout must never read or
 * branch on request headers such as the proxy-injected `x-af-pathname` — server and
 * client would render different HTML (see __tests__/root-language-provider-layout.test.tsx).
 * The nonce is the one exception: it changes an attribute browsers hide from the DOM,
 * never what renders. Keep this helper single-purpose so that guard stays meaningful.
 */
export async function getRequestNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined
}
