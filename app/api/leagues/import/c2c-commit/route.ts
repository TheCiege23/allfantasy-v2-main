import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { resolveAppUserIdForLeagueCreate } from '@/lib/redraft-creation/resolve-app-user-for-league'
import { mergeC2CSources } from '@/lib/league-import/c2cMultiSourceMerge'
import { persistC2CMultiSource } from '@/lib/league-import/c2cMultiSourceCommit'
import { IMPORT_PROVIDERS, type C2CImportSource } from '@/lib/league-import/types'

export const dynamic = 'force-dynamic'

const ALLOWED_DRAFT_TYPES = new Set(['c2c_snake', 'c2c_linear', 'c2c_auction'])
const ALLOWED_SPORTS = new Set(['NFL', 'NBA'])

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null; name?: string | null }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolvedUser = await resolveAppUserIdForLeagueCreate(session.user)
  if (!resolvedUser.ok) {
    return NextResponse.json({ error: 'No matching AppUser for this session.' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as {
    sources?: C2CImportSource[]
    manualManagerMap?: Record<string, string>
    leagueName?: string
    sport?: string
    draftType?: string
    scoringPreset?: string
  } | null

  const sources = Array.isArray(body?.sources) ? body!.sources : []
  if (sources.length !== 2) {
    return NextResponse.json({ error: 'Exactly two sources required.' }, { status: 400 })
  }
  const proSource = sources.find((s) => s.side === 'pro')
  const collegeSource = sources.find((s) => s.side === 'college')
  if (!proSource || !collegeSource) {
    return NextResponse.json({ error: 'Need one pro and one college source.' }, { status: 400 })
  }
  for (const s of [proSource, collegeSource]) {
    if (!(IMPORT_PROVIDERS as readonly string[]).includes(s.provider)) {
      return NextResponse.json({ error: `Unknown provider: ${s.provider}` }, { status: 400 })
    }
    if (!s.sourceId?.trim()) {
      return NextResponse.json({ error: 'Each source needs a sourceId.' }, { status: 400 })
    }
  }
  const leagueName = body?.leagueName?.trim()
  if (!leagueName) return NextResponse.json({ error: 'leagueName is required' }, { status: 400 })
  const sport = String(body?.sport ?? '').toUpperCase()
  if (!ALLOWED_SPORTS.has(sport)) {
    return NextResponse.json({ error: 'sport must be NFL or NBA.' }, { status: 400 })
  }
  const draftType = String(body?.draftType ?? 'c2c_snake')
  if (!ALLOWED_DRAFT_TYPES.has(draftType)) {
    return NextResponse.json({ error: 'Invalid draftType for C2C.' }, { status: 400 })
  }
  const scoringPreset = String(body?.scoringPreset ?? (sport === 'NFL' ? 'half_ppr' : 'standard'))

  // Re-run the preview pipeline server-side — never trust client-submitted
  // bundles for persistence.
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
    return (await r.json()) as { result: Parameters<typeof mergeC2CSources>[0]['pro'] }
  }

  try {
    const [proRes, collegeRes] = await Promise.all([
      fetchPreview(proSource),
      fetchPreview(collegeSource),
    ])
    const mergeResult = mergeC2CSources({
      pro: proRes.result,
      proSource,
      college: collegeRes.result,
      collegeSource,
      manualManagerMap: body?.manualManagerMap,
    })
    if (mergeResult.merged.length === 0) {
      return NextResponse.json(
        {
          error:
            'No managers could be matched between the two sources. Add manual mappings and retry.',
          unmatched: mergeResult.unmatched,
        },
        { status: 400 },
      )
    }
    const commit = await persistC2CMultiSource({
      appUserId: resolvedUser.appUserId,
      leagueName,
      sport: sport as 'NFL' | 'NBA',
      draftType: draftType as 'c2c_snake' | 'c2c_linear' | 'c2c_auction',
      scoringPreset,
      merged: mergeResult.merged,
      proSource,
      collegeSource,
    })
    return NextResponse.json({
      ok: true,
      leagueId: commit.leagueId,
      rostersCreated: commit.rostersCreated,
      playerStatesCreated: commit.playerStatesCreated,
      joinCode: commit.joinCode,
      joinUrl: commit.joinCode
        ? `${origin}/join?code=${encodeURIComponent(commit.joinCode)}`
        : null,
      unmatched: mergeResult.unmatched,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Commit failed' },
      { status: 500 },
    )
  }
}
