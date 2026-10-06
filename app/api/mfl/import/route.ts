import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { runImportedLeagueNormalizationPipeline } from '@/lib/league-import/ImportedLeagueNormalizationPipeline'
import {
  ImportedLeagueConflictError,
  persistImportedLeagueFromNormalization,
} from '@/lib/league-import/ImportedLeagueCommitService'
import { assertImportCommissioner, recordImportAttestation } from '@/lib/league-import/commissionerGate'
import { commissionerGateFailureResponse } from '@/lib/league-import/commissionerGateResponse'
import { importerManagerIdForRosters } from '@/lib/league-import/importerManagerId'

function mapImportErrorStatus(code: string): number {
  if (code === 'LEAGUE_NOT_FOUND') return 404
  if (code === 'UNAUTHORIZED') return 401
  if (code === 'CONNECTION_REQUIRED') return 400
  return 500
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
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

  /*
   * The MFL username-and-password session (/api/auth/mfl, `mfl_session`) that a request with
   * no league id used to fall back to is retired (2026-10): it stored MFL's session cookie in
   * plaintext and its "historical import" was never live. Imports name a league and read it
   * with the caller's stored MFL API key, above.
   */
  return NextResponse.json({ error: 'Choose an MFL league to import.' }, { status: 400 })
})
