/**
 * THE one place a daily sport's (NBA / NHL / MLB) REDRAFT roster layout is defined.
 *
 * 🛑 FIVE FILES USED TO DISAGREE ABOUT THE SAME ROSTER. For a new NBA redraft league:
 *
 *   SportDefaultsRegistry   PG SG SF PF C G F UTIL          8 starters  BN 4  IR 1
 *   redraft/sportConfig     PG SG SF PF C G F UTIL UTIL     9 starters  BN 4  IR 2
 *   NbaRosterTemplates      PG SG G SF PF F C C UTIL UTIL  10 starters  BN 3  IL 2
 *   prisma seed (DB row)    PG SG SF PF C G F UTIL UTIL     9 starters  BN 6  no IR
 *   sportConfig/configs     PG SG SF PF C G F UTIL          8 starters  BN 4  IR 2
 *
 * and NHL and MLB had the same spread (NHL D: 2 / 3 / 4; MLB OF 3 or 4, SP 2 or 4, a DH starter in
 * one copy and CI/MI in another). League creation stored the registry's copy as `foundation_defaults`
 * and sized the draft from a sixth number (`rounds_default` 13 / 18 / 26), the post-create bootstrap
 * then wrote the templates' copy to `<sport>_roster_config`, the lineup screen read that copy first,
 * and the lineup validator — for a league with no `roster.config.sections` — read `starter_slots` or
 * the redraft sport config instead. They all derive from this table now.
 *
 * The layouts are the ones `lib/{nba,nhl,mlb}-roster/*RosterTemplates.ts` already installed on every
 * new redraft league at bootstrap (the copy a commissioner actually sees), so a new league's stored
 * roster does not change — only the readers that disagreed with it do.
 *
 * Dependency-free on purpose: the registries, the roster templates, the redraft sport config, the
 * sport configs, the prisma seed and the creation contract all import it.
 */

export const DAILY_REDRAFT_SPORTS = ['NBA', 'NHL', 'MLB'] as const
export type DailyRedraftSport = (typeof DAILY_REDRAFT_SPORTS)[number]

export interface DailyRedraftStarterSlot {
  /** Slot key as stored in `<sport>_roster_config.slots` and `starter_slots`. */
  key: string
  count: number
  /** Player positions that may fill this slot. */
  eligiblePositions: readonly string[]
  /** A multi-position slot (G / F / UTIL / CI / MI / P). */
  flex: boolean
}

export interface DailyRedraftRosterLayout {
  sport: DailyRedraftSport
  /** Starters in display order. */
  starters: readonly DailyRedraftStarterSlot[]
  benchSlots: number
  /** Reserve slots by key (IL / IR, and MLB's minor-league NA). Not drafted, not started. */
  reserveSlots: Readonly<Record<string, number>>
  /** Player positions the redraft pool drafts from. */
  draftablePlayerPositions: readonly string[]
}

const NBA_LAYOUT: DailyRedraftRosterLayout = {
  sport: 'NBA',
  starters: [
    { key: 'PG', count: 1, eligiblePositions: ['PG'], flex: false },
    { key: 'SG', count: 1, eligiblePositions: ['SG'], flex: false },
    { key: 'G', count: 1, eligiblePositions: ['PG', 'SG'], flex: true },
    { key: 'SF', count: 1, eligiblePositions: ['SF'], flex: false },
    { key: 'PF', count: 1, eligiblePositions: ['PF'], flex: false },
    { key: 'F', count: 1, eligiblePositions: ['SF', 'PF'], flex: true },
    { key: 'C', count: 2, eligiblePositions: ['C'], flex: false },
    { key: 'UTIL', count: 2, eligiblePositions: ['PG', 'SG', 'SF', 'PF', 'C'], flex: true },
  ],
  benchSlots: 3,
  reserveSlots: { IL: 2 },
  draftablePlayerPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
}

const NHL_LAYOUT: DailyRedraftRosterLayout = {
  sport: 'NHL',
  starters: [
    { key: 'C', count: 2, eligiblePositions: ['C'], flex: false },
    { key: 'LW', count: 2, eligiblePositions: ['LW'], flex: false },
    { key: 'RW', count: 2, eligiblePositions: ['RW'], flex: false },
    { key: 'D', count: 4, eligiblePositions: ['D'], flex: false },
    { key: 'UTIL', count: 1, eligiblePositions: ['C', 'LW', 'RW', 'D'], flex: true },
    { key: 'G', count: 2, eligiblePositions: ['G'], flex: false },
  ],
  benchSlots: 4,
  reserveSlots: { IR: 2 },
  draftablePlayerPositions: ['C', 'LW', 'RW', 'D', 'G'],
}

const MLB_HITTERS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH', 'TWP'] as const

const MLB_LAYOUT: DailyRedraftRosterLayout = {
  sport: 'MLB',
  starters: [
    { key: 'C', count: 1, eligiblePositions: ['C'], flex: false },
    { key: '1B', count: 1, eligiblePositions: ['1B'], flex: false },
    { key: '2B', count: 1, eligiblePositions: ['2B'], flex: false },
    { key: '3B', count: 1, eligiblePositions: ['3B'], flex: false },
    { key: 'SS', count: 1, eligiblePositions: ['SS'], flex: false },
    { key: 'CI', count: 1, eligiblePositions: ['1B', '3B'], flex: true },
    { key: 'MI', count: 1, eligiblePositions: ['2B', 'SS'], flex: true },
    { key: 'OF', count: 3, eligiblePositions: ['OF', 'LF', 'CF', 'RF'], flex: false },
    { key: 'UTIL', count: 1, eligiblePositions: MLB_HITTERS, flex: true },
    { key: 'SP', count: 2, eligiblePositions: ['SP'], flex: false },
    { key: 'RP', count: 2, eligiblePositions: ['RP'], flex: false },
    { key: 'P', count: 3, eligiblePositions: ['SP', 'RP', 'P'], flex: true },
  ],
  benchSlots: 6,
  reserveSlots: { IL: 2, NA: 1 },
  draftablePlayerPositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'],
}

export const DAILY_REDRAFT_ROSTER_LAYOUTS: Readonly<Record<DailyRedraftSport, DailyRedraftRosterLayout>> = {
  NBA: NBA_LAYOUT,
  NHL: NHL_LAYOUT,
  MLB: MLB_LAYOUT,
}

export function isDailyRedraftSport(sport: unknown): sport is DailyRedraftSport {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return (DAILY_REDRAFT_SPORTS as readonly string[]).includes(normalized)
}

export function getDailyRedraftRosterLayout(sport: unknown): DailyRedraftRosterLayout | null {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return isDailyRedraftSport(normalized) ? DAILY_REDRAFT_ROSTER_LAYOUTS[normalized] : null
}

/** `{ slot: count }` for starters only. */
export function dailyRedraftStarterSlots(layout: DailyRedraftRosterLayout): Record<string, number> {
  const out: Record<string, number> = {}
  for (const slot of layout.starters) out[slot.key] = (out[slot.key] ?? 0) + slot.count
  return out
}

/** Starters expanded one entry per seat, in display order (`['PG','SG','G',…,'UTIL','UTIL']`). */
export function dailyRedraftStarterSlotOrder(layout: DailyRedraftRosterLayout): string[] {
  return layout.starters.flatMap((slot) => Array.from({ length: slot.count }, () => slot.key))
}

/** The multi-position starter slots and who may fill them. */
export function dailyRedraftFlexDefinitions(
  layout: DailyRedraftRosterLayout,
): Array<{ slotName: string; allowedPositions: string[] }> {
  return layout.starters
    .filter((slot) => slot.flex)
    .map((slot) => ({ slotName: slot.key, allowedPositions: [...slot.eligiblePositions] }))
}

/** Starter seats of one slot key (0 when the layout has no such slot). */
export function dailyRedraftSlotCount(layout: DailyRedraftRosterLayout, key: string): number {
  return layout.starters.filter((slot) => slot.key === key).reduce((total, slot) => total + slot.count, 0)
}

export function dailyRedraftStarterCount(layout: DailyRedraftRosterLayout): number {
  return layout.starters.reduce((total, slot) => total + slot.count, 0)
}

export function dailyRedraftReserveCount(layout: DailyRedraftRosterLayout): number {
  return Object.values(layout.reserveSlots).reduce((total, count) => total + count, 0)
}

/** Starters + bench: the players a team drafts, and so the default number of draft rounds. */
export function dailyRedraftDraftableRosterSize(layout: DailyRedraftRosterLayout): number {
  return dailyRedraftStarterCount(layout) + layout.benchSlots
}

/** Starters + bench + reserve. */
export function dailyRedraftTotalRosterSize(layout: DailyRedraftRosterLayout): number {
  return dailyRedraftDraftableRosterSize(layout) + dailyRedraftReserveCount(layout)
}

/**
 * The full `{ slot: count }` map — starters, `BN`, then reserve — in the shape the roster engine
 * stores as `League.settings.<sport>_roster_config.slots`.
 */
export function dailyRedraftRosterSlotMap(layout: DailyRedraftRosterLayout): Record<string, number> {
  return {
    ...dailyRedraftStarterSlots(layout),
    BN: layout.benchSlots,
    ...layout.reserveSlots,
  }
}

/**
 * 🛑 Waiver processing days for the daily sports: Mon / Wed / Fri (0 = Sunday). A daily lineup sport
 * on a once- or twice-a-week waiver run leaves an injured starter unreplaceable for days.
 */
export const DAILY_REDRAFT_WAIVER_PROCESSING_DAYS: readonly number[] = [1, 3, 5]
