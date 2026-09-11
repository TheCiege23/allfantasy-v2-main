import 'server-only'
import { NextResponse } from 'next/server'

/** Public profile browsing/generation is retired for every plan, including the subject. */
export async function retiredProfileRoute(_request?: Request, _context?: unknown) {
  return NextResponse.json({ error: 'Use Competitive Edge within a league decision.', code: 'PROFILE_SURFACE_RETIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } })
}
