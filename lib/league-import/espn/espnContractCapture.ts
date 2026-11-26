import {
  buildEspnCookieHeader,
  EspnApiResponseError,
  EspnFormatChangedError,
  EspnUnavailableError,
  fetchEspnLeagueJson,
} from '@/lib/league-import/espn/espnFantasyClient'
import { getDecryptedAuth } from '@/lib/league-sync-core'

/**
 * Owner-only ESPN contract capture (admin tool, 2026-11-25) — the ESPN half of
 * `lib/admin/contractCapture/`. Reads ONE league with the requesting owner's OWN stored ESPN cookies
 * and returns the raw bodies for the caller to redact. Nothing is stored and nothing is logged.
 *
 * It goes through `fetchEspnLeagueJson`, the single ESPN fantasy adapter, so this file builds no URL
 * and names no host. The request set is closed: two view lists, nothing taken from a caller.
 *
 *   league_teams_transactions       views `mTeam` + `mTransactions2` — both already named in
 *                                   contracts/espn/ENDPOINTS.yaml `fantasy_nfl.query`.
 *   pending_transactions_candidate  view `mPendingTransactions` — a CANDIDATE, not a known view.
 *                                   Its status is recorded as returned; ESPN may simply ignore an
 *                                   unknown view and answer 200 with the base league object, so a
 *                                   200 here is not evidence the view exists. Read the body.
 *
 * Cookies travel only as the adapter's `Cookie` header; they are never put in a URL, the result,
 * or a log line. `credentialValues` exists so the redactor can prove they are absent.
 */

export const ESPN_CONTRACT_CAPTURE_REQUESTS = [
  { resource: 'league_teams_transactions', views: ['mTeam', 'mTransactions2'], candidate: false },
  { resource: 'pending_transactions_candidate', views: ['mPendingTransactions'], candidate: true },
] as const

export type EspnContractCaptureResource = (typeof ESPN_CONTRACT_CAPTURE_REQUESTS)[number]['resource']

export type EspnContractCaptureResult = {
  resource: EspnContractCaptureResource
  views: readonly string[]
  candidate: boolean
  /** 0 when ESPN could not be reached at all; 200 with `body: null` when the body was not JSON. */
  httpStatus: number
  body: unknown | null
}

export class EspnContractCaptureConnectionError extends Error {}

export async function runEspnContractCapture(
  userId: string,
  leagueId: string,
  season: number,
): Promise<{ results: EspnContractCaptureResult[]; credentialValues: string[] }> {
  const auth = await getDecryptedAuth(userId, 'espn')
  const swid = auth?.espnSwid?.trim() || null
  const espnS2 = auth?.espnS2?.trim() || null
  const cookieHeader = buildEspnCookieHeader({ swid, espnS2 })
  if (!cookieHeader) {
    throw new EspnContractCaptureConnectionError(
      'Connect ESPN (both SWID and espn_s2) in League Sync first — pending offers are only visible with your cookies.',
    )
  }
  const digits = String(leagueId).replace(/\D/g, '')
  if (!digits || !Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new EspnContractCaptureConnectionError('This league has no usable ESPN league id or season on file.')
  }

  const results: EspnContractCaptureResult[] = []
  for (const request of ESPN_CONTRACT_CAPTURE_REQUESTS) {
    let httpStatus = 200
    let body: unknown | null = null
    try {
      body = await fetchEspnLeagueJson(
        { game: 'ffl', season, leagueId: digits, views: request.views },
        { cookieHeader, cacheTtlMs: 0, retries: 2 },
      )
    } catch (error) {
      if (error instanceof EspnApiResponseError) httpStatus = error.status
      else if (error instanceof EspnUnavailableError) httpStatus = error.lastStatus ?? 0
      else if (error instanceof EspnFormatChangedError) httpStatus = 200
      else throw error
      body = null
    }
    results.push({ resource: request.resource, views: request.views, candidate: request.candidate, httpStatus, body })
  }

  return { results, credentialValues: [swid, espnS2, cookieHeader].filter((v): v is string => Boolean(v)) }
}
