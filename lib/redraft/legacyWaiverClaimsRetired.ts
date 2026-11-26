/**
 * The old redraft waiver table (`redraft_waiver_claims`) takes no NEW claims (owner, 2026-11-26).
 *
 * Every waiver claim now goes through the main waiver system: `/api/waiver-wire/leagues/{leagueId}/claims`,
 * settled by `/api/cron/waivers` on the league's own clock and rules (lib/waiver-wire/process-engine.ts).
 * The old path settled claims hourly with simpler rules, and two engines settling one league could both
 * award a player. No screen still sends claims here; this closes the three routes that could.
 *
 * Claims ALREADY pending in the old table still settle (the hourly job drains them) and can still be
 * cancelled, so retiring the writers strands nobody. Once none are pending, the old engine can go.
 */
import { NextResponse } from 'next/server'

export const LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_CODE = 'LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED'
export const LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_MESSAGE =
  "Waiver claims moved to your league's Waivers screen. Make the claim there."

/** Thrown by service functions that used to write a claim to the old table. */
export class LegacyRedraftWaiverClaimsRetiredError extends Error {
  readonly code = LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_CODE
  constructor() {
    super(LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_MESSAGE)
    this.name = 'LegacyRedraftWaiverClaimsRetiredError'
  }
}

export function currentWaiverClaimsPath(leagueId: string | null | undefined): string | null {
  const id = String(leagueId ?? '').trim()
  return id ? `/api/waiver-wire/leagues/${encodeURIComponent(id)}/claims` : null
}

/** 410 Gone: the endpoint exists, it just no longer takes claims, and says where they go now. */
export function legacyRedraftWaiverClaimsRetiredResponse(leagueId?: string | null) {
  return NextResponse.json(
    {
      error: LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_MESSAGE,
      code: LEGACY_REDRAFT_WAIVER_CLAIMS_RETIRED_CODE,
      useInstead: currentWaiverClaimsPath(leagueId),
    },
    { status: 410 },
  )
}
