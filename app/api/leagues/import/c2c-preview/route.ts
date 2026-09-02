import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { mergeC2CSources } from '@/lib/league-import/c2cMultiSourceMerge'
import { IMPORT_PROVIDERS, type C2CImportSource } from '@/lib/league-import/types'

export const dynamic = 'force-dynamic'

/**
 * POST: preview a C2C multi-source import (pro + college). Returns the
 * merged roster list plus unmatched managers for commissioner review.
 *
 * Body: {
 *   sources: [{ side: 'pro', provider, sourceId, rosterDepth }, { side: 'college', ... }],
 *   manualManagerMap?: Record<string, string>
 * }
 *
 * Does NOT write to the DB. Commit happens via a separate endpoint once the
 * commissioner accepts the preview.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    sources?: C2CImportSource[]
    manualManagerMap?: Record<string, string>
  } | null
  const sources = Array.isArray(body?.sources) ? body!.sources : []
  if (sources.length !== 2) {
    return NextResponse.json(
      { error: 'Exactly two sources required (one pro, one college).' },
      { status: 400 },
    )
  }
  const proSource = sources.find((s) => s.side === 'pro')
  const collegeSource = sources.find((s) => s.side === 'college')
  if (!proSource || !collegeSource) {
    return NextResponse.json(
      { error: 'One source must be side=pro and one must be side=college.' },
      { status: 400 },
    )
  }
  for (const s of [proSource, collegeSource]) {
    if (!(IMPORT_PROVIDERS as readonly string[]).includes(s.provider)) {
      return NextResponse.json({ error: `Unknown provider: ${s.provider}` }, { status: 400 })
    }
    if (!s.sourceId || typeof s.sourceId !== 'string') {
      return NextResponse.json({ error: 'Each source needs a sourceId.' }, { status: 400 })
    }
    if (s.rosterDepth !== 'all' && (!Number.isFinite(s.rosterDepth) || s.rosterDepth <= 0)) {
      return NextResponse.json({ error: 'rosterDepth must be "all" or a positive integer.' }, { status: 400 })
    }
  }

  // Delegate to the existing single-provider import preview — reuse its
  // auth, rate limits, and provider adapters. Both calls in parallel.
  // A self-directed fetch: req.nextUrl.origin is the BIND address, and
  // https://0.0.0.0:8080 fails the TLS handshake against our own plain-HTTP server.
  const origin = getServedOrigin(req)
  const cookie = req.headers.get('cookie') ?? ''
  const fetchPreview = async (s: C2CImportSource) => {
    const r = await fetch(`${origin}/api/leagues/import/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ provider: s.provider, sourceId: s.sourceId }),
    })
    if (!r.ok) {
      const detail = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(`[${s.side}] ${detail.error ?? r.statusText}`)
    }
    return (await r.json()) as { result: unknown }
  }

  try {
    const [proRes, collegeRes] = await Promise.all([
      fetchPreview(proSource),
      fetchPreview(collegeSource),
    ])
    const proResult = (proRes as { result: Parameters<typeof mergeC2CSources>[0]['pro'] }).result
    const collegeResult = (collegeRes as { result: Parameters<typeof mergeC2CSources>[0]['college'] }).result
    const merged = mergeC2CSources({
      pro: proResult,
      proSource,
      college: collegeResult,
      collegeSource,
      manualManagerMap: body?.manualManagerMap,
    })
    return NextResponse.json({
      ok: true,
      ...merged,
      summary: {
        proManagers: proResult.rosters.length,
        collegeManagers: collegeResult.rosters.length,
        merged: merged.merged.length,
        unmatchedPro: merged.unmatched.pro.length,
        unmatchedCollege: merged.unmatched.college.length,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Multi-source preview failed' },
      { status: 500 },
    )
  }
}
