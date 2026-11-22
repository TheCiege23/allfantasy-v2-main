/**
 * "Auto-switch injured starters" (owner's page review #18, decisions 2026-11-18): Out only by default,
 * doubtful and questionable only when chosen; only the injured starters inside their window move; and
 * the setting belongs to the owner it was switched on for.
 */
import { describe, expect, it } from 'vitest'
import {
  AUTO_SWITCH_INJURED_KEY,
  autoSwitchInjuredFor,
  inSwitchWindow,
  nightBeforeStart,
  parseAutoSwitchInput,
  planAutoSwitchInjured,
  readAutoSwitchInjured,
  statusMeetsLevel,
  withAutoSwitchInjured,
  type AutoSwitchInjuredSetting,
} from '@/lib/lineup-automation/autoSwitchInjured'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

describe('statusMeetsLevel', () => {
  it('Out only: ruled out, IR and suspensions count; doubtful and questionable do not', () => {
    for (const s of ['Out', 'IR', 'Injured Reserve', '60-Day IL', 'Suspension']) expect(statusMeetsLevel(s, 'out')).toBe(true)
    for (const s of ['Doubtful', 'Questionable', 'GTD', 'Probable', '', null]) expect(statusMeetsLevel(s, 'out')).toBe(false)
  })

  it('Doubtful or worse adds doubtful, nothing softer', () => {
    expect(statusMeetsLevel('Doubtful', 'doubtful')).toBe(true)
    expect(statusMeetsLevel('Out', 'doubtful')).toBe(true)
    expect(statusMeetsLevel('Questionable', 'doubtful')).toBe(false)
  })

  it('Questionable or worse adds the game-day words, but never probable', () => {
    for (const s of ['Questionable', 'GTD', 'Game Time Decision', 'Day-to-Day', 'DTD', 'Doubtful', 'Out']) expect(statusMeetsLevel(s, 'questionable')).toBe(true)
    expect(statusMeetsLevel('Probable', 'questionable')).toBe(false)
    expect(statusMeetsLevel('Active', 'questionable')).toBe(false)
  })
})

describe('the timing window', () => {
  const kickoff = new Date('2026-11-22T18:00:00Z') // Sunday 1pm Eastern (EST)

  it('90 minutes before: inside the last 90 minutes only, never after kickoff', () => {
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T16:31:00Z'), 'pregame_90')).toBe(true)
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T16:29:00Z'), 'pregame_90')).toBe(false)
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T18:00:00Z'), 'pregame_90')).toBe(false)
  })

  it('the night before starts at 8pm Eastern the day before, in winter and in summer', () => {
    expect(nightBeforeStart(kickoff).toISOString()).toBe('2026-11-22T01:00:00.000Z') // Sat 8pm EST
    expect(nightBeforeStart(new Date('2026-09-13T17:00:00Z')).toISOString()).toBe('2026-09-13T00:00:00.000Z') // Sat 8pm EDT
    // A Monday night game: the night before is Sunday 8pm Eastern.
    expect(nightBeforeStart(new Date('2026-11-24T01:15:00Z')).toISOString()).toBe('2026-11-23T01:00:00.000Z')
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T00:59:00Z'), 'night_before')).toBe(false)
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T01:00:00Z'), 'night_before')).toBe(true)
    expect(inSwitchWindow(kickoff, new Date('2026-11-22T17:59:00Z'), 'night_before')).toBe(true)
  })

  it('never acts on an unknown kickoff', () => {
    expect(inSwitchWindow(null, new Date(), 'pregame_90')).toBe(false)
    expect(inSwitchWindow(new Date('nope'), new Date(), 'night_before')).toBe(false)
  })
})

const slot = (index: number, label: string, allowedPositions: string[]) => ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 })
const SLOTS = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'FLEX', ['RB', 'WR', 'TE'])]
const row = (id: string, position: string, slotIndex?: number) => ({ id, position, ...(slotIndex != null ? { slotIndex } : {}) })
const playerData = (starters: ReturnType<typeof row>[], bench: ReturnType<typeof row>[]) => ({ lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] } })
const proj = (pts: Record<string, number | null>) => Object.fromEntries(Object.entries(pts).map(([id, p]) => [id, { projectedPoints: p }]))
const unlocked = () => false

// The manager started wr-meh at FLEX over a better wr-good — his choice, which must stand.
const pd = playerData([row('qb1', 'QB', 0), row('rb-hurt', 'RB', 1), row('wr-meh', 'WR', 2)], [row('rb-good', 'RB'), row('rb-also-hurt', 'RB'), row('wr-good', 'WR')])
const pts = proj({ qb1: 20, 'rb-hurt': 18, 'wr-meh': 6, 'rb-good': 12, 'rb-also-hurt': 25, 'wr-good': 14 })
const hurt = (id: string) => id === 'rb-hurt' || id === 'rb-also-hurt'
const always = () => true

describe('planAutoSwitchInjured', () => {
  it('swaps only the injured starter, for the best healthy bench player', () => {
    const plan = planAutoSwitchInjured({ slots: SLOTS, playerData: pd, players: pts, isLocked: unlocked, injured: hurt, due: always })
    if (plan.kind !== 'set') throw new Error(`expected a swap, got ${plan.reason}`)
    // rb-also-hurt projects higher but is injured too; wr-meh stays at FLEX though wr-good is better.
    expect(plan.changes).toEqual([{ slot: 'RB', in: 'rb-good', out: 'rb-hurt' }])
    expect(getNormalizedLineupSections(plan.nextPlayerData).starters.map((r) => r.id)).toEqual(['qb1', 'rb-good', 'wr-meh'])
  })

  it('waits when the injured starter is not yet inside his window', () => {
    expect(planAutoSwitchInjured({ slots: SLOTS, playerData: pd, players: pts, isLocked: unlocked, injured: hurt, due: () => false })).toEqual({ kind: 'skip', reason: 'no_injured_starters' })
  })

  it('never moves a starter whose game has started', () => {
    expect(planAutoSwitchInjured({ slots: SLOTS, playerData: pd, players: pts, isLocked: (id) => id === 'rb-hurt', injured: hurt, due: always }).kind).toBe('skip')
  })

  it('leaves him alone when the only bench option is injured too', () => {
    const thin = playerData([row('qb1', 'QB', 0), row('rb-hurt', 'RB', 1), row('wr-meh', 'WR', 2)], [row('rb-also-hurt', 'RB'), row('qb2', 'QB')])
    const plan = planAutoSwitchInjured({ slots: SLOTS, playerData: thin, players: proj({ qb1: 20, 'rb-hurt': 18, 'wr-meh': 6, 'rb-also-hurt': 25, qb2: 9 }), isLocked: unlocked, injured: hurt, due: always })
    expect(plan.kind).toBe('skip')
  })
})

describe('the setting', () => {
  const on: AutoSwitchInjuredSetting = { on: true, level: 'doubtful', timing: 'night_before', byUserId: 'commish', ownerUserId: 'owner', since: '2026-11-18T00:00:00.000Z' }

  it('is stored on the team beside its other settings and counts only for the owner it was switched on for', () => {
    const settings = withAutoSwitchInjured({ other: 1 }, on)
    expect(settings).toEqual({ other: 1, [AUTO_SWITCH_INJURED_KEY]: on })
    expect(autoSwitchInjuredFor(settings, 'owner')).toEqual(on)
    expect(autoSwitchInjuredFor(settings, 'new-owner')).toBeNull()
    expect(autoSwitchInjuredFor(settings, null)).toBeNull()
  })

  it('turning it off removes it and keeps every other key', () => {
    expect(withAutoSwitchInjured({ other: 1, [AUTO_SWITCH_INJURED_KEY]: on }, null)).toEqual({ other: 1 })
  })

  it('reads an unknown level or timing as the defaults, Out only and 90 minutes before', () => {
    const odd = { [AUTO_SWITCH_INJURED_KEY]: { ...on, level: 'probable', timing: 'whenever' } }
    expect(readAutoSwitchInjured(odd)).toMatchObject({ level: 'out', timing: 'pregame_90' })
  })

  it('checks a request body, defaulting to Out only', () => {
    expect(parseAutoSwitchInput({ on: true })).toEqual({ ok: true, on: true, level: 'out', timing: 'pregame_90' })
    expect(parseAutoSwitchInput({ on: true, level: 'questionable', timing: 'night_before' })).toEqual({ ok: true, on: true, level: 'questionable', timing: 'night_before' })
    expect(parseAutoSwitchInput({ on: 'yes' }).ok).toBe(false)
    expect(parseAutoSwitchInput({ on: true, level: 'probable' }).ok).toBe(false)
  })
})
