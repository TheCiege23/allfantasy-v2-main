import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import {
  ImportedLeagueConflictError,
  persistImportedLeagueFromNormalization,
} from '@/lib/league-import/ImportedLeagueCommitService'
import { assertImportCommissioner, recordImportAttestation } from '@/lib/league-import/commissionerGate'
import { commissionerGateFailureResponse } from '@/lib/league-import/commissionerGateResponse'
import { importerManagerIdForRosters } from '@/lib/league-import/importerManagerId'

async function getMFLConnection() {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get('mfl_session')?.value
  if (!sessionId) return null
  
  return prisma.mFLConnection.findUnique({
    where: { sessionId }
  })
}

function mapImportErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  return 500
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const GET = withApiUsage({ endpoint: "/api/mfl/leagues", tool: "MflLeagues" })(async () => {
  try {
    const auth = await requireVerifiedUser()
    if (!auth.ok) {
      return auth.response
    }

    const connection = await getMFLConnection()
    
    if (!connection) {
      return NextResponse.json({ connected: false }, { status: 401 })
    }

    const year = connection.year || new Date().getFullYear()
    
    const leaguesUrl = `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`
    const res = await fetch(leaguesUrl, {
      headers: {
        'Cookie': `MFL_USER_ID=${connection.mflCookie}`
      }
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch leagues' }, { status: 500 })
    }

    const data = await res.json()
    
    let leagues: any[] = []
    if (data.leagues?.league) {
      const rawLeagues = Array.isArray(data.leagues.league) 
        ? data.leagues.league 
        : [data.leagues.league]
      
      leagues = rawLeagues.map((lg: any) => ({
        leagueId: lg.league_id,
        name: lg.name,
        url: lg.url,
        franchiseId: lg.franchise_id,
        franchiseName: lg.franchise_name
      }))
    }

    return NextResponse.json({
      connected: true,
      username: connection.mflUsername,
      year,
      leagues
    })

  } catch (error: any) {
    console.error('MFL leagues error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch leagues' },
      { status: 500 }
    )
  }
})

export const POST = withApiUsage({ endpoint: "/api/mfl/import", tool: "MflImport" })(async (req: NextRequest) => {
  const auth = await requireVerifiedUser()
  if (!auth.ok) {
    return auth.response
  }

  let body: {
    sourceId?: string
    leagueId?: string
    season?: number
    startYear?: number
    endYear?: number
    attestation?: { accepted?: boolean; statement?: string }
  } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const sourceId =
    typeof body.sourceId === 'string' && body.sourceId.trim()
      ? body.sourceId.trim()
      : typeof body.leagueId === 'string' && body.leagueId.trim()
        ? body.season
          ? `${body.season}:${body.leagueId.trim()}`
          : body.leagueId.trim()
        : ''

  if (sourceId) {
    /*
     * 🛑 THIS BRANCH USED TO PERSIST AFTER ONLY `requireVerifiedUser()`: any verified account
     * could import any MFL league id and become its AllFantasy owner. `checkMfl` proves
     * membership from the caller's own stored API key; MFL has no commissioner flag, so a
     * full-league commit also needs the attestation — exactly as /api/leagues/import/commit.
     */
    const gateAttestation = body.attestation?.accepted
      ? { accepted: true, statement: body.attestation.statement }
      : undefined
    const gate = await assertImportCommissioner({
      appUserId: auth.userId,
      provider: 'mfl',
      sourceLeagueId: sourceId,
      requireCommissioner: true,
      attestation: gateAttestation,
    })
    if (!gate.ok) {
      return commissionerGateFailureResponse(gate, { attestationHint: true })
    }

    const normalizedResult = await runImportedLeagueNormalizationPipeline({
      provider: 'mfl',
      sourceId,
      userId: auth.userId,
    })

    if (!normalizedResult.success) {
      return NextResponse.json(
        { error: normalizedResult.error },
        { status: mapImportErrorStatus(normalizedResult.code) }
      )
    }

    try {
      const persisted = await persistImportedLeagueFromNormalization({
        userId: auth.userId,
        provider: 'mfl',
        normalized: normalizedResult.normalized,
        allowUpdateExisting: true,
        // The caller's own franchise, proven by the gate — claims their team on import.
        // ⚠ Translated from franchise id to the rosters' manager key (owner_id where MFL publishes
        // one). See lib/league-import/importerManagerId.ts.
        importerSourceManagerId: importerManagerIdForRosters(
          'mfl',
          gate.sourceManagerId,
          normalizedResult.normalized.rosters,
        ),
      })

      if (gate.verification === 'attestation' && gateAttestation) {
        void recordImportAttestation({
          leagueId: persisted.league.id,
          appUserId: auth.userId,
          provider: 'mfl',
          sourceLeagueId: sourceId,
          attestation: gateAttestation,
        }).catch(() => {})
      }

      return NextResponse.json({
        success: true,
        imported: 1,
        provider: 'mfl',
        leagueId: persisted.league.id,
        leagueName: persisted.league.name,
        historicalBackfill: persisted.historicalBackfill,
        existed: persisted.existed,
      })
    } catch (error) {
      if (error instanceof ImportedLeagueConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      throw error
    }
  }

  const connection = await getMFLConnection()
  if (!connection) {
    return NextResponse.json({ connected: false, error: 'Connect your MFL account first.' }, { status: 401 })
  }

  return NextResponse.json(
    {
      error: 'Historical MFL import is not live yet. Right now this connection only supports account authentication and league listing.',
      supported: false,
    },
    { status: 501 }
  )
})
