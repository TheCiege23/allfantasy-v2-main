/**
 * The Dynasty Era deck at the top of /core's league Home: what makes a dynasty league read as one at a
 * glance — which year of the dynasty this is, who hangs in the rafters, the draft capital you hold, how
 * old the lineup you start is, and your taxi squad.
 *
 * Built only for a dynasty league (`usesDynastyBackground`, the same rule the /core shell stamp and the
 * /league/[id] workspace use). In practice that is an IMPORTED league: a native league's Home redirects
 * to /league/[id], whose own dynasty extras (DynastyLeagueHomeExtras) already show these.
 *
 * ⚠ NOTHING HERE IS ESTIMATED. Every block is a fact already stored — `league_seasons` /
 * `league_championships`, the future-pick inventory, `SportsPlayer.age`, the roster's taxi section —
 * read by the loaders this module is fed from (lib/core-app/dynastyOutlook.ts,
 * lib/league/dynastyChampionRafters.ts). A block whose read is missing or empty is null and the deck
 * draws nothing for it; the deck itself still renders, because the era band alone is what tells a
 * dynasty league from any other.
 */
import type { ChampionRafters } from '@/lib/league/dynastyHomeExtras'
import type { DynastyOutlook } from './dynastyOutlook'
import { dynastySeasonClock, type DynastySeasonClockSource } from '@/lib/league-media/dynastySeasonClock'
import { dynastyYearOf } from '@/lib/dynasty-core/dynastyDetails'
import { isPreDraftOrDrafting } from '@/lib/league-stage/leagueStage'

type DynastyDeckPickSeason = {
  season: number
  picks: Array<{ round: number; label: string; via: string | null }>
}

/**
 * One step between the championship and the next kickoff. `at` is a STORED date (ISO) or null — a
 * milestone with no stored date is drawn undated and labelled so, never placed on a guessed day.
 */
export type DynastyOffseasonMilestone = {
  key: 'rollover' | 'keeper_deadline' | 'rookie_draft' | 'kickoff'
  /** The season the milestone belongs to (the rookie class it drafts, the season that kicks off). */
  season: number
  at: string | null
  /** Whole days from the builder's `now` to `at` (0 = today). Null when undated or already done. */
  daysAway: number | null
  state: 'done' | 'live' | 'upcoming'
}

export type DynastyOffseason = {
  /**
   * `season_complete`: the league's own status says the season is over (Sleeper `complete`).
   * `next_season`: the league has rolled into its next season but not kicked off (pre-draft or
   * drafting) AND an earlier season is on file — a startup league's first draft is not an offseason.
   */
  phase: 'season_complete' | 'next_season'
  /** The season just finished, and the one coming. */
  completedSeason: number
  nextSeason: number
  /** The completed season's champion, from the rafters. Null when none is recorded yet. */
  champion: { season: number; label: string | null; mine: boolean } | null
  /** The rookie draft the deck emphasises: the next one held, which seeds `nextSeason`. */
  nextDraftSeason: number
  milestones: DynastyOffseasonMilestone[]
}

/** Everything the offseason state reads, all of it stored (see `loadDynastyHomeDeck` in leagueHome.ts). */
export type DynastyOffseasonInput = {
  /** `resolveLeagueStage(league)` — the platform's word for the league's phase. */
  stage: string | null
  now: Date
  /** A stored draft start: League.settings draft_start / LeagueSettings.draftDateUtc. */
  draftAt: Date | null
  /** A rookie draft is running right now (a live rookie draft row). */
  draftLive: boolean
  /** A rookie draft row is waiting for the coming draft, not yet started. */
  draftScheduled: boolean
  /** An open KeeperSelectionSession's deadline, or League.settings keeper_deadline_at. */
  keeperDeadlineAt: Date | null
  /** When the next season was set up (RedraftSeason status `setup`, createdAt) — native leagues only. */
  rolledOverAt: Date | null
  /** First regular-season game of the next season on file (SportsGame), when one is stored. */
  nextSeasonStartAt: Date | null
}

/** A league whose own status says its season is over. */
const SEASON_OVER_STAGES = new Set(['complete', 'completed', 'finished', 'season_over', 'offseason'])
const DAY_MS = 86_400_000

export function isSeasonOverStage(stage: string | null | undefined): boolean {
  return SEASON_OVER_STAGES.has(String(stage ?? '').toLowerCase().trim())
}

export type DynastyHomeDeck = {
  /** "Year N · season". `year` is null when the league's first season is not on file — never guessed. */
  clock: { year: number | null; season: number } | null
  rafters: ChampionRafters | null
  picks: {
    total: number
    firstRounders: number
    seasons: DynastyDeckPickSeason[]
    /** `partial` when the inventory could only rebuild some drafts (importedFuturePicks coverage). */
    partial: boolean
  } | null
  ages: {
    medianStarterAge: number
    known: number
    total: number
    youngCore: number
    /** Starters at or past their position's usual decline age (dynastyOutlook's rule of thumb). */
    aging: number
  } | null
  taxi: { count: number; slots: number } | null
  /**
   * Between seasons only. Absent in season, so an in-season deck is exactly what it always was. When
   * set, the era band reads "Year N complete" / "Year N+1 begins", an Offseason timeline draws, and the
   * draft capital card leads with the next rookie draft.
   */
  offseason?: DynastyOffseason
}

/** Taxi-squad ids on a stored roster blob: top-level `taxi`, else `lineup_sections.taxi`. */
export function taxiIdsOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const o = playerData as Record<string, unknown>
  const pick = (arr: unknown) =>
    Array.isArray(arr)
      ? arr
          .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : v && typeof v === 'object' ? String((v as Record<string, unknown>).playerId ?? (v as Record<string, unknown>).id ?? '') : ''))
          .filter((id) => id && id !== '0' && id !== 'null')
      : []
  const top = pick(o.taxi)
  if (top.length) return [...new Set(top)]
  const sections = o.lineup_sections
  return sections && typeof sections === 'object' ? [...new Set(pick((sections as Record<string, unknown>).taxi))] : []
}

/** Starter ids on a stored roster blob (`starters`, Sleeper's "0" empty-slot marker dropped). */
export function starterIdsOf(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const starters = (playerData as Record<string, unknown>).starters
  return Array.isArray(starters)
    ? starters.map((v) => String(v ?? '').trim()).filter((id) => id && id !== '0' && id !== 'null')
    : []
}

export function buildDynastyHomeDeck(input: {
  league: DynastySeasonClockSource
  /** Earliest season the league's history holds (`loadChampionHistory`), for Year N on an import. */
  firstSeasonOnFile: number | null
  rafters: ChampionRafters | null
  outlook: DynastyOutlook | null
  taxi: { count: number; slots: number } | null
  /** Omit, or pass an in-season stage, and the deck is built exactly as it always was. */
  offseason?: DynastyOffseasonInput | null
}): DynastyHomeDeck {
  const base = dynastySeasonClock(input.league)
  const clock = base
    ? { season: base.season, year: base.year ?? dynastyYearOf(base.season, input.firstSeasonOnFile) }
    : null

  let picks: DynastyHomeDeck['picks'] = null
  if (input.outlook?.picks.available) {
    const seasons = input.outlook.picks.bySeason
      .map((s) => ({ season: s.season, picks: s.picks.map((p) => ({ round: p.round, label: p.label, via: p.fromTeamName })) }))
      .filter((s) => s.picks.length > 0)
    const all = seasons.flatMap((s) => s.picks)
    if (all.length > 0) {
      picks = {
        total: all.length,
        firstRounders: all.filter((p) => p.round === 1).length,
        seasons,
        partial: input.outlook.picks.coverage !== 'complete',
      }
    }
  }

  const a = input.outlook?.ages
  const ages: DynastyHomeDeck['ages'] = a?.available
    ? { medianStarterAge: a.medianStarterAge, known: a.known, total: a.total, youngCore: a.youngCore, aging: a.aging.length }
    : null

  const taxi = input.taxi && (input.taxi.slots > 0 || input.taxi.count > 0) ? input.taxi : null

  const offseason =
    input.offseason && clock ? buildOffseason(input.offseason, clock.season, input.firstSeasonOnFile, input.rafters, picks) : null
  if (!offseason) return { clock, rafters: input.rafters, picks, ages, taxi }

  // The next rookie draft's picks lead the capital card; later drafts follow in their order.
  const next = offseason.nextDraftSeason
  const orderedPicks = picks
    ? { ...picks, seasons: [...picks.seasons.filter((s) => s.season === next), ...picks.seasons.filter((s) => s.season !== next)] }
    : null
  // After the final the completed season is no longer an open title: its pennant is hung or not
  // recorded yet, and an "Open" banner would say the title is still being played for.
  const rafters =
    input.rafters && offseason.phase === 'season_complete' && input.rafters.openSeason === offseason.completedSeason
      ? { ...input.rafters, openSeason: null }
      : input.rafters
  return { clock, rafters, picks: orderedPicks, ages, taxi, offseason }
}

function buildOffseason(
  i: DynastyOffseasonInput,
  season: number,
  firstSeasonOnFile: number | null,
  rafters: ChampionRafters | null,
  picks: DynastyHomeDeck['picks'],
): DynastyOffseason | null {
  let phase: DynastyOffseason['phase']
  let completedSeason: number
  if (isSeasonOverStage(i.stage)) {
    phase = 'season_complete'
    completedSeason = season
  } else if (isPreDraftOrDrafting({ status: i.stage }) && firstSeasonOnFile != null && firstSeasonOnFile < season) {
    phase = 'next_season'
    completedSeason = season - 1
  } else {
    return null
  }
  const nextSeason = completedSeason + 1
  const nextDraftSeason = nextSeason

  const pennant = rafters?.pennants.find((p) => p.season === completedSeason) ?? null
  const champion = pennant ? { season: pennant.season, label: pennant.label, mine: pennant.mine } : null

  const now = i.now.getTime()
  const ahead = (d: Date | null) => (d && d.getTime() > now ? d : null)
  const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now) / DAY_MS))
  const milestones: DynastyOffseasonMilestone[] = []

  if (i.rolledOverAt && i.rolledOverAt.getTime() <= now) {
    milestones.push({ key: 'rollover', season: nextSeason, at: i.rolledOverAt.toISOString(), daysAway: null, state: 'done' })
  }
  const keeper = ahead(i.keeperDeadlineAt)
  if (keeper) milestones.push({ key: 'keeper_deadline', season: nextSeason, at: keeper.toISOString(), daysAway: days(keeper), state: 'upcoming' })

  /*
   * The rookie draft. A stored start that has already passed belongs to an earlier draft (the startup,
   * last year's class), not this one — so only a start still ahead is used as its date. With no such
   * date it still draws, undated, when something stored says the draft is coming: it is running, a
   * draft row is waiting, or the viewer holds picks in it.
   */
  const draftLive = i.draftLive || (phase === 'next_season' && String(i.stage ?? '').toLowerCase().trim() === 'drafting')
  const draftAt = draftLive ? null : ahead(i.draftAt)
  const holdsNextPicks = Boolean(picks?.seasons.some((s) => s.season === nextDraftSeason))
  if (draftLive) {
    milestones.push({ key: 'rookie_draft', season: nextDraftSeason, at: null, daysAway: null, state: 'live' })
  } else if (draftAt || i.draftScheduled || holdsNextPicks) {
    milestones.push({
      key: 'rookie_draft',
      season: nextDraftSeason,
      at: draftAt?.toISOString() ?? null,
      daysAway: draftAt ? days(draftAt) : null,
      state: 'upcoming',
    })
  }
  // Keeper deadline and rookie draft: the sooner comes first when both are dated.
  const k = milestones.findIndex((m) => m.key === 'keeper_deadline')
  const d = milestones.findIndex((m) => m.key === 'rookie_draft')
  if (k >= 0 && d >= 0 && milestones[d].at && milestones[d].at! < milestones[k].at!) {
    const swap = milestones[k]
    milestones[k] = milestones[d]
    milestones[d] = swap
  }

  // The next season is certain in a dynasty league; its first game is dated only when one is on file.
  const kickoff = ahead(i.nextSeasonStartAt)
  milestones.push({ key: 'kickoff', season: nextSeason, at: kickoff?.toISOString() ?? null, daysAway: kickoff ? days(kickoff) : null, state: 'upcoming' })

  return { phase, completedSeason, nextSeason, champion, nextDraftSeason, milestones }
}
