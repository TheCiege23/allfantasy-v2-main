/**
 * Per-player weekly scores for an imported league, from the platform's own numbers.
 *
 * 🛑 THE TABLE EXISTED AND NOTHING FILLED IT. `WeeklyScore` models exactly this
 * — league, season, week, roster, player, points, starter flag — and its only
 * writer is `server/services/weeklyProcessor.ts`, whose bulk entry point
 * `processAllActiveLeaguesForWeek` has no caller anywhere in the repo. So for an
 * imported league the table is simply empty, and any screen built on it renders
 * a blank that looks authoritative.
 *
 * 🛑 AND THE EXISTING WRITER MUST NOT BE POINTED AT THESE LEAGUES. It re-scores
 * players with AllFantasy's resolved rules and pairs opponents with
 * `buildRoundRobinPairsForWeek`, which invents a synthetic round-robin rather
 * than reading the real schedule. Run on a Sleeper league it would write
 * fabricated opponents and win/loss records that other surfaces read as real.
 *
 * So this ingests what the PLATFORM published: Sleeper's `players_points` is
 * scored under the league's own settings — PPR, TE premium, 6-point passing
 * touchdowns, first-down points — which is what the managers actually saw. We
 * are copying a number, not recomputing one.
 *
 * ⚠ INGESTION, WHICH IS THE ONE LAYER PERMITTED TO CALL A PROVIDER. Request
 * paths must read what this writes, never the vendor.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

const SLEEPER_BASE = 'https://api.sleeper.app/v1'

/** One team's week as Sleeper publishes it. */
export type SleeperMatchupRow = {
  roster_id?: number | string
  points?: number
  /**
   * Player id → points, scored under the league's own settings.
   *
   * ⚠ TYPED AS UNTRUSTED, NOT AS `number`. This is JSON off a provider: the
   * value can be absent, null, or a string, and declaring it `number` makes the
   * compiler agree that the null check below is dead code — which is how the
   * null-stored-as-zero bug got written in the first place.
   */
  players_points?: Record<string, number | string | null | undefined> | null
  /** Starting lineup; padded with "0" for empty slots. */
  starters?: Array<string | null> | null
  players?: Array<string | null> | null
}

export type MappedScore = {
  rosterId: string
  playerId: string
  points: number
  isStarter: boolean
}

/**
 * Turn Sleeper's payload into rows, given a roster-id → `Roster.id` map.
 *
 * Pure so the mapping can be asserted without a network or a database — this is
 * where a silent mistake would land in a table other people trust.
 */
export function mapMatchupsToWeeklyScores(
  matchups: SleeperMatchupRow[],
  rosterIdByExternalId: Map<string, string>,
): { rows: MappedScore[]; unmappedRosterIds: string[] } {
  const rows: MappedScore[] = []
  const unmapped: string[] = []

  for (const m of matchups ?? []) {
    const externalId = m?.roster_id != null ? String(m.roster_id) : ''
    if (!externalId) continue
    const rosterId = rosterIdByExternalId.get(externalId)
    if (!rosterId) {
      /* ⚠ Reported rather than dropped. A roster we cannot map is a team whose
         week silently would not exist, and "no scores this week" is the same
         shape as "this manager scored nothing". */
      unmapped.push(externalId)
      continue
    }

    /*
     * ⚠ SLEEPER PADS EMPTY LINEUP SLOTS WITH "0". Treating those as a started
     * player invents a starter, and the starter flag is what a "best lineup" or
     * "player of the week" read filters on.
     */
    const starters = new Set(
      (m.starters ?? [])
        .filter((p): p is string => typeof p === 'string' && p !== '0' && p !== '')
        .map(String),
    )

    const points = m.players_points ?? {}
    for (const [playerId, value] of Object.entries(points)) {
      if (!playerId || playerId === '0') continue
      /*
       * ⚠ A MISSING SCORE IS NOT ZERO. Sleeper omits players it has no line for;
       * writing them as 0.00 makes an unplayed or unlisted player
       * indistinguishable from one who genuinely scored nothing, and a "worst
       * performance" read would then rank people who never took the field.
       *
       * 🛑 `Number(null)` IS `0`, AND `0` IS FINITE. A bare `Number.isFinite`
       * guard therefore lets every null through as a real zero — which is the
       * exact bug this comment is about, written and then caught by its own test.
       * The absent cases are rejected before the coercion, not after it.
       */
      if (value === null || value === undefined || value === '') continue
      const num = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(num)) continue
      rows.push({
        rosterId,
        playerId,
        points: num,
        isStarter: starters.has(playerId),
      })
    }
  }

  return { rows, unmappedRosterIds: unmapped }
}


/**
 * `LeagueTeam.externalId` → `Roster.id`, keyed on BOTH id spaces.
 *
 * 🛑 `Roster.platformUserId` CARRIES TWO DIFFERENT KINDS OF ID, AND THE JOIN
 * FAILS ON EXACTLY ONE TEAM. For a manager we imported it holds the PLATFORM
 * user id, matching `LeagueTeam.platformUserId`. For the team the VIEWER has
 * claimed it holds the AllFantasy `AppUser.id` instead — so a platform-id-only
 * join resolves every roster in the league except the commissioner's own, and
 * reports theirs as unmapped. It presents as "no scores for this manager", which
 * reads as broken ingestion rather than a missed key.
 *
 * Measured by another session on production: 12 teams, 11 keys matched, and the
 * one that did not was the viewer's — whose roster held 50 players.
 */
export function buildRosterIndex(
  teams: Array<{ externalId: string; platformUserId: string | null; claimedByUserId: string | null }>,
  rosters: Array<{ id: string; platformUserId: string }>,
): Map<string, string> {
  const rosterIdByAnyKey = new Map(rosters.map((r) => [r.platformUserId, r.id]))
  const out = new Map<string, string>()
  for (const t of teams) {
    /* Platform id first — it is the common case and the unambiguous one. */
    const rid =
      (t.platformUserId ? rosterIdByAnyKey.get(t.platformUserId) : undefined) ??
      (t.claimedByUserId ? rosterIdByAnyKey.get(t.claimedByUserId) : undefined)
    if (rid) out.set(t.externalId, rid)
  }
  return out
}

export type IngestOutcome = {
  leagueId: string
  week: number
  season: number
  written: number
  unmappedRosterIds: string[]
  skippedReason?: string
}

/**
 * Ingest one league's week.
 *
 * Returns a `skippedReason` rather than throwing for the ordinary "this is not a
 * Sleeper league" and "this league has no source id" cases — a sweep over twenty
 * leagues must not stop at the first one it cannot read.
 */
export async function ingestLeagueWeeklyPlayerScores(args: {
  leagueId: string
  season: number
  week: number
  /** Injectable for tests; defaults to the real endpoint. */
  fetchMatchups?: (platformLeagueId: string, week: number) => Promise<SleeperMatchupRow[]>
}): Promise<IngestOutcome> {
  const { leagueId, season, week } = args
  const base: IngestOutcome = { leagueId, season, week, written: 0, unmappedRosterIds: [] }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) return { ...base, skippedReason: 'league not found' }
  if (String(league.platform ?? '').toLowerCase() !== 'sleeper') {
    return { ...base, skippedReason: `platform ${league.platform} not supported yet` }
  }
  if (!league.platformLeagueId) {
    return { ...base, skippedReason: 'no source league id on file' }
  }

  const fetcher =
    args.fetchMatchups ??
    (async (id: string, wk: number) => {
      const res = await fetch(`${SLEEPER_BASE}/league/${encodeURIComponent(id)}/matchups/${wk}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Sleeper matchups ${res.status}`)
      return (await res.json()) as SleeperMatchupRow[]
    })

  const matchups = await fetcher(league.platformLeagueId, week)
  if (!Array.isArray(matchups) || matchups.length === 0) {
    /* Before a week is played Sleeper answers with an empty array. That is a
       normal state for an early-season sweep, not a failure. */
    return { ...base, skippedReason: 'no matchups published for that week yet' }
  }

  /* roster_id lives on `LeagueTeam.externalId`; `Roster` is keyed by the
     platform USER id, so the hop between them goes through the team row. */
  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, platformUserId: true, claimedByUserId: true },
    }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])

  const rosterIdByExternalId = buildRosterIndex(teams, rosters)

  const { rows, unmappedRosterIds } = mapMatchupsToWeeklyScores(matchups, rosterIdByExternalId)
  if (rows.length === 0) {
    return { ...base, unmappedRosterIds, skippedReason: 'no per-player points in the payload' }
  }

  const rosterIds = [...new Set(rows.map((r) => r.rosterId))]

  /*
   * ⚠ DELETE IS SCOPED TO THE ROSTERS THIS INGEST WRITES, not to the whole
   * league-week. `weeklyProcessor` clears `(leagueId, season, week)` wholesale,
   * and two writers each wiping the other's rows would leave whichever ran last
   * looking like the only source. Scoping keeps this idempotent without
   * reaching outside what it owns.
   */
  await prisma.$transaction([
    prisma.weeklyScore.deleteMany({
      where: { leagueId, season, week, rosterId: { in: rosterIds } },
    }),
    prisma.weeklyScore.createMany({
      data: rows.map((r) => ({
        leagueId,
        season,
        week,
        rosterId: r.rosterId,
        playerId: r.playerId,
        points: r.points,
        isStarter: r.isStarter,
      })),
      skipDuplicates: true,
    }),
  ])

  return { ...base, written: rows.length, unmappedRosterIds }
}
