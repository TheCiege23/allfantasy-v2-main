/**
 * The Commissioner Hub's waiver panel in Spanish (2026-10-06).
 *
 * Found by the live Spanish check of the hub: the panel read "A manager $46 gastados", "FAAB budgets"
 * aside — `getCommissionerWaiverOversight` writes its reasons, waiver types, run times, result labels
 * and name fallbacks itself, and none of the hub slices had reached it. It now takes the reader's
 * language (default English). The shared outcome-label module keeps its English for its other callers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { untranslatedLiterals } from './helpers/untranslatedLiterals'

const m = vi.hoisted(() => ({
  leagueWaiverSettings: { findUnique: vi.fn() },
  waiverRun: { findFirst: vi.fn() },
  waiverClaim: { count: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m }))

import { classifyResult, getCommissionerWaiverOversight } from '@/lib/core-app/commissionerWaivers'

const NOW = new Date('2026-09-15T12:00:00Z')

beforeEach(() => {
  for (const d of Object.values(m)) for (const fn of Object.values(d)) (fn as ReturnType<typeof vi.fn>).mockReset()
  m.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'rolling', faabBudget: 1000, processingDayOfWeek: 2, processingTimeUtc: '07:00', processingDays: null })
  m.waiverRun.findFirst.mockResolvedValue({
    id: 'run1', runAt: new Date('2026-09-15T07:00:00Z'), runType: 'scheduled', status: 'completed',
    results: [
      { id: 'r1', rosterId: 'ro1', addPlayerId: 'p1', resultType: 'awarded', metadata: null, claim: { faabBid: 62, resultMessage: 'Awarded' } },
      { id: 'r2', rosterId: 'ro2', addPlayerId: 'p1', resultType: 'failed', metadata: { outcomeCode: 'player_no_longer_available', competingRosterId: 'ro1' }, claim: { faabBid: 40, resultMessage: null } },
      { id: 'r3', rosterId: 'ro3', addPlayerId: 'p2', resultType: 'failed', metadata: { outcomeCode: 'insufficient_faab' }, claim: { faabBid: 80, resultMessage: null } },
      { id: 'r4', rosterId: 'ro9', addPlayerId: 'p9', resultType: 'failed', metadata: { outcomeCode: 'blocked_by_lineup_lock' }, claim: { faabBid: 5, resultMessage: null } },
      { id: 'r5', rosterId: 'ro1', addPlayerId: 'p2', resultType: 'failed', metadata: { outcomeCode: 'player_no_longer_available' }, claim: { faabBid: 1, resultMessage: null } },
    ],
  })
  m.waiverClaim.count.mockResolvedValue(2)
  m.roster.findMany.mockResolvedValue([
    { id: 'ro1', platformUserId: 'sl-1', faabRemaining: 810 },
    { id: 'ro3', platformUserId: 'sl-3', faabRemaining: 40 },
    { id: 'ro4', platformUserId: 'sl-4', faabRemaining: 100 },
  ])
  m.leagueTeam.findMany.mockResolvedValue([{ externalId: 'sl-1', ownerName: 'Dre', teamName: 'Dragons' }, { externalId: 'sl-3', ownerName: '', teamName: 'Iron Reserve' }])
  m.appUser.findMany.mockResolvedValue([])
  m.sportsPlayer.findMany.mockResolvedValue([{ id: 'p1', externalId: 'x1', name: 'Tank Bigsby', position: 'RB' }])
})

const load = (language?: string, platform = 'manual') =>
  getCommissionerWaiverOversight({ leagueId: 'L1', platform, role: 'commissioner', now: NOW, ...(language ? { language } : {}) })

describe('commissioner waiver panel', () => {
  it('🛑 the English is exactly what it was without a language', async () => {
    expect(await load('en')).toEqual(await load())
  })

  it('the waiver type reads Spanish', async () => {
    const es = await load('es')
    expect(es.available && es.waiverTypeLabel).toBe('Prioridad rotativa')
  })

  it('🛑 reads Spanish: run time, budgets, results, fallbacks', async () => {
    // A FAAB league, so there are budgets to name.
    m.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 1000, processingDayOfWeek: 2, processingTimeUtc: '07:00', processingDays: null })
    const es = await load('es')
    if (!es.available) throw new Error('expected an available panel')
    expect(es.nextRun).toMatch(/ ET$/)
    expect(es.nextRun).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|AM|PM/)
    expect(es.budgets.map((b) => b.handle)).toEqual(expect.arrayContaining(['Dre', 'Iron Reserve', 'Un mánager']))
    expect(es.lastRun?.rows.map((r) => [r.player, r.manager, r.label])).toEqual([
      ['Tank Bigsby (RB)', 'Dre', 'Ganada'],
      ['Tank Bigsby (RB)', 'Un mánager', 'Superada'],
      ['Jugador no reconocido', 'Iron Reserve', 'Sin FAAB suficiente'],
      ['Jugador no reconocido', 'Un mánager', 'Bloqueada: alineación cerrada'],
      ['Jugador no reconocido', 'Dre', 'No concedida: jugador ya fichado'],
    ])
  })

  it('reads Spanish when the panel has nothing to show', async () => {
    m.leagueWaiverSettings.findUnique.mockResolvedValue(null)
    m.waiverRun.findFirst.mockResolvedValue(null)
    m.waiverClaim.count.mockResolvedValue(0)
    const native = await load('es')
    const imported = await load('es', 'sleeper')
    expect(!native.available && native.reason).toBe('Aún no hay configuración ni procesamientos de reclamos. Cuando se procese el primero, aquí aparecerán los presupuestos y los resultados.')
    expect(!imported.available && imported.reason).toBe(
      'Los reclamos de esta liga se procesan en Sleeper. Las ofertas y los resultados de los reclamos no se comparten con AllFantasy, así que aquí no hay nada que supervisar: gestiónalos en la plataforma.',
    )
  })

  it('budget reasons read Spanish', async () => {
    m.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'rolling', faabBudget: null, processingDayOfWeek: null, processingTimeUtc: null, processingDays: null })
    const r = await load('es')
    expect(r.available && r.budgetsReason).toBe('Esta liga no usa FAAB, así que no hay presupuestos que seguir.')
  })

  it('an unknown outcome code keeps the shared English label rather than vanishing', () => {
    expect(classifyResult('failed', { outcomeCode: 'something_new' }, null, 'es').label).toBe('something new')
  })

  it('🛑 no English sentence in the panel builder lacks its Spanish branch', () => {
    expect(untranslatedLiterals('lib/core-app/commissionerWaivers.ts')).toEqual([])
  })
})
