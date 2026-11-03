/**
 * The commissioner trade review save (lib/league-trade-engine/leagueTradeReviewSetting.ts): every trade
 * runtime reads the mode the commissioner picked, and members get a "What changed" card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { League } from '@prisma/client'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.findUnique, update: m.update },
    redraftLeagueExtendedSettings: { updateMany: m.updateMany },
    $transaction: m.transaction,
  },
}))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({ invalidateLeagueDraftCaches: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'boss' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/settingsLockGuard', () => ({ settingsPatchLockedResponse: vi.fn(async () => null) }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: { SETTINGS_CHANGED: 'settings_changed' } }))

import { normalizeTradeReviewChoice, withTradeReviewMode } from '@/lib/league-trade-engine/leagueTradeReviewSetting'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { vetoModeFromReviewType } from '@/lib/redraft/tradeGovernance'
import { tradeReviewMode } from '@/lib/league-rules-explainer/snapshot'
import { updateLeagueSettings } from '@/lib/commissioner-settings/CommissionerSettingsService'
import { groupSettingsChanges } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'
import type { RuleChange } from '@/lib/league-rules-explainer/types'
import { NextRequest } from 'next/server'
import { PATCH as commissionerPatch } from '@/app/api/commissioner/leagues/[leagueId]/route'

const STORED = { trade_review_mode: 'commissioner', commissionerSettings: { approveTrades: true }, commissioner_settings: { approveTrades: true }, keep: 1 }

describe('every runtime reads the saved mode', () => {
  // Panel value → generic engine, redraft runtime, rules popup.
  it.each([
    ['commissioner', 'commissioner', 'commissioner', 'commissioner'],
    ['league_vote', 'league_vote', 'league_vote', 'league_vote'],
    ['instant', 'instant', 'no_veto', 'instant'],
    // "No review": stored as instant, because the redraft runtime reads a stored `none` as commissioner review.
    ['none', 'instant', 'no_veto', 'instant'],
  ])('%s', (choice, engine, redraft, popup) => {
    const mode = normalizeTradeReviewChoice(choice)!
    const settings = withTradeReviewMode(STORED, mode)
    expect(resolveLeagueTradeSettings({ settings } as unknown as League).tradeReviewMode).toBe(engine)
    expect(vetoModeFromReviewType(mode)).toBe(redraft)
    expect(tradeReviewMode(settings)).toBe(popup)
  })

  it('keeps the rest of the settings and both commissioner blocks', () => {
    const settings = withTradeReviewMode(STORED, 'league_vote')
    expect(settings).toMatchObject({
      keep: 1,
      tradeReviewType: 'league_vote',
      commissionerSettings: { approveTrades: true, tradeReviewMode: 'league_vote' },
      commissioner_settings: { approveTrades: true, tradeReviewMode: 'league_vote' },
    })
    expect(withTradeReviewMode({}, 'instant')).not.toHaveProperty('commissioner_settings')
  })

  it('an unknown value is not a mode', () => {
    expect(normalizeTradeReviewChoice('veto_everything')).toBeNull()
    expect(normalizeTradeReviewChoice(null)).toBeNull()
  })
})

const published = (): RuleChange[] => (m.publish.mock.calls.at(-1) as unknown as [{ changes: RuleChange[] }])[0].changes
const card = (changes: RuleChange[], lang: 'en' | 'es') => {
  const [group] = groupSettingsChanges([{ id: 'e1', createdAt: '2026-10-29T12:00:00.000Z', actorUserId: 'boss', changes }], { sport: 'NFL' })
  return (group?.lines ?? []).map((l) => renderChangeLine(l, (k) => translations[lang][k] ?? k, lang)).join(' ')
}

describe('the commissioner settings save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.findUnique.mockResolvedValue({ id: 'L1', name: 'L', sport: 'NFL', season: 2026, leagueSize: 12, rosterSize: 16, starters: null, settings: STORED })
    m.update.mockImplementation((args: unknown) => ({ __update: args }))
    m.updateMany.mockImplementation((args: unknown) => ({ __updateMany: args }))
    m.transaction.mockResolvedValue([{}, { count: 1 }])
  })

  it('writes the league row and the redraft store in one transaction, and publishes the card', async () => {
    await updateLeagueSettings('L1', { tradeReviewType: 'league_vote' }, 'boss')
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [leagueWrite, redraftWrite] = m.transaction.mock.calls[0]![0] as Array<Record<string, any>>
    expect(leagueWrite.__update.data.settings).toMatchObject({ trade_review_mode: 'league_vote', commissionerSettings: { tradeReviewMode: 'league_vote' } })
    expect(redraftWrite.__updateMany).toEqual({ where: { leagueId: 'L1' }, data: { commissionerTradeReviewType: 'league_vote' } })
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', actorUserId: 'boss', section: 'trades' }))
    const changes = published()
    expect(changes).toEqual([{ key: 'tradeReview', before: 'commissioner', after: 'league_vote' }])
    expect(card(changes, 'en')).toBe('Trade review: Commissioner review → League vote — League members can vote to veto a trade before it goes through.')
    expect(card(changes, 'es')).toBe('Revisión de intercambios: Revisión del comisionado → Votación de la liga — Los miembros de la liga pueden votar para vetar un intercambio antes de que se haga efectivo.')
  })

  it('publishes the effective veto rule when the commissioner changes its threshold', async () => {
    await updateLeagueSettings('L1', { vetoThreshold: 6, vetoThresholdMode: 'count' }, 'boss')
    expect(published()).toEqual([{ key: 'vetoThreshold', before: { mode: 'count', value: 4 }, after: { mode: 'count', value: 6 } }])
  })

  it('saving the mode the league already has publishes no change', async () => {
    await updateLeagueSettings('L1', { tradeReviewType: 'commissioner' }, 'boss')
    expect(published()).toEqual([])
  })

  it('a save without trade review is a plain update, as before', async () => {
    await updateLeagueSettings('L1', { description: 'hi' }, 'boss')
    expect(m.transaction).not.toHaveBeenCalled()
    expect(m.update).toHaveBeenCalledTimes(1)
    expect(m.publish).not.toHaveBeenCalled()
  })
})

describe('the commissioner league PATCH route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.findUnique.mockResolvedValue({ settings: STORED })
    m.update.mockImplementation((args: unknown) => ({ __update: args }))
    m.updateMany.mockImplementation((args: unknown) => ({ __updateMany: args }))
    m.transaction.mockResolvedValue([{ id: 'L1', name: 'L', settings: { trade_review_mode: 'instant' }, updatedAt: new Date(0) }, { count: 1 }])
  })

  it('publishes threshold changes from the commissioner PATCH route', async () => {
    const res = await commissionerPatch(new NextRequest('http://x/api/commissioner/leagues/L1', { method: 'PATCH', body: JSON.stringify({ vetoThreshold: 60, vetoThresholdMode: 'percent' }) }), { params: Promise.resolve({ leagueId: 'L1' }) })
    expect(res.status).toBe(200)
    expect(published()).toEqual([{ key: 'vetoThreshold', before: { mode: 'count', value: 4 }, after: { mode: 'percent', value: 60 } }])
  })

  it('takes the same path: one transaction, the card, and the updated row back', async () => {
    const res = await commissionerPatch(
      new NextRequest('http://x/api/commissioner/leagues/L1', { method: 'PATCH', body: JSON.stringify({ tradeReviewType: 'none' }) }),
      { params: Promise.resolve({ leagueId: 'L1' }) },
    )
    expect(res.status).toBe(200)
    expect(m.transaction).toHaveBeenCalledTimes(1)
    const [leagueWrite, redraftWrite] = m.transaction.mock.calls[0]![0] as Array<Record<string, any>>
    expect(leagueWrite.__update.select).toEqual({ id: true, name: true, settings: true, updatedAt: true })
    expect(redraftWrite.__updateMany.data).toEqual({ commissionerTradeReviewType: 'instant' })
    expect(published()).toEqual([{ key: 'tradeReview', before: 'commissioner', after: 'instant' }])
    expect((await res.json()).id).toBe('L1')
  })
})
