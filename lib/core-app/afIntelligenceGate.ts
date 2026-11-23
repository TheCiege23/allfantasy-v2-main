/**
 * Server half of the AF Intelligence gate (lib/core-app/afIntelligenceWithhold.ts): read the viewer's
 * plan once and withhold AF's own numbers from a payload when it does not open `af_intelligence`
 * (AF Pro, AF Commissioner or AF Supreme). Before the paywall launches everyone is unlocked, exactly as
 * every other /core depth.
 *
 * A locked payload that is a plain object also carries `afIntelligenceLock` — the lock's access object,
 * the same shape CoreDepthLock draws — so a screen can show the upgrade button where the AF number
 * would have been. ⚠ A failed plan read after launch is LOCKED (fail closed), like the rest of /core.
 */
import 'server-only'

import { NextResponse } from 'next/server'

import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { afIntelligenceFor } from '@/lib/core-app/afIntelligenceWithhold'

export async function readAfIntelligenceAccess(userId: string | null | undefined, email?: string | null): Promise<CoreDepthAccess> {
  return resolveCoreDepth(userId, 'af_intelligence', { email: email ?? null })
}

/** Apply a known access to a payload. */
export function gateAfIntelligence<T>(payload: T, access: CoreDepthAccess | null | undefined): T {
  if (!access || access.unlocked) return payload
  const out = afIntelligenceFor(payload, access)
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    return { ...(out as Record<string, unknown>), afIntelligenceLock: access } as T
  }
  return out
}

/** Read the plan and apply it — for a route that needs nothing else from the plan. */
export async function withAfIntelligence<T>(payload: T, userId: string | null | undefined, email?: string | null): Promise<T> {
  return gateAfIntelligence(payload, await readAfIntelligenceAccess(userId, email))
}

/**
 * `NextResponse.json` with the gate applied — the drop-in for a route's success return:
 * `return afJson(userId, payload, init)`. Errors stay plain `NextResponse.json`; they carry no AF number.
 */
export async function afJson<T>(userId: string | null | undefined, payload: T, init?: ResponseInit): Promise<NextResponse> {
  return NextResponse.json(await withAfIntelligence(payload, userId), init)
}
