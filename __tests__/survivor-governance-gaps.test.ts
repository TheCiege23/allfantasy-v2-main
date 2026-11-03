// @vitest-environment node
/**
 * Survivor governance gaps (G4): several cross-tribe windows a week, the trade-check failure mode,
 * Rooks vs Vets from other leagues, the played-player lock in a week with no council, and the copy
 * Chimmy and Decision OS build from them. Pure: no database.
 */
import { describe, expect, it } from 'vitest'
import {
  SURVIVOR_GOVERNANCE_DEFAULTS,
  SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS,
  crossTribeWindowPresetsFor,
  readSurvivorGovernanceSettings,
  validateSurvivorGovernancePatch,
  type SurvivorGovernanceSettings,
} from '@/lib/survivor/survivorGovernanceSettings'
import { judgeSurvivorTrade, playedLockLifted, survivorTradeWindowStatus, weekLastGameFinal } from '@/lib/survivor/survivorTradeRules'
import { resolveCastawayExperience } from '@/lib/survivor/survivorExperience'
import { crossTribeWindowsLabel } from '@/lib/survivor/survivorGovernanceCopy'
import { survivorGovernanceGroundingLine } from '@/lib/survivor/survivorGovernanceSummary'
import { deriveSurvivorAttentionSignals } from '@/lib/decision-os/survivorSignals'
import { survivorTradeWindowText } from '@/lib/survivor/survivorTradeWindowText'
import { survivorGovernanceMessages } from '@/lib/survivor/survivorGovernanceUiMessages'
import { isFinalStatus } from '@/lib/social-newsroom/scoreCheck'
import { answerSurvivorRules } from '@/lib/survivor/survivorRulesAnswers'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'

// Tribal Council Tuesday 20:00 ET; November 2026 is EST (UTC-5).
const clock = (iso: string) => ({ tribalDay: 'Tuesday', tribalTime: '20:00', now: new Date(iso) })
const twoWindows: SurvivorGovernanceSettings = { ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true, crossTribeTrades: 'window', crossTribeWindows: SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS }
const preSeason = { currentWeek: 0, firstWeek: 1, tribesLocked: false }

describe('cross-tribe windows: storage', () => {
  it('reads a league saved before windows existed as ONE Tribal-opened window', () => {
    const s = readSurvivorGovernanceSettings({ survivorGovernance: { crossTribeCloseDay: 'Friday', crossTribeCloseTime: '18:30' } })
    expect(s.crossTribeWindows).toEqual([{ opensOn: 'tribal', closeDay: 'Friday', closeTime: '18:30' }])
    expect(readSurvivorGovernanceSettings({}).crossTribeWindows).toEqual([{ opensOn: 'tribal', closeDay: 'Thursday', closeTime: '19:00' }])
  })

  it('reads stored windows, drops invalid ones, and caps at three', () => {
    const s = readSurvivorGovernanceSettings({ survivorGovernance: { crossTribeWindows: [
      { opensOn: 'tribal', closeDay: 'Thursday', closeTime: '20:15' },
      { opensOn: 'time', openDay: 'Friday', openTime: '25:00', closeDay: 'Sunday', closeTime: '13:00' },
      { opensOn: 'time', openDay: 'Friday', openTime: '00:00', closeDay: 'Sunday', closeTime: '13:00' },
      { closeDay: 'Monday', closeTime: '12:00' },
      { closeDay: 'Monday', closeTime: '13:00' },
    ] } })
    expect(s.crossTribeWindows).toHaveLength(3)
    expect(s.crossTribeWindows[1]).toEqual({ opensOn: 'time', openDay: 'Friday', openTime: '00:00', closeDay: 'Sunday', closeTime: '13:00' })
  })

  it('validates a patch strictly and mirrors the first window into the legacy close', () => {
    const ok = validateSurvivorGovernancePatch({ crossTribeWindows: SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)
    expect(ok).toMatchObject({ ok: true, patch: { crossTribeCloseDay: 'Thursday', crossTribeCloseTime: '20:15' } })
    expect(validateSurvivorGovernancePatch({ crossTribeWindows: [] }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateSurvivorGovernancePatch({ crossTribeWindows: Array(4).fill(SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS[0]) }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: false })
    expect(validateSurvivorGovernancePatch({ crossTribeWindows: [{ opensOn: 'time', openDay: 'Sunday', openTime: '13:00', closeDay: 'Sunday', closeTime: '13:00' }] }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: false })
  })

  it('an older client editing the single close keeps the one window in step', () => {
    const r = validateSurvivorGovernancePatch({ crossTribeCloseDay: 'Friday' }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)
    expect(r.ok && r.next.crossTribeWindows).toEqual([{ opensOn: 'tribal', closeDay: 'Friday', closeTime: '19:00' }])
  })

  it('offers the original-league preset for NFL only', () => {
    expect(crossTribeWindowPresetsFor('NFL').map((p) => p.id)).toEqual(['original_nfl', 'single_default'])
    expect(crossTribeWindowPresetsFor('NBA').map((p) => p.id)).toEqual(['single_default'])
  })

  it('the failure mode and cross-league lookup default off and validate', () => {
    expect(readSurvivorGovernanceSettings({})).toMatchObject({ tradeCheckFailureMode: 'allow', experienceCrossLeague: false })
    expect(validateSurvivorGovernancePatch({ tradeCheckFailureMode: 'hold', experienceCrossLeague: true }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: true })
    expect(validateSurvivorGovernancePatch({ tradeCheckFailureMode: 'refuse' }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateSurvivorGovernancePatch({ experienceCrossLeague: 'yes' }, SURVIVOR_GOVERNANCE_DEFAULTS, preSeason)).toMatchObject({ ok: false })
  })
})

describe('cross-tribe windows: the clock', () => {
  it('window 1 is open after Tribal until TNF', () => {
    const s = survivorTradeWindowStatus(twoWindows, clock('2026-11-04T17:00:00Z')) // Wed noon ET
    expect(s.crossTribeOpen).toBe(true)
    expect(s.crossTribeClosesAt?.toISOString()).toBe('2026-11-06T01:15:00.000Z') // Thu 20:15 ET
    expect(s.crossTribeWindow).toEqual({ index: 1, count: 2, closeDay: 'Thursday', closeTime: '20:15' })
  })

  it('closed during TNF, with the next window opening Friday 00:00 ET', () => {
    const s = survivorTradeWindowStatus(twoWindows, clock('2026-11-06T03:00:00Z')) // Thu 22:00 ET
    expect(s).toMatchObject({ crossTribeOpen: false, crossTribeClosesAt: null, crossTribeWindow: null })
    expect(s.crossTribeOpensAt?.toISOString()).toBe('2026-11-06T05:00:00.000Z')
  })

  it('window 2 is open until Sunday 1pm, then closed until the next Tribal', () => {
    const open = survivorTradeWindowStatus(twoWindows, clock('2026-11-07T15:00:00Z')) // Sat 10:00 ET
    expect(open.crossTribeClosesAt?.toISOString()).toBe('2026-11-08T18:00:00.000Z')
    expect(open.crossTribeWindow?.index).toBe(2)
    const closed = survivorTradeWindowStatus(twoWindows, clock('2026-11-09T15:00:00Z')) // Mon 10:00 ET
    expect(closed).toMatchObject({ crossTribeOpen: false, crossTribeOpensAt: null }) // reopens at Tribal
  })

  it('the trade check enforces the same windows', () => {
    const base = { settings: twoWindows, merged: false, tribeByRoster: new Map([['a', 't1'], ['b', 't2']]), players: [], tribalDoneThisWeek: false }
    expect(judgeSurvivorTrade({ ...base, clock: clock('2026-11-07T15:00:00Z') })).toMatchObject({ ok: true, crossTribe: true })
    expect(judgeSurvivorTrade({ ...base, clock: clock('2026-11-06T03:00:00Z') })).toMatchObject({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_CLOSED' })
  })

  it('a single legacy window behaves exactly as before', () => {
    const s = survivorTradeWindowStatus({ ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true }, clock('2026-11-05T17:00:00Z'))
    expect(s.crossTribeClosesAt?.toISOString()).toBe('2026-11-06T00:00:00.000Z')
    expect(s.crossTribeWindow).toMatchObject({ index: 1, count: 1 })
  })
})

describe('copy built from the windows', () => {
  it('names every window, in English and Spanish', () => {
    expect(crossTribeWindowsLabel('en', SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS)).toBe('after Tribal Council until Thursday 8:15 PM ET and from Friday 12:00 AM until Sunday 1:00 PM ET')
    expect(crossTribeWindowsLabel('es', SURVIVOR_ORIGINAL_NFL_TRADE_WINDOWS)).toBe('después del Consejo Tribal hasta el jueves 20:15 ET y desde el viernes 00:00 hasta el domingo 13:00 ET')
  })

  it('Chimmy is grounded with the windows, which one is open, and the failure mode', () => {
    const tw = survivorTradeWindowStatus(twoWindows, clock('2026-11-04T17:00:00Z'))
    const line = survivorGovernanceGroundingLine({ settings: { ...twoWindows, tradeCheckFailureMode: 'hold' }, tradeWindow: tw, currentWeek: 9, myStrikeCount: 0, myAllianceCount: 0, merged: false })
    expect(line).toContain('2 weekly windows')
    expect(line).toContain('(window 1 of 2)')
    expect(line).toContain('held for the commissioner')
    expect(line).toContain("week's last game is final")
  })

  it('Decision OS names the window that closes tonight', () => {
    const tw = survivorTradeWindowStatus(twoWindows, clock('2026-11-05T17:00:00Z')) // Thu noon ET
    const base = { leagueId: 'L1', now: new Date('2026-11-05T17:00:00Z'), activeCastaway: true, tradeWindow: tw, preMerge: true, myStrikeCount: 0, strikeLimit: 2, swap: null }
    expect(deriveSurvivorAttentionSignals(base)[0].title).toMatch(/^Cross-tribe window 1 of 2 closes tonight \(Thu 8:15\sPM ET\)$/)
    expect(deriveSurvivorAttentionSignals({ ...base, language: 'es' })[0].title).toContain('La ventana 1 de 2')
    // One window: the old title, unchanged.
    const single = survivorTradeWindowStatus({ ...SURVIVOR_GOVERNANCE_DEFAULTS, tradeRulesEnabled: true }, clock('2026-11-05T17:00:00Z'))
    expect(deriveSurvivorAttentionSignals({ ...base, tradeWindow: single })[0].title).toBe('Cross-tribe trade window closes tonight')
  })

  it('the card sentence names the open window or the next opening', () => {
    const m = survivorGovernanceMessages.en
    const when = (iso: string) => iso.slice(11, 16)
    expect(survivorTradeWindowText(m, { crossTribeOpen: true, crossTribeClosesAt: '2026-11-06T01:15:00Z', frozen: false, crossTribeWindow: { index: 1, count: 2 } }, when)).toBe('Cross-tribe window 1 of 2 is open until 01:15.')
    expect(survivorTradeWindowText(m, { crossTribeOpen: false, crossTribeClosesAt: null, frozen: false, crossTribeOpensAt: '2026-11-06T05:00:00Z' }, when)).toBe('Cross-tribe trades are closed. The next window opens 05:00.')
    expect(survivorTradeWindowText(m, { crossTribeOpen: false, crossTribeClosesAt: null, frozen: false }, when)).toBe(m.tradeWindowClosed)
  })
})

describe('the played-player lock in a week with no council', () => {
  it('lifts at Tribal, or at the last final in a no-council week, never otherwise', () => {
    expect(playedLockLifted({ tribalDoneThisWeek: true, noCouncilThisWeek: false, weekGamesFinal: null })).toBe(true)
    expect(playedLockLifted({ tribalDoneThisWeek: false, noCouncilThisWeek: true, weekGamesFinal: true })).toBe(true)
    expect(playedLockLifted({ tribalDoneThisWeek: false, noCouncilThisWeek: true, weekGamesFinal: false })).toBe(false)
    // No rows to read: held until the week advances.
    expect(playedLockLifted({ tribalDoneThisWeek: false, noCouncilThisWeek: true, weekGamesFinal: null })).toBe(false)
    // A council week is never lifted by a final.
    expect(playedLockLifted({ tribalDoneThisWeek: false, noCouncilThisWeek: false, weekGamesFinal: true })).toBe(false)
  })

  it('reads the last game from stored rows, across providers', () => {
    const now = new Date('2026-11-10T06:00:00Z')
    const mnf = new Date('2026-11-10T01:15:00Z')
    expect(weekLastGameFinal([], now, isFinalStatus)).toBeNull()
    expect(weekLastGameFinal([{ startTime: new Date('2026-11-08T18:00:00Z'), status: 'final' }, { startTime: mnf, status: 'in_progress' }], now, isFinalStatus)).toBe(false)
    // Two providers, one reports the final a few minutes apart: lifted.
    expect(weekLastGameFinal([{ startTime: mnf, status: 'in_progress' }, { startTime: new Date('2026-11-10T01:20:00Z'), status: 'FT' }], now, isFinalStatus)).toBe(true)
    // A later game not yet kicked off: not over.
    expect(weekLastGameFinal([{ startTime: new Date('2026-11-11T01:00:00Z'), status: null }], now, isFinalStatus)).toBe(false)
  })
})

describe('Rooks vs Vets from other leagues', () => {
  it('manual wins, then this league, then another AllFantasy league, then rookie', () => {
    const r = resolveCastawayExperience(['m', 'h', 'p', 'n'], { m: 'rookie' }, new Set(['m', 'h']), new Set(['m', 'p']))
    expect(r).toEqual({
      m: { experience: 'rookie', source: 'manual' },
      h: { experience: 'veteran', source: 'history' },
      p: { experience: 'veteran', source: 'platform' },
      n: { experience: 'rookie', source: 'default' },
    })
    // Lookup off (the default): nobody is a platform veteran.
    expect(resolveCastawayExperience(['p'], {}, new Set()).p).toEqual({ experience: 'rookie', source: 'default' })
  })
})

describe('Chimmy rules answers (G4)', () => {
  const ctx = { sport: 'NFL', settings: normalizeSurvivorFoundationSettings({}), plan: null, governance: twoWindows }

  it('names both windows and says when the played lock lifts in a week with no council', () => {
    const answer = answerSurvivorRules('trades', ctx)
    expect(answer).toContain('Trades between tribes are open each week after Tribal Council until Thursday 8:15 PM ET and from Friday 12:00 AM until Sunday 1:00 PM ET')
    expect(answer).toContain("In a week with no Tribal Council, that lock lifts once the week's last game is final")
    expect(answer).not.toContain('held for the commissioner')
    expect(answerSurvivorRules('trades', { ...ctx, governance: { ...twoWindows, tradeCheckFailureMode: 'hold' } })).toContain('held for the commissioner to approve or veto')
    const es = answerSurvivorRules('trades', { ...ctx, language: 'es' })
    expect(es).toContain('abren cada semana después del Consejo Tribal hasta el jueves 20:15 ET')
    expect(es).toContain('En una semana sin Consejo Tribal')
  })

  it('one Tribal-opened window keeps the old sentence', () => {
    expect(answerSurvivorRules('trades', { ...ctx, governance: { ...twoWindows, crossTribeWindows: SURVIVOR_GOVERNANCE_DEFAULTS.crossTribeWindows } }))
      .toContain('open after Tribal Council (Tuesday 8:00 PM ET) and close Thursday 7:00 PM ET each week.')
  })
})
