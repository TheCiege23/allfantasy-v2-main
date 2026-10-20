import 'server-only'

import { prisma } from '@/lib/prisma'
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { buildLeagueStatScorer, isScoringStarterSlot, leagueIsBestBall, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { loadWeekLineups, weekSlotType, type WeekLineups } from '@/lib/redraft/weekLineupSlots'
import { managerArtUrl } from './leagueArt'
import { realManagerName } from './managerName'
import { guillotineLine, type GuillotineTeamInput } from './railGuillotineLine'
import type { RailMatchup } from './railMatchups'

/**
 * The rail rows of NATIVE leagues — the ones hosted here, which `getRailMatchups`' `WeeklyMatchup`
 * read can never see (only the provider importers write that table).
 *
 *   - a native GUILLOTINE league gets a guillotine score line (`railGuillotineLine.ts`);
 *   - any other native league with a regular-season schedule gets its head-to-head from
 *     `RedraftMatchup`, the row the score sync already keeps current.
 *
 * ── DB-first, and set-based ───────────────────────────────────────────────────────────────
 * Every read below is one query over ALL the native leagues asked about, never one per league:
 * leagues, newest seasons (with rosters), the scorer's settings for the guillotine leagues, the
 * live field's players, their stat rows, their projections, chop state, the legacy-roster links,
 * and this week's head-to-head rows. `loadWeekLineups` runs once per distinct (season, week) —
 * in practice once. No provider is called: the stat rows are `PlayerWeeklyScore`, written by the
 * score sync every five minutes, and the points are the SAME arithmetic the chop uses
 * (`buildLeagueStatScorer` over the week's starters, `weekSlotType` for the saved lineup).
 *
 * ⚠ BEST BALL AND DEVY GUILLOTINE LEAGUES ARE NOT SCORED HERE. Best ball starts the week's optimal
 * lineup and devy has its own engine; both are a different computation from "sum the starters",
 * and drawing a starter sum for them would be a wrong number with a confident face. Best ball
 * draws `points: null` (a dash) and still ranks on projection when it can; devy is not detected
 * here at all, because detecting it is a query per league — recorded rather than hidden.
 */

export type NativeRailMatchups = {
  byLeague: Record<string, RailMatchup>
}

type LeagueRow = {
  id: string
  sport: string | null
  platform: string | null
  leagueVariant: string | null
  leagueType: string | null
  guillotineMode: boolean | null
  bestBallMode: boolean | null
  guillotineConfig: { eliminationStartWeek: number; teamsPerChop: number } | null
  leagueSettings: { draftDateUtc: Date | null } | null
}

type SeasonRow = {
  id: string
  leagueId: string
  season: number
  status: string
  currentWeek: number
  sport: string
  rosters: Array<{
    id: string
    ownerId: string
    ownerName: string
    teamName: string | null
    avatarUrl: string | null
    isEliminated: boolean
  }>
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function isNativeGuillotine(l: Pick<LeagueRow, 'guillotineConfig' | 'leagueVariant' | 'guillotineMode'>): boolean {
  /* `isGuillotineLeague`'s rule (a config row, or the variant), plus the column the war room reads. */
  return l.guillotineConfig != null || String(l.leagueVariant ?? '').toLowerCase() === 'guillotine' || l.guillotineMode === true
}

/** A draft time a commissioner typed into settings, in the shapes the league page already accepts. */
function draftAtFrom(row: LeagueRow, settings: unknown): string | null {
  const fromColumn = row.leagueSettings?.draftDateUtc
  if (fromColumn instanceof Date && Number.isFinite(fromColumn.getTime())) return fromColumn.toISOString()
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
  const raw = s.draftDate ?? s.draft_date ?? s.draft_at ?? s.draft_start_time ?? null
  if (typeof raw === 'string' && raw.trim()) {
    const t = Date.parse(raw)
    return Number.isFinite(t) ? new Date(t).toISOString() : null
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw > 9_999_999_999 ? raw : raw * 1000).toISOString()
  return null
}

const nameOf = (r: { teamName: string | null; ownerName: string | null }) =>
  realManagerName(r.teamName) || realManagerName(r.ownerName) || null

export async function getNativeRailMatchups(userId: string, leagueIds: readonly string[]): Promise<NativeRailMatchups> {
  const ids = [...new Set(leagueIds.filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0 || !userId) return { byLeague: {} }

  const leagues: LeagueRow[] = await prisma.league
    .findMany({
      where: { id: { in: ids }, platform: { in: [...NATIVE_PLATFORM_VALUES] } },
      select: {
        id: true,
        sport: true,
        platform: true,
        leagueVariant: true,
        leagueType: true,
        guillotineMode: true,
        bestBallMode: true,
        guillotineConfig: { select: { eliminationStartWeek: true, teamsPerChop: true } },
        leagueSettings: { select: { draftDateUtc: true } },
      },
    })
    .catch((): LeagueRow[] => [])
  if (leagues.length === 0) return { byLeague: {} }
  const nativeIds = leagues.map((l) => l.id)
  const guillotineIds = leagues.filter(isNativeGuillotine).map((l) => l.id)

  type LinkRow = { id: string; leagueId: string; platformUserId: string; redraftRosterId: string | null }
  type ChopRow = { leagueId: string; rosterId: string; choppedInPeriod: number | null }
  type SettingsRow = { id: string; settings: unknown }
  const [seasonRows, links, chops, settingsRows]: [SeasonRow[], LinkRow[], ChopRow[], SettingsRow[]] = await Promise.all([
    prisma.redraftSeason
      .findMany({
        where: { leagueId: { in: nativeIds } },
        orderBy: { season: 'desc' },
        select: {
          id: true,
          leagueId: true,
          season: true,
          status: true,
          currentWeek: true,
          sport: true,
          rosters: { select: { id: true, ownerId: true, ownerName: true, teamName: true, avatarUrl: true, isEliminated: true } },
        },
      })
      .catch((): SeasonRow[] => []),
    guillotineIds.length
      ? prisma.roster
          .findMany({ where: { leagueId: { in: guillotineIds } }, select: { id: true, leagueId: true, platformUserId: true, redraftRosterId: true } })
          .catch((): LinkRow[] => [])
      : Promise.resolve([] as LinkRow[]),
    guillotineIds.length
      ? prisma.guillotineRosterState
          .findMany({ where: { leagueId: { in: guillotineIds }, choppedAt: { not: null } }, select: { leagueId: true, rosterId: true, choppedInPeriod: true } })
          .catch((): ChopRow[] => [])
      : Promise.resolve([] as ChopRow[]),
    /* `settings` whole, but only for the guillotine leagues: it is the scorer's input (the league's
       own scoring rules live there) and where a commissioner's draft time is kept. */
    guillotineIds.length
      ? prisma.league
          .findMany({ where: { id: { in: guillotineIds } }, select: { id: true, settings: true } })
          .catch((): SettingsRow[] => [])
      : Promise.resolve([] as SettingsRow[]),
  ])

  const seasonByLeague = new Map<string, SeasonRow>()
  for (const s of seasonRows) if (!seasonByLeague.has(s.leagueId)) seasonByLeague.set(s.leagueId, s)
  const settingsByLeague = new Map(settingsRows.map((r) => [r.id, r.settings]))
  const byLeague: Record<string, RailMatchup> = {}

  /* ── Guillotine ─────────────────────────────────────────────────────────────────────── */

  /*
   * Chop state is filed in the ENGINE's id space (`Roster.id`), the score in `RedraftRoster.id`. The
   * link is `Roster.redraftRosterId`, else owner (`Roster.platformUserId` = `RedraftRoster.ownerId`) —
   * the same two-step `nativeGuillotineWeek.ts` uses to place a team.
   */
  const choppedWeekByRedraft = new Map<string, number | null>()
  for (const leagueId of guillotineIds) {
    const season = seasonByLeague.get(leagueId)
    if (!season) continue
    const leagueLinks = links.filter((l) => l.leagueId === leagueId)
    for (const c of chops.filter((x) => x.leagueId === leagueId)) {
      const link = leagueLinks.find((l) => l.id === c.rosterId)
      const redraft = link?.redraftRosterId ?? season.rosters.find((r) => link && r.ownerId === link.platformUserId)?.id
      if (redraft) choppedWeekByRedraft.set(redraft, c.choppedInPeriod)
    }
  }

  type Live = { leagueId: string; season: number; week: number; sport: string; aliveIds: string[] }
  const live: Live[] = []
  for (const leagueId of guillotineIds) {
    const season = seasonByLeague.get(leagueId)
    if (!season || season.currentWeek < 1) continue
    const alive = season.rosters.filter((r) => !r.isEliminated && !choppedWeekByRedraft.has(r.id))
    live.push({ leagueId, season: season.season, week: season.currentWeek, sport: season.sport, aliveIds: alive.map((r) => r.id) })
  }

  type PlayerRow = { rosterId: string; playerId: string; slotType: string; position: string; sport: string }
  const allAlive = live.flatMap((l) => l.aliveIds)
  const players: PlayerRow[] = allAlive.length
    ? await prisma.redraftRosterPlayer
        .findMany({ where: { rosterId: { in: allAlive }, droppedAt: null }, select: { rosterId: true, playerId: true, slotType: true, position: true, sport: true } })
        .catch((): PlayerRow[] => [])
    : []

  /* One lineup read per distinct (season, week) — the leagues share a calendar, so usually one. */
  const groups = new Map<string, { season: number; week: number; sport: string; rosterIds: string[] }>()
  for (const l of live) {
    const key = `${l.season}:${l.week}:${l.sport}`
    const g = groups.get(key) ?? { season: l.season, week: l.week, sport: l.sport, rosterIds: [] }
    g.rosterIds.push(...l.aliveIds)
    groups.set(key, g)
  }
  const lineupsByGroup = new Map<string, WeekLineups>()
  await Promise.all(
    [...groups].map(async ([key, g]) => {
      const lineups = await loadWeekLineups(prisma, { redraftRosterIds: g.rosterIds, season: g.season, week: g.week }).catch(
        (): WeekLineups => new Map(),
      )
      lineupsByGroup.set(key, lineups)
    }),
  )

  const groupKeyByRoster = new Map<string, string>()
  for (const l of live) for (const id of l.aliveIds) groupKeyByRoster.set(id, `${l.season}:${l.week}:${l.sport}`)
  const starters = players.filter((p) => isScoringStarterSlot(weekSlotType(p, lineupsByGroup.get(groupKeyByRoster.get(p.rosterId) ?? '') ?? new Map())))

  type StatRow = { playerId: string; sport: string; season: number; week: number; stats: unknown; updatedAt: Date }
  type ProjRow = { playerId: string; sport: string; season: string; week: number; projectedPoints: number }
  const statOr = [...groups.values()].flatMap((g) => {
    const playerIds = [...new Set(starters.filter((p) => g.rosterIds.includes(p.rosterId)).map((p) => p.playerId))]
    return playerIds.length ? [{ season: g.season, week: g.week, playerIds, sport: g.sport }] : []
  })
  const [statRows, projRows]: [StatRow[], ProjRow[]] = statOr.length
    ? await Promise.all([
        prisma.playerWeeklyScore
          .findMany({
            where: { OR: statOr.map((g) => ({ season: g.season, week: g.week, playerId: { in: g.playerIds } })) },
            select: { playerId: true, sport: true, season: true, week: true, stats: true, updatedAt: true },
          })
          .catch((): StatRow[] => []),
        prisma.fantasyProjection
          .findMany({
            where: {
              source: { not: 'allfantasy' },
              /* Sport-scoped: Sleeper's NBA and NFL ids are both short numbers and can collide. */
              OR: statOr.map((g) => ({
                sport: { in: [...new Set([g.sport.toUpperCase(), g.sport.toLowerCase(), g.sport])] },
                season: String(g.season),
                week: g.week,
                playerId: { in: g.playerIds },
              })),
            },
            select: { playerId: true, sport: true, season: true, week: true, projectedPoints: true },
          })
          .catch((): ProjRow[] => []),
      ])
    : [[], []]
  const statByKey = new Map(statRows.map((r) => [`${r.playerId}|${String(r.sport).toUpperCase()}|${r.season}|${r.week}`, r]))
  /* First row per player-week: several scoring presets can sit side by side; the rail shows one baseline. */
  const projByKey = new Map<string, number>()
  for (const r of projRows) {
    const key = `${r.playerId}|${r.season}|${r.week}`
    if (!projByKey.has(key) && Number.isFinite(r.projectedPoints)) projByKey.set(key, r.projectedPoints)
  }

  for (const l of live) {
    const league = leagues.find((x) => x.id === l.leagueId)!
    const season = seasonByLeague.get(l.leagueId)!
    const me = season.rosters.find((r) => r.ownerId === userId)
    if (!me) continue
    const settings = settingsByLeague.get(l.leagueId) ?? null
    const bestBall = leagueIsBestBall(league)
    const scorer = bestBall ? null : buildLeagueStatScorer({ sport: String(league.sport ?? season.sport), settings })

    let freshest = 0
    const teams: GuillotineTeamInput[] = l.aliveIds.map((rosterId) => {
      const lineup = starters.filter((p) => p.rosterId === rosterId)
      let points = 0
      let hasRow = false
      let projected = 0
      let pricedFrom = 0
      for (const p of lineup) {
        const row = statByKey.get(`${p.playerId}|${String(p.sport).toUpperCase()}|${l.season}|${l.week}`)
        if (row && scorer) {
          hasRow = true
          points += scorer(row.stats as Record<string, number>, p.position)
          freshest = Math.max(freshest, row.updatedAt?.getTime?.() ?? 0)
        }
        const proj = projByKey.get(`${p.playerId}|${l.season}|${l.week}`)
        if (proj != null) {
          projected += proj
          pricedFrom += 1
        }
      }
      return {
        rosterId,
        points: hasRow ? round2(points) : null,
        projected: pricedFrom > 0 ? round2(projected) : null,
        pricedFrom,
        starterCount: lineup.length,
      }
    })

    /*
     * A daily-lineup league's week is Σ days of that day's starters, which the sum of this week's
     * starters above cannot express (a player benched on Wednesday still has a whole-week row). Its
     * line comes from the matchup scorer itself — one call per surviving team, daily leagues only.
     */
    if (!bestBall && isDailyLineupScoringEnabled(settings, String(league.sport ?? season.sport))) {
      for (const t of teams) {
        const r = await scoreRosterForWeek({ leagueId: l.leagueId, rosterId: t.rosterId, week: l.week, seasonYear: l.season }).catch(() => null)
        t.points = r && r.scoredStarterCount > 0 ? r.points : null
      }
    }

    const eliminated = me.isEliminated || choppedWeekByRedraft.has(me.id)
    const mine = teams.find((t) => t.rosterId === me.id) ?? { rosterId: me.id, points: null, projected: null, pricedFrom: 0, starterCount: 0 }
    const { line, standing } = guillotineLine({
      week: l.week,
      firstChopWeek: league.guillotineConfig?.eliminationStartWeek ?? null,
      teamsPerChop: league.guillotineConfig?.teamsPerChop ?? 1,
      me: { ...mine, eliminated, choppedWeek: choppedWeekByRedraft.get(me.id) ?? null },
      field: teams,
    })
    byLeague[l.leagueId] = {
      leagueId: l.leagueId,
      yourTeam: nameOf(me),
      yourAvatarUrl: managerArtUrl({ avatarUrl: me.avatarUrl, platform: league.platform }),
      yourScore: eliminated ? 0 : (mine.points ?? 0),
      yourProjection:
        !eliminated && mine.projected != null
          ? { projected: mine.projected, afProjected: null, afEngine: null, afEngineFrom: 0, pricedFrom: mine.pricedFrom ?? 0, starterCount: mine.starterCount ?? 0 }
          : null,
      opponentTeam: null,
      opponentAvatarUrl: null,
      opponentScore: 0,
      opponentProjection: null,
      unpaired: true,
      standing,
      eliminated,
      scored: !eliminated && teams.some((t) => (t.points ?? 0) !== 0),
      freshAt: freshest > 0 ? new Date(freshest).toISOString() : null,
      source: 'live_cache',
      season: l.season,
      week: l.week,
      guillotine: line,
      native: true,
    }
  }

  /* A guillotine league with no season yet (pre-draft), or one not started: say when it starts. */
  for (const leagueId of guillotineIds) {
    if (byLeague[leagueId]) continue
    const season = seasonByLeague.get(leagueId)
    const league = leagues.find((x) => x.id === leagueId)!
    const me = season?.rosters.find((r) => r.ownerId === userId) ?? null
    const member = me != null || links.some((l) => l.leagueId === leagueId && l.platformUserId === userId)
    if (!member) continue
    const { line } = guillotineLine({
      week: null,
      firstChopWeek: league.guillotineConfig?.eliminationStartWeek ?? null,
      teamsPerChop: league.guillotineConfig?.teamsPerChop ?? 1,
      draftAt: season ? null : draftAtFrom(league, settingsByLeague.get(leagueId)),
      me: { rosterId: me?.id ?? '', points: null, projected: null, eliminated: false, choppedWeek: null },
      field: [],
    })
    byLeague[leagueId] = {
      leagueId,
      yourTeam: me ? nameOf(me) : null,
      yourAvatarUrl: me ? managerArtUrl({ avatarUrl: me.avatarUrl, platform: league.platform }) : null,
      yourScore: 0,
      yourProjection: null,
      opponentTeam: null,
      opponentAvatarUrl: null,
      opponentScore: 0,
      opponentProjection: null,
      unpaired: true,
      standing: null,
      eliminated: false,
      scored: false,
      freshAt: null,
      source: 'live_cache',
      season: season?.season ?? 0,
      week: 0,
      guillotine: line,
      native: true,
    }
  }

  /* ── Native head-to-head ───────────────────────────────────────────────────────────── */

  type H2HRow = {
    seasonId: string
    leagueId: string
    week: number
    homeRosterId: string
    awayRosterId: string | null
    homeScore: number
    awayScore: number
    status: string
  }
  const h2hSeasons = nativeIds
    .filter((id) => !guillotineIds.includes(id))
    .map((id) => seasonByLeague.get(id))
    .filter((s): s is SeasonRow => s != null && s.currentWeek >= 1 && s.rosters.some((r) => r.ownerId === userId))
  const myRosterIds = h2hSeasons.flatMap((s) => s.rosters.filter((r) => r.ownerId === userId).map((r) => r.id))
  const h2hRows: H2HRow[] = h2hSeasons.length
    ? await prisma.redraftMatchup
        .findMany({
          where: {
            OR: h2hSeasons.map((s) => ({ seasonId: s.id, week: s.currentWeek })),
            AND: [{ OR: [{ homeRosterId: { in: myRosterIds } }, { awayRosterId: { in: myRosterIds } }] }],
          },
          select: { seasonId: true, leagueId: true, week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
        })
        .catch((): H2HRow[] => [])
    : []
  for (const row of h2hRows) {
    const season = h2hSeasons.find((s) => s.id === row.seasonId)
    const league = leagues.find((l) => l.id === row.leagueId)
    if (!season || !league || byLeague[row.leagueId]) continue
    const mineHome = myRosterIds.includes(row.homeRosterId)
    const me = season.rosters.find((r) => r.id === (mineHome ? row.homeRosterId : row.awayRosterId))
    const them = season.rosters.find((r) => r.id === (mineHome ? row.awayRosterId : row.homeRosterId)) ?? null
    if (!me) continue
    const yourScore = mineHome ? row.homeScore : row.awayScore
    const opponentScore = mineHome ? row.awayScore : row.homeScore
    byLeague[row.leagueId] = {
      leagueId: row.leagueId,
      yourTeam: nameOf(me),
      yourAvatarUrl: managerArtUrl({ avatarUrl: me.avatarUrl, platform: league.platform }),
      yourScore,
      /* `RedraftMatchup.homeProjected` is rarely written and carries no starter count; the rail's
         projection columns stay a dash rather than mislabel it. */
      yourProjection: null,
      opponentTeam: them ? nameOf(them) : null,
      opponentAvatarUrl: them ? managerArtUrl({ avatarUrl: them.avatarUrl, platform: league.platform }) : null,
      opponentScore,
      opponentProjection: null,
      unpaired: them == null,
      standing: null,
      scored: row.status !== 'scheduled' || yourScore !== 0 || opponentScore !== 0,
      /* RedraftMatchup carries no write stamp, so the row honestly says "sync age unknown". */
      freshAt: null,
      source: 'live_cache',
      season: season.season,
      week: row.week,
      native: true,
    }
  }

  return { byLeague }
}
