/**
 * Scheduled roster changes for a guillotine league (owner's ask, 2026-11-25): "week 10, the SF position gets
 * added plus 1 bench spot", "week 11 a bench spot turns into a starting spot" — set once by the commissioner,
 * applied by AllFantasy, instead of the commissioner editing the roster by hand on the right morning.
 *
 * 🛑 ONLY CHANGES THAT NEVER FORCE A MOVE. Every kind here leaves every team's saved lineup legal: a new
 * starting spot is simply empty until its manager fills it, and a bench spot that becomes a starter leaves the
 * bench able to hold what it held (lib/roster/benchCapacity.ts counts an empty starting spot as bench room).
 * The owner's third example, "week 7 a starter is taken away", is NOT here, on purpose. Weekly scoring counts
 * whoever is stored as a starter and never checks the layout (lib/redraft/scoringEngine.ts), so taking a spot
 * away without also benching the player in it would leave that team an extra scoring starter until its manager
 * acted. Shrinking the roster likewise leaves full teams over the limit, unable to save a lineup until they
 * drop someone. Both need AllFantasy to move a player for a manager, which is its own change.
 *
 * A change is a DELTA on the layout the league has when its week arrives, not a layout of its own. So a
 * commissioner who edits the roster by hand mid-season keeps that edit, and the next scheduled change builds on
 * it. What makes a delta safe to retry is in ./rosterScheduleApply.ts: the layout a run is about to write is
 * recorded first, and a second run writes that same layout instead of adding the delta again.
 *
 * Every layout the schedule produces must be one the commissioner's own roster editor would accept: the same
 * per-spot maximum (lib/roster-engine, each sport's slot definitions) and never a negative bench. A schedule
 * that breaks one is refused at save, with the week and the reason.
 *
 * Pure, so the settings page can import it.
 */

/** League.settings key: the commissioner's list. Absent = no scheduled changes. */
export const ROSTER_SCHEDULE_KEY = 'guillotineRosterSchedule'
/** League.settings key: what has been applied. Written only by ./rosterScheduleApply.ts. */
export const ROSTER_SCHEDULE_STATE_KEY = 'guillotineRosterScheduleState'

export const MAX_ROSTER_CHANGES = 12
export const MAX_SPOTS_PER_CHANGE = 3
const MAX_WEEK = 30

export type RosterChangeKind = 'add_starter' | 'add_bench' | 'bench_to_starter'

export type RosterChange = {
  id: string
  /** The first week the new layout is in play. */
  week: number
  kind: RosterChangeKind
  /** The starting spot (roster-engine slot key). Null for the two bench-only kinds. */
  slot: string | null
  count: number
}

export const ROSTER_CHANGE_OPTIONS: ReadonlyArray<{ value: RosterChangeKind; label: string; needsSlot: boolean }> = [
  { value: 'add_starter', label: 'Add a starting spot', needsSlot: true },
  { value: 'add_bench', label: 'Add bench spots', needsSlot: false },
  { value: 'bench_to_starter', label: 'Turn a bench spot into a starter', needsSlot: true },
]

const KINDS = new Set<RosterChangeKind>(ROSTER_CHANGE_OPTIONS.map((o) => o.value))
export const rosterChangeNeedsSlot = (kind: RosterChangeKind): boolean => kind !== 'add_bench'

/** One roster spot a league of this sport can have, with the editor's own limits. */
export type RosterSpot = { key: string; label: string; shortLabel: string; min: number; max: number }
export type RosterSpots = {
  /** Starting spots, in the sport's own order. Bench, injured-list, taxi and college spots are not here. */
  starters: RosterSpot[]
  bench: RosterSpot
}

/** What the Guilly rules page loads (./rosterScheduleSave.ts `readRosterScheduleView`). */
export type RosterScheduleView = {
  /** Every stored change, in running order. The ones in `done` have run. */
  changes: RosterChange[]
  done: string[]
  /** The ones in `done` that could not be applied when their week came, with the reason. */
  skipped: Array<{ id: string; reason: string }>
  /** The league's roster today: what the next change builds on. */
  layout: Record<string, number>
  spots: RosterSpots
  /** A new change can be set for these weeks. `fromWeek > toWeek` = the season has no later week. */
  fromWeek: number
  toWeek: number
  /** False for a sport the roster engine does not run: the page then hides the section. */
  supported: boolean
}

const NOT_A_STARTER = new Set(['bench', 'reserve', 'college'])

/** From a sport's slot definitions (lib/roster-engine `getSlots()`), which are plain data. */
export function rosterSpotsFromDefinitions(
  defs: ReadonlyArray<{ key: string; label: string; shortLabel: string; category: string; minCount: number; maxCount: number }>,
  layout: Record<string, number>,
): RosterSpots {
  const spot = (d: (typeof defs)[number]): RosterSpot => ({ key: d.key, label: d.label, shortLabel: d.shortLabel, min: d.minCount, max: d.maxCount })
  const starters = defs.filter((d) => !NOT_A_STARTER.has(d.category)).map(spot)
  const benchDefs = defs.filter((d) => d.category === 'bench')
  // A sport can define more than one bench key; the league's own layout says which one it uses.
  const benchDef = benchDefs.find((d) => d.key in layout) ?? benchDefs[0]
  const bench: RosterSpot = benchDef ? spot(benchDef) : { key: 'BN', label: 'Bench', shortLabel: 'BN', min: 0, max: 30 }
  return { starters, bench }
}

export function readRosterSchedule(settings: unknown): RosterChange[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[ROSTER_SCHEDULE_KEY] : null
  if (!Array.isArray(raw)) return []
  const out: RosterChange[] = []
  for (const item of raw) {
    const c = shapeOf(item)
    if (c && !out.some((p) => p.id === c.id)) out.push(c)
  }
  return sortChanges(out)
}

export type RosterScheduleState = {
  /** Ids of changes that have run, including ones skipped because the layout no longer allowed them. */
  done: string[]
  /** The ones in `done` that were skipped, with the reason, so no page calls a skipped change done. */
  skipped: Array<{ id: string; reason: string }>
  /** A run that recorded its layout and has not finished writing it. See ./rosterScheduleApply.ts. */
  pending: {
    week: number
    ids: string[]
    skipped: Array<{ id: string; reason: string }>
    /** The layout this run writes. Absolute, so writing it twice changes nothing. */
    slots: Record<string, number>
    /** The lineup's starter seats before the write (./rosterSeatRemap.ts). */
    seatsBefore: string[]
  } | null
}

export function readRosterScheduleState(settings: unknown): RosterScheduleState {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[ROSTER_SCHEDULE_STATE_KEY] : null
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const done = Array.isArray(r.done) ? r.done.filter((x): x is string => typeof x === 'string') : []
  const skipped = skippedList(r.skipped)
  const p = r.pending && typeof r.pending === 'object' ? (r.pending as Record<string, unknown>) : null
  const slots = p && p.slots && typeof p.slots === 'object' && !Array.isArray(p.slots) ? cleanLayout(p.slots as Record<string, unknown>) : null
  const pending =
    p && slots && Number.isInteger(p.week) && Array.isArray(p.ids)
      ? {
          week: p.week as number,
          ids: p.ids.filter((x): x is string => typeof x === 'string'),
          skipped: skippedList(p.skipped),
          slots,
          seatsBefore: Array.isArray(p.seatsBefore) ? p.seatsBefore.filter((x): x is string => typeof x === 'string') : [],
        }
      : null
  return { done, skipped, pending }
}

function skippedList(raw: unknown): Array<{ id: string; reason: string }> {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((s) => {
    const x = (s ?? {}) as Record<string, unknown>
    return typeof x.id === 'string' ? [{ id: x.id, reason: typeof x.reason === 'string' ? x.reason : '' }] : []
  })
}

function cleanLayout(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v)
    if (Number.isInteger(n) && n >= 0) out[k] = n
  }
  return out
}

const ID = /^[A-Za-z0-9_-]{1,40}$/

function shapeOf(item: unknown): RosterChange | null {
  const x = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
  if (!x) return null
  const { id, week, kind, slot, count } = x
  if (typeof id !== 'string' || !ID.test(id)) return null
  if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > MAX_WEEK) return null
  if (typeof kind !== 'string' || !KINDS.has(kind as RosterChangeKind)) return null
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_SPOTS_PER_CHANGE) return null
  const needsSlot = rosterChangeNeedsSlot(kind as RosterChangeKind)
  if (needsSlot && (typeof slot !== 'string' || !slot)) return null
  return { id, week, kind: kind as RosterChangeKind, slot: needsSlot ? (slot as string) : null, count }
}

/** By week, keeping the commissioner's order inside a week (it decides which of two changes runs first). */
function sortChanges(changes: RosterChange[]): RosterChange[] {
  return changes.map((c, i) => ({ c, i })).sort((a, b) => a.c.week - b.c.week || a.i - b.i).map((x) => x.c)
}

export type RosterScheduleError = 'bad_change' | 'duplicate_id' | 'too_many' | 'unknown_spot' | 'bad_week' | 'bad_layout'

/**
 * Validate a commissioner's list. Strict: an invalid row is an error, never silently dropped.
 *
 * `fromWeek`..`toWeek` is the range a NEW change may be set for: after the week being played, and no later than
 * the season's last week. `anyWeekIds` are stored changes sent back untouched, which keep the week they have.
 * The whole list is then walked from `layout` (the league's roster today) and every layout it produces must be
 * a legal one.
 */
export function normalizeRosterSchedule(
  raw: unknown,
  ctx: { layout: Record<string, number>; spots: RosterSpots; fromWeek: number; toWeek: number; anyWeekIds?: ReadonlySet<string> },
): { ok: true; value: RosterChange[] } | { ok: false; error: RosterScheduleError; message: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'bad_change', message: 'Send the roster changes as a list.' }
  if (raw.length > MAX_ROSTER_CHANGES) return { ok: false, error: 'too_many', message: `A season can have at most ${MAX_ROSTER_CHANGES} scheduled roster changes.` }
  const changes: RosterChange[] = []
  for (const item of raw) {
    const c = shapeOf(item)
    if (!c) return { ok: false, error: 'bad_change', message: 'One of the roster changes is missing its week, its type or its spot.' }
    if (changes.some((p) => p.id === c.id)) return { ok: false, error: 'duplicate_id', message: 'Two roster changes share an id. Reload the page and try again.' }
    if (c.slot && !ctx.spots.starters.some((s) => s.key === c.slot)) {
      return { ok: false, error: 'unknown_spot', message: `"${c.slot}" is not a starting spot this league can have.` }
    }
    if (!ctx.anyWeekIds?.has(c.id) && (c.week < ctx.fromWeek || c.week > ctx.toWeek)) {
      return {
        ok: false,
        error: 'bad_week',
        message:
          ctx.fromWeek > ctx.toWeek
            ? 'The season is in its last week, so there is no later week to schedule a roster change for.'
            : `A roster change can be set for weeks ${ctx.fromWeek} to ${ctx.toWeek}. Week ${c.week} is outside that.`,
      }
    }
    changes.push(c)
  }
  const sorted = sortChanges(changes)
  const walk = walkRosterSchedule(ctx.layout, sorted, ctx.spots)
  const blocked = walk.steps.find((s) => !s.ok)
  if (blocked && !blocked.ok) return { ok: false, error: 'bad_layout', message: `Week ${blocked.change.week}: ${blocked.reason}` }
  return { ok: true, value: sorted }
}

type StepResult =
  | { ok: true; change: RosterChange; slots: Record<string, number> }
  | { ok: false; change: RosterChange; reason: string }

/** Apply one change to a layout. Never mutates its input; a change the layout cannot take says why. */
export function applyRosterChange(layout: Record<string, number>, change: RosterChange, spots: RosterSpots): StepResult {
  const slots = { ...layout }
  const bench = spots.bench
  const starter = change.slot ? spots.starters.find((s) => s.key === change.slot) : null
  if (rosterChangeNeedsSlot(change.kind) && !starter) return { ok: false, change, reason: `"${change.slot}" is not a starting spot this league can have.` }
  const n = change.count
  const have = (key: string) => Math.max(0, Math.floor(Number(slots[key] ?? 0)))
  const addStarter = (): string | null => {
    const s = starter!
    if (have(s.key) + n > s.max) return `a league can have at most ${s.max} ${s.label} ${plural(s.max, 'spot')}, and this would make ${have(s.key) + n}.`
    slots[s.key] = have(s.key) + n
    return null
  }
  const addBench = (): string | null => {
    if (have(bench.key) + n > bench.max) return `a league can have at most ${bench.max} bench spots, and this would make ${have(bench.key) + n}.`
    slots[bench.key] = have(bench.key) + n
    return null
  }
  const removeBench = (): string | null => {
    if (have(bench.key) - n < bench.min) return `the league has ${have(bench.key)} bench ${plural(have(bench.key), 'spot')}, so ${n} cannot become ${n === 1 ? 'a starter' : 'starters'}.`
    slots[bench.key] = have(bench.key) - n
    return null
  }
  const run: Record<RosterChangeKind, Array<() => string | null>> = {
    add_starter: [addStarter],
    add_bench: [addBench],
    bench_to_starter: [removeBench, addStarter],
  }
  for (const step of run[change.kind]) {
    const reason = step()
    if (reason) return { ok: false, change, reason }
  }
  return { ok: true, change, slots }
}

/** Walk a list in order from a layout. A change that cannot apply is reported and left out; the walk goes on. */
export function walkRosterSchedule(
  layout: Record<string, number>,
  changes: RosterChange[],
  spots: RosterSpots,
): { slots: Record<string, number>; steps: StepResult[] } {
  let slots = { ...layout }
  const steps: StepResult[] = []
  for (const change of sortChanges(changes)) {
    const r = applyRosterChange(slots, change, spots)
    steps.push(r)
    if (r.ok) slots = r.slots
  }
  return { slots, steps }
}

export function startingSpots(layout: Record<string, number>, spots: RosterSpots): number {
  return spots.starters.reduce((sum, s) => sum + Math.max(0, Math.floor(Number(layout[s.key] ?? 0))), 0)
}

export function benchSpots(layout: Record<string, number>, spots: RosterSpots): number {
  return Math.max(0, Math.floor(Number(layout[spots.bench.key] ?? 0)))
}

/** Changes whose week has arrived and that have not run. */
export function dueRosterChanges(schedule: RosterChange[], done: ReadonlyArray<string>, week: number): RosterChange[] {
  const ran = new Set(done)
  return sortChanges(schedule.filter((c) => c.week <= week && !ran.has(c.id)))
}

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`)

/** "Add 1 Super Flex starting spot" — the sentence the settings page, the chat post and the log all use. */
export function describeRosterChange(change: RosterChange, spots: RosterSpots): string {
  const n = change.count
  const name = change.slot ? (spots.starters.find((s) => s.key === change.slot)?.label ?? change.slot).replace(/\s*\(.*\)$/, '') : ''
  switch (change.kind) {
    case 'add_starter':
      return `Add ${n} ${name} starting ${plural(n, 'spot')}`
    case 'add_bench':
      return `Add ${n} bench ${plural(n, 'spot')}`
    case 'bench_to_starter':
      return `Turn ${n} bench ${plural(n, 'spot')} into ${n === 1 ? `a ${name} starting spot` : `${n} ${name} starting spots`}`
  }
}

/** "9 starters, 6 bench" for a layout. */
export function describeLayout(layout: Record<string, number>, spots: RosterSpots): string {
  const s = startingSpots(layout, spots)
  return `${s} ${plural(s, 'starter')}, ${benchSpots(layout, spots)} bench`
}
