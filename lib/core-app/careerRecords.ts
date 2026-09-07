import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName } from './leagueHome'

/**
 * Career records — the personal bests and worsts behind `/core/career?view=records`.
 *
 * 2026-09-07 handoff (`AF Core Career Records.dc.html`), which draws ten stat
 * cards. Eight of them are computable from data this repo already holds; the
 * other two are named in `MISSING` below and are absent rather than invented.
 *
 * ── The join, and why it is not `League.id` ─────────────────────────────────
 *
 * ⚠ `WeeklyMatchup.leagueId` IS THE PLATFORM LEAGUE ID, NOT OURS. The table is
 * written by the Sleeper sync and keyed on Sleeper's own ids — its `rosterId`
 * holds Sleeper's numeric roster_id, matching `LeagueTeam.externalId`. Joining
 * on `League.id` returns nothing, silently, which is the shape `weekBoard.ts`
 * carries the same warning about at its head.
 *
 * ── What each record actually means ─────────────────────────────────────────
 *
 * ⚠ A ROW WITH BOTH SCORES AT ZERO IS AN UNPLAYED FIXTURE, NOT A 0-0 GAME. A
 * freshly synced league carries a full season of them, and counting those would
 * report a lowest-ever week of 0.0 for every manager on the product — a record
 * that is both wrong and un-disprovable, because the row really does say zero.
 * `isPlayed` is the gate and every record below runs behind it.
 *
 * ⚠ AND A RECORD WITH NO QUALIFYING ROW IS ABSENT, NOT ZERO. Returning
 * `{ value: 0 }` for "longest win streak" on an account with no completed games
 * says the manager has never won. The map simply has no entry, and the screen
 * renders the card as unmeasured.
 */

export type CareerRecord = {
  key: string
  label: string
  /** Already formatted for display — the unit belongs with the number. */
  value: string
  /** "Dynasty Dragons · week 14, 2022". Never fabricated. */
  context: string
  tone: 'accent' | 'good' | 'bad' | 'warn'
}

export type CareerRecordsData = {
  records: CareerRecord[]
  /** Roster-weeks the records were computed over. The denominator. */
  weeksCounted: number
  /** Leagues those weeks came from. */
  leaguesCounted: number
  /**
   * Records the design asks for that no table can back yet, with the reason.
   * Rendered as named gaps rather than dropped, so a short grid is explained.
   */
  missing: Array<{ label: string; reason: string }>
}

const EMPTY: CareerRecordsData = {
  records: [],
  weeksCounted: 0,
  leaguesCounted: 0,
  missing: [],
}

/**
 * Two of the design's ten cards, and why they are not here.
 *
 * Both are real gaps in what is written, not in what is queryable — recording
 * them here means a later session finds the reason rather than re-deriving it.
 */
const MISSING: Array<{ label: string; reason: string }> = [
  {
    label: 'Most waiver adds in a season',
    reason:
      'waiver claims are stored per league as settings and pending claims, not as a per-manager transaction ledger we can count across seasons',
  },
  {
    label: 'Most leagues rostering one player at once',
    reason:
      'roster snapshots are current-state only — there is no historical roster table to ask "in week 9 of 2024, how many of my teams held him"',
  },
]

/** Either side scoring anything means the fixture was played. */
function isPlayed(r: { pointsFor: number; pointsAgainst: number }): boolean {
  return r.pointsFor > 0 || r.pointsAgainst > 0
}

function fmt(n: number): string {
  return n.toFixed(1)
}

export async function getCareerRecords(userId: string): Promise<CareerRecordsData> {
  const teams = await prisma.leagueTeam
    .findMany({
      where: { claimedByUserId: userId },
      select: {
        externalId: true,
        league: { select: { id: true, name: true, platformLeagueId: true } },
      },
    })
    .catch(() => [])

  /** "platformLeagueId:rosterId" → the league it belongs to. */
  const mine = new Map<string, { leagueId: string; leagueName: string }>()
  const platformIds: string[] = []
  for (const t of teams) {
    const pid = t.league?.platformLeagueId
    if (!pid || !t.externalId) continue
    platformIds.push(pid)
    mine.set(`${pid}:${t.externalId}`, {
      leagueId: t.league!.id,
      leagueName: leagueDisplayName(t.league!.name),
    })
  }

  if (mine.size === 0) return EMPTY

  const rows = await prisma.weeklyMatchup
    .findMany({
      where: { leagueId: { in: [...new Set(platformIds)] } },
      select: {
        leagueId: true,
        rosterId: true,
        seasonYear: true,
        week: true,
        pointsFor: true,
        pointsAgainst: true,
        win: true,
      },
      /*
       * Bounded. A manager with sixty leagues and six seasons is ~10k
       * roster-weeks even after the ownership filter; this ceiling is generous
       * against that and stops one pathological account reading the table dry.
       */
      take: 40_000,
    })
    .catch(() => [])

  const ours = rows
    .filter((r) => mine.has(`${r.leagueId}:${r.rosterId}`))
    .filter(isPlayed)
    .sort(
      (a, b) => a.seasonYear - b.seasonYear || a.week - b.week || a.leagueId.localeCompare(b.leagueId),
    )

  if (ours.length === 0) return { ...EMPTY, missing: MISSING }

  const where = (r: (typeof ours)[number]) => {
    const m = mine.get(`${r.leagueId}:${r.rosterId}`)
    return `${m?.leagueName ?? 'League'} · week ${r.week}, ${r.seasonYear}`
  }

  const records: CareerRecord[] = []

  /* ── single-week high and low ──────────────────────────────────────────── */
  const high = ours.reduce((a, b) => (b.pointsFor > a.pointsFor ? b : a))
  const low = ours.reduce((a, b) => (b.pointsFor < a.pointsFor ? b : a))

  records.push({
    key: 'high-week',
    label: 'Highest single week',
    value: fmt(high.pointsFor),
    context: where(high),
    tone: 'accent',
  })
  records.push({
    key: 'low-week',
    label: 'Lowest single week',
    value: fmt(low.pointsFor),
    context: where(low),
    tone: 'bad',
  })

  /* ── biggest blowout and closest win ───────────────────────────────────── */
  const wins = ours.filter((r) => r.win === 1)
  if (wins.length > 0) {
    const blowout = wins.reduce((a, b) =>
      b.pointsFor - b.pointsAgainst > a.pointsFor - a.pointsAgainst ? b : a,
    )
    const closest = wins.reduce((a, b) =>
      b.pointsFor - b.pointsAgainst < a.pointsFor - a.pointsAgainst ? b : a,
    )
    records.push({
      key: 'blowout',
      label: 'Biggest blowout',
      value: `+${fmt(blowout.pointsFor - blowout.pointsAgainst)}`,
      context: where(blowout),
      tone: 'good',
    })
    records.push({
      key: 'closest',
      label: 'Closest win',
      value: `+${fmt(closest.pointsFor - closest.pointsAgainst)}`,
      context: where(closest),
      tone: 'good',
    })
  }

  /* ── heaviest defeat ───────────────────────────────────────────────────── */
  const losses = ours.filter((r) => r.win === 0 && r.pointsAgainst > r.pointsFor)
  if (losses.length > 0) {
    const worst = losses.reduce((a, b) =>
      b.pointsAgainst - b.pointsFor > a.pointsAgainst - a.pointsFor ? b : a,
    )
    records.push({
      key: 'worst-loss',
      label: 'Heaviest defeat',
      value: `−${fmt(worst.pointsAgainst - worst.pointsFor)}`,
      context: where(worst),
      tone: 'bad',
    })
  }

  /* ── best season total, per (league, season) ───────────────────────────── */
  const seasonTotals = new Map<
    string,
    { points: number; weeks: number; leagueName: string; season: number }
  >()
  for (const r of ours) {
    const m = mine.get(`${r.leagueId}:${r.rosterId}`)
    const key = `${r.leagueId}:${r.rosterId}:${r.seasonYear}`
    const held = seasonTotals.get(key)
    if (held) {
      held.points += r.pointsFor
      held.weeks += 1
    } else {
      seasonTotals.set(key, {
        points: r.pointsFor,
        weeks: 1,
        leagueName: m?.leagueName ?? 'League',
        season: r.seasonYear,
      })
    }
  }
  const bestSeason = [...seasonTotals.values()].reduce((a, b) => (b.points > a.points ? b : a))
  records.push({
    key: 'season-points',
    label: 'Most points in a season',
    value: bestSeason.points.toLocaleString(undefined, { maximumFractionDigits: 1 }),
    context: `${bestSeason.leagueName} · ${bestSeason.season}, ${bestSeason.weeks} weeks`,
    tone: 'accent',
  })

  /* ── streaks, within one roster-season ─────────────────────────────────── */
  /*
   * ⚠ A STREAK IS PER ROSTER-SEASON, NOT ACROSS THEM. `ours` is one flat list of
   * every league's weeks; counting a run through it would chain a win in one
   * league to a win in another and report a fifty-game streak nobody played.
   */
  let bestWin = { len: 0, leagueName: '', season: 0 }
  let bestLoss = { len: 0, leagueName: '', season: 0 }

  const bySeries = new Map<string, typeof ours>()
  for (const r of ours) {
    const key = `${r.leagueId}:${r.rosterId}:${r.seasonYear}`
    const list = bySeries.get(key)
    if (list) list.push(r)
    else bySeries.set(key, [r])
  }

  for (const [key, series] of bySeries) {
    const first = series[0]
    const m = mine.get(`${first.leagueId}:${first.rosterId}`)
    const name = m?.leagueName ?? 'League'
    let runW = 0
    let runL = 0
    for (const r of [...series].sort((a, b) => a.week - b.week)) {
      if (r.win === 1) {
        runW += 1
        runL = 0
      } else if (r.pointsAgainst > r.pointsFor) {
        runL += 1
        runW = 0
      } else {
        /* A tie ends both runs without starting either. */
        runW = 0
        runL = 0
      }
      if (runW > bestWin.len) bestWin = { len: runW, leagueName: name, season: first.seasonYear }
      if (runL > bestLoss.len) bestLoss = { len: runL, leagueName: name, season: first.seasonYear }
    }
    void key
  }

  if (bestWin.len > 0) {
    records.push({
      key: 'win-streak',
      label: 'Longest win streak',
      value: `${bestWin.len} gms`,
      context: `${bestWin.leagueName} · ${bestWin.season}`,
      tone: 'good',
    })
  }
  if (bestLoss.len > 0) {
    records.push({
      key: 'loss-streak',
      label: 'Longest losing streak',
      value: `${bestLoss.len} gms`,
      context: `${bestLoss.leagueName} · ${bestLoss.season}`,
      tone: 'bad',
    })
  }

  /* ── trades made, by season ────────────────────────────────────────────── */
  const tradeCounts = await prisma.leagueTrade
    .groupBy({
      by: ['season'],
      where: { history: { sleeperLeagueId: { in: [...new Set(platformIds)] } } },
      _count: { _all: true },
    })
    .catch(() => [] as Array<{ season: number; _count: { _all: number } }>)

  if (tradeCounts.length > 0) {
    const top = tradeCounts.reduce((a, b) => (b._count._all > a._count._all ? b : a))
    records.push({
      key: 'trades',
      label: 'Most trades in a season',
      value: String(top._count._all),
      /*
       * ⚠ ACROSS YOUR LEAGUES, NOT IN ONE. `LeagueTrade` groups by history, and a
       * history is (league, manager) — so a per-league figure would need a second
       * grouping. The context says which it is, because "9 trades" reads very
       * differently as a single-league number.
       */
      context: `${top.season} · across every league we hold trades for`,
      tone: 'warn',
    })
  }

  const leaguesCounted = new Set(ours.map((r) => r.leagueId)).size

  return {
    records,
    weeksCounted: ours.length,
    leaguesCounted,
    missing: MISSING,
  }
}
