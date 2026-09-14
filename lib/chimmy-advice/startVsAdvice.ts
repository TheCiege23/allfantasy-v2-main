import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAdvice } from '@/lib/chimmy-advice/adviceStore'
import { asIds, isResolvableId, rosterCandidates } from '@/lib/core-app/dash3aPanels'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * Record the start/sit comparison's call as Chimmy advice, so the home Receipts card can later
 * say how it turned out (retention item 6, user decisions 2026-09-14).
 *
 * Called fire-and-forget from `POST /api/leagues/[leagueId]/player-comparison/start-vs`; it
 * never changes that response. Every refusal returns a reason instead of throwing, so a test can
 * see WHY nothing was recorded.
 *
 * 🛑 THE COMPARISON KNOWS NAMES, NOT IDS. The engine resolves `playerA` / `playerB` by name and
 * returns no id. Names are matched against YOUR ROSTER in this league only — the two players a
 * start/sit is between — never against the global player table, where 178 NFL name groups have
 * more than one row. A name that matches zero or two of your players records nothing.
 *
 * ⚠ ADVICE FOR A WEEK, OR NOTHING. The week is the label the user sent ("Week 7", "wk 7"), else
 * the league's current week (earliest unplayed). A week already behind the current one is not
 * advice — the games are over — and is not recorded. Ties are not advice either.
 *
 * Sleeper leagues only for now: receipts resolve from `league_player_weekly_scores`, which only
 * the Sleeper sync writes, so advice anywhere else could never get a receipt.
 */

export type StartVsAdviceOutcome =
  | 'recorded'
  | 'unavailable'
  | 'invalid'
  | 'tie'
  | 'not_sleeper'
  | 'no_team'
  | 'unresolved'
  | 'no_week'
  | 'past_week'

/** "Week 7", "wk 7", "WK. 12" → the week; anything else → null. */
export function parseWeekLabel(raw: string | null | undefined): number | null {
  const m = String(raw ?? '').match(/\b(?:week|wk)\.?\s*(\d{1,2})\b/i)
  if (!m) return null
  const w = Number(m[1])
  return w >= 1 && w <= 25 ? w : null
}

export async function recordStartVsAdvice(args: {
  userId: string
  leagueId: string
  winner: 'playerA' | 'playerB' | 'tie'
  confidencePct: number | null
  playerAName: string
  playerBName: string
  lineupSlot: string | null
  weekOrPeriod: string | null
}): Promise<StartVsAdviceOutcome> {
  if (args.winner !== 'playerA' && args.winner !== 'playerB') return 'tie'

  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { id: true, platform: true, platformLeagueId: true, sport: true, season: true },
  })
  if (!league || String(league.platform ?? '').toLowerCase() !== 'sleeper' || !league.platformLeagueId) {
    return 'not_sleeper'
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: league.id, claimedByUserId: args.userId },
    select: { externalId: true, platformUserId: true },
  })
  if (teams.length !== 1) return 'no_team'
  const roster = await prisma.roster.findFirst({
    where: { leagueId: league.id, platformUserId: { in: rosterCandidates(teams[0]!, args.userId) } },
    select: { playerData: true },
  })
  if (!roster) return 'no_team'

  const pd = (roster.playerData ?? {}) as Record<string, unknown>
  const ids = [...new Set([...asIds(pd.players), ...asIds(pd.starters), ...asIds(pd.reserve), ...asIds(pd.taxi)])].filter(
    isResolvableId,
  )
  const identities = composePlayerIdentities(
    ids.length
      ? await prisma.sportsPlayer.findMany({
          where: { sleeperId: { in: ids } },
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
        })
      : [],
  )
  const onRoster = (name: string): { key: string; name: string } | null => {
    const want = normalizePlayerName(name)
    if (!want) return null
    const hits = ids.filter((id) => {
      const who = identities.get(id)
      return who?.name ? normalizePlayerName(who.name) === want : false
    })
    return hits.length === 1 ? { key: hits[0]!, name: identities.get(hits[0]!)!.name! } : null
  }
  const a = onRoster(args.playerAName)
  const b = onRoster(args.playerBName)
  if (!a || !b || a.key === b.key) return 'unresolved'

  const current = await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null)
  const labelled = parseWeekLabel(args.weekOrPeriod)
  const week = labelled ?? current?.week ?? null
  if (week == null) return 'no_week'
  if (current && labelled != null && labelled < current.week) return 'past_week'

  const [rec, alt] = args.winner === 'playerA' ? [a, b] : [b, a]
  return recordAdvice({
    userId: args.userId,
    leagueId: league.id,
    sport: String(league.sport ?? 'NFL'),
    season: current?.seasonYear ?? Number(league.season),
    week,
    adviceType: 'start_sit',
    surface: 'start_vs_comparison',
    rec,
    alt,
    slot: args.lineupSlot,
    confidencePct: args.confidencePct,
  })
}
