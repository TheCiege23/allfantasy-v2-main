import { prisma } from '@/lib/prisma'
import {
  runYahooContractCapture,
  YahooContractCaptureRequestError,
  YahooImportConnectionError,
  YahooImportLeagueNotFoundError,
  type YahooContractCaptureResult,
} from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import {
  EspnContractCaptureConnectionError,
  runEspnContractCapture,
} from '@/lib/league-import/espn/espnContractCapture'
import { buildRedactedCaptureDocument, type CaptureRequestInput } from '@/lib/admin/contractCapture/redactContractCapture'

/**
 * Owner-only contract capture (owner decision 2026-11-25). The owner connects Yahoo/ESPN as a normal
 * user, picks one of HIS OWN leagues on the admin page, and downloads ONE redacted JSON capture made
 * here with the credential the app already stores for him. Its purpose is to fill
 * `contracts/yahoo/` and `contracts/espn/` with real shapes without anyone probing by hand.
 *
 * What this module guarantees, and the tests pin each one:
 *   - the credential read is the REQUESTER's (`userId` comes from the session, never from the body);
 *   - the league must be one the requester imported or holds a claimed team in;
 *   - the request set is fixed per provider (see the two provider modules) — no URL, path, view or
 *     key is taken from the caller; only an AllFantasy league id and a week number are;
 *   - nothing is written to the database, and the only log line is counts and HTTP statuses;
 *   - the body returned is redacted and verified, or there is no body (see redactContractCapture).
 *
 * This is a deliberate provider call from an admin request path. It adds no host literal: both
 * provider modules go through the existing single adapters (`YAHOO_API_BASE`, `fetchEspnLeagueJson`).
 */

export const CAPTURE_PROVIDERS = ['yahoo', 'espn'] as const
export type ContractCaptureProvider = (typeof CAPTURE_PROVIDERS)[number]

export class ContractCaptureInputError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = 'ContractCaptureInputError'
  }
}

export type CaptureLeagueOption = {
  id: string
  provider: ContractCaptureProvider
  name: string
  season: number
}

function ownLeagueWhere(userId: string) {
  return {
    platform: { in: [...CAPTURE_PROVIDERS] },
    sport: 'NFL' as const,
    OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
  }
}

/** The requester's own Yahoo/ESPN NFL leagues — the only ones the picker offers or a capture accepts. */
export async function listOwnCaptureLeagues(userId: string): Promise<CaptureLeagueOption[]> {
  const rows = await (prisma as any).league.findMany({
    where: ownLeagueWhere(userId),
    select: { id: true, platform: true, name: true, season: true },
    orderBy: [{ season: 'desc' }],
    take: 100,
  })
  return (rows as Array<{ id: string; platform: string; name: string | null; season: number }>).map((r) => ({
    id: r.id,
    provider: r.platform as ContractCaptureProvider,
    name: r.name?.trim() || `${r.platform} league`,
    season: r.season,
  }))
}

const YAHOO_REQUEST_TEMPLATES: Record<YahooContractCaptureResult['resource'], (week: number) => string> = {
  league_teams: () => 'league/{league_key}/teams',
  team_roster_week_stats: (w) => `team/{owner_team_key}/roster;week=${w}/players/stats;type=week;week=${w}`,
  league_scoreboard_week: (w) => `league/{league_key}/scoreboard;week=${w}`,
  pending_trades_for_team: () => 'league/{league_key}/transactions;types=pending_trade;team_key={owner_team_key}',
}

export function parseCaptureWeek(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,2}$/.test(value.trim()) ? Number(value) : NaN
  if (!Number.isInteger(n) || n < 1 || n > 18) throw new ContractCaptureInputError(400, 'Week must be a whole number from 1 to 18.')
  return n
}

export async function runContractCapture(args: {
  userId: string
  leagueId: unknown
  week: unknown
  now?: Date
}): Promise<{ filename: string; json: string; summary: Record<string, number> }> {
  const leagueId = typeof args.leagueId === 'string' ? args.leagueId.trim() : ''
  if (!leagueId || leagueId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(leagueId)) {
    throw new ContractCaptureInputError(400, 'Pick one of your leagues.')
  }
  const week = parseCaptureWeek(args.week)

  const league = (await (prisma as any).league.findFirst({
    where: { id: leagueId, ...ownLeagueWhere(args.userId) },
    select: { id: true, platform: true, platformLeagueId: true, season: true },
  })) as { id: string; platform: string; platformLeagueId: string; season: number } | null
  if (!league) throw new ContractCaptureInputError(404, 'That is not one of your Yahoo or ESPN NFL leagues.')

  const capturedAt = (args.now ?? new Date()).toISOString()
  let requests: CaptureRequestInput[]
  let leagueIdentifiers: string[]
  let ownerTeamKey: string | null = null
  let credentialValues: string[]
  const notes: string[] = []

  if (league.platform === 'yahoo') {
    if (week == null) throw new ContractCaptureInputError(400, 'Yahoo needs a finished week number.')
    let run: Awaited<ReturnType<typeof runYahooContractCapture>>
    try {
      run = await runYahooContractCapture(args.userId, league.platformLeagueId, week)
    } catch (error) {
      if (error instanceof YahooImportConnectionError) throw new ContractCaptureInputError(409, 'Connect Yahoo in League Sync first.')
      if (error instanceof YahooImportLeagueNotFoundError || error instanceof YahooContractCaptureRequestError) {
        throw new ContractCaptureInputError(404, 'Your connected Yahoo account does not list this league.')
      }
      throw error
    }
    ownerTeamKey = run.ownerTeamKey
    credentialValues = run.credentialValues
    // The stored id can be a bare id, a key or a pasted URL; only the first two are identifiers to scrub.
    leagueIdentifiers = [run.leagueKey, ...(/^\d+(\.l\.\d+)?$/.test(league.platformLeagueId.trim()) ? [league.platformLeagueId.trim()] : [])]
    if (!run.ownerTeamKey) notes.push('Yahoo marked no team in this league as owned by the signed-in account, so the roster and pending-trade requests were not sent.')
    notes.push('pending_trades_for_team is filtered by Yahoo to the owner\'s team (team_key=). Owner rule: AllFantasy keeps and shows only offers the signed-in user sent or received.')
    requests = run.results.map((r) => ({
      resource: r.resource,
      requestTemplate: YAHOO_REQUEST_TEMPLATES[r.resource](week),
      httpStatus: r.httpStatus,
      body: r.body,
    }))
  } else {
    let run: Awaited<ReturnType<typeof runEspnContractCapture>>
    try {
      run = await runEspnContractCapture(args.userId, league.platformLeagueId, league.season)
    } catch (error) {
      if (error instanceof EspnContractCaptureConnectionError) throw new ContractCaptureInputError(409, error.message)
      throw error
    }
    credentialValues = run.credentialValues
    leagueIdentifiers = [league.platformLeagueId]
    notes.push('mPendingTransactions is a CANDIDATE view. ESPN may ignore an unknown view and still answer 200, so read the body before concluding the view exists.')
    notes.push('Owner rule: AllFantasy keeps and shows only offers the signed-in user sent or received. If this body holds offers between two OTHER teams, record that in contracts/espn/GAPS.md T-03 before committing it.')
    requests = run.results.map((r) => ({
      resource: r.resource,
      requestTemplate: `seasons/{season}/segments/0/leagues/{league_id}?${r.views.map((v) => `view=${v}`).join('&')}`,
      httpStatus: r.httpStatus,
      body: r.body,
      candidate: r.candidate,
    }))
  }

  const { json, summary } = buildRedactedCaptureDocument({
    provider: league.platform as ContractCaptureProvider,
    capturedAt,
    sport: 'NFL',
    season: league.season ?? null,
    week: league.platform === 'yahoo' ? week : null,
    leagueIdentifiers,
    ownerTeamKey,
    credentialValues,
    requests,
    notes,
  })

  // Counts and statuses only: never a URL, a key, a body or a credential.
  console.info('[contract-capture] %s requests=%d statuses=%s', league.platform, requests.length, requests.map((r) => r.httpStatus).join(','))

  const stamp = capturedAt.slice(0, 10)
  return { filename: `af-contract-capture-${league.platform}-nfl-${stamp}.json`, json, summary }
}
