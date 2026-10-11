import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/upstream-apis', () => ({ fetchNewsContext: async () => ({ items: [] }) }))

import { applyInjuryStatuses } from '@/lib/redraft/rosterInjuryStatus'
import { resolvePlayerInjuryNewsBatch } from '@/lib/news-injury-aggregation/resolveBatch'

/*
 * 🛑 `SportsInjury.playerId` IS EACH PROVIDER'S OWN ID (2026-10-11).
 *
 * Sleeper 8394 is Percy Butler; Rolling Insights 8394 is Rome Odunze. Two readers joined a roster's
 * id straight onto `playerId` and took the match on trust. `/api/redraft/roster` did it for 5,515
 * live roster rows, every one the wrong person ("Brock Purdy" <- Jaylon Carlies, Out). An id match
 * now counts only when the name agrees.
 */

const ODUNZE_RI = { sport: 'NFL', playerId: '8394', playerName: 'Rome Odunze', status: 'Out' }

describe('applyInjuryStatuses — /api/redraft/roster', () => {
  it('🛑 an id match naming someone else is ignored', () => {
    const [p] = applyInjuryStatuses([{ sport: 'NFL', playerId: '8394', playerName: 'Percy Butler' }], [ODUNZE_RI])
    expect((p as { injuryStatus?: string }).injuryStatus).toBeUndefined()
  })

  it('an id match naming the same player still applies, across spelling noise', () => {
    const [p] = applyInjuryStatuses(
      [{ sport: 'NFL', playerId: '8394', playerName: 'Percy Butler' }],
      [{ sport: 'NFL', playerId: '8394', playerName: 'percy  butler', status: 'Out' }],
    )
    expect((p as { injuryStatus?: string }).injuryStatus).toBe('Out')
  })

  it('a player with no id is still matched by name, and the newest row wins', () => {
    const [p] = applyInjuryStatuses(
      [{ sport: 'NFL', playerId: null, playerName: 'Rome Odunze' }],
      [ODUNZE_RI, { ...ODUNZE_RI, status: 'Questionable' }],
    )
    expect((p as { injuryStatus?: string }).injuryStatus).toBe('Out')
  })
})

describe('resolvePlayerInjuryNewsBatch — id-matched rows must name the player', () => {
  function fakePrisma(sportsInjuries: Array<Record<string, unknown>>, statusEvents: Array<Record<string, unknown>> = []) {
    return {
      injuryReportRecord: { findMany: async () => [] },
      sportsInjury: { findMany: async () => sportsInjuries },
      playerNewsRecord: { findMany: async () => [] },
      playerStatusEvent: { findMany: async () => statusEvents },
    } as never
  }
  const si = (playerName: string) => ({
    externalId: `ri-${playerName}`, playerId: '8394', playerName, status: 'Out', source: 'rolling_insights',
    description: null, updatedAt: new Date(),
  })
  const ev = (playerName: string) => ({
    externalId: '8394', playerName, newStatus: 'Out', source: 'sleeper', detectedAt: new Date(),
    statusReason: null, sourceRawText: null, confidence: 0.9,
  })
  const run = (prisma: never) =>
    resolvePlayerInjuryNewsBatch({ prisma, sport: 'NFL', skipNewsContext: true, players: [{ playerName: 'Percy Butler', playerId: '8394' }] })

  it('🛑 an injury row reached only by a colliding id is not attached', async () => {
    const out = await run(fakePrisma([si('Rome Odunze')], [ev('Rome Odunze')]))
    expect(out.get('percy butler')).toBeNull()
  })

  it('the same id naming the same player is attached (control)', async () => {
    const out = await run(fakePrisma([si('Percy Butler')]))
    expect(out.get('percy butler')).not.toBeNull()
  })
})
