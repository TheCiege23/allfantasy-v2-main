import { describe, expect, it } from 'vitest'

import { resolveInjuryContext } from '@/lib/decision-os/world/injuryEnrichedWorld'
import { projectPlayerMetadata } from '@/lib/decision-os/world/playerMetadata'
import { indexRowsByLeagueId } from '@/lib/decision-os/world/rowKeys'

/*
 * 🛑 Sleeper 8394 is Percy Butler; Rolling Insights 8394 is Rome Odunze (2026-10-11). The crosswalk
 * stamps Odunze's RI row with HIS Sleeper id, and the readers keyed every row by `externalId` too —
 * so that row claimed `8394` and Butler read Odunze's status.
 */
const ODUNZE_SLEEPER = '11621'
const odunzeRi = { externalId: '8394', sleeperId: ODUNZE_SLEEPER, source: 'rolling_insights', status: 'INACT', name: 'Rome Odunze', position: 'WR', team: 'CHI' }
const butler = { externalId: 'sleeper:8394', sleeperId: '8394', source: 'sleeper', status: 'Active', name: 'Percy Butler', position: 'S', team: 'WAS' }
const odunzeSleeper = { externalId: `sleeper:${ODUNZE_SLEEPER}`, sleeperId: ODUNZE_SLEEPER, source: 'sleeper', status: 'Active', name: 'Rome Odunze', position: 'WR', team: 'CHI' }

describe('indexRowsByLeagueId', () => {
  it('a provider row carrying a Sleeper id never claims its own provider number', () => {
    const idx = indexRowsByLeagueId([odunzeRi, butler])
    expect(idx.get('8394')?.name).toBe('Percy Butler')
    expect(idx.get(ODUNZE_SLEEPER)?.name).toBe('Rome Odunze')
  })

  it("Sleeper's own row wins its key whatever the order", () => {
    expect(indexRowsByLeagueId([odunzeRi, odunzeSleeper]).get(ODUNZE_SLEEPER)?.source).toBe('sleeper')
  })

  it('a row with no Sleeper identity is keyed by its own externalId', () => {
    const native = { externalId: 'tsdb_34146370', sleeperId: null, source: 'thesportsdb', status: null }
    expect(indexRowsByLeagueId([native]).get('tsdb_34146370')).toBe(native)
  })
})

describe('the readers', () => {
  it('resolveInjuryContext gives Percy Butler his own row', async () => {
    const rows = [odunzeRi, butler].map((r) => ({ ...r, fetchedAt: null, expiresAt: null, updatedAt: null }))
    // The designation comes from the injury feed, asked about the identity on the row each id resolves to.
    const asked: Array<{ key: string; name: unknown; rosterStatus: unknown }> = []
    const res = await resolveInjuryContext('NFL', ['8394', ODUNZE_SLEEPER], {
      loadRows: async () => rows,
      resolveDesignations: async ({ players }) => {
        for (const p of players) asked.push({ key: p.key, name: p.name, rosterStatus: p.rosterStatus ?? null })
        return new Map([['8394', { status: 'Questionable', source: 'injury_feed' as const, fact: null }]])
      },
    })
    expect(asked).toEqual([
      { key: '8394', name: 'Percy Butler', rosterStatus: 'Active' },
      // Odunze's id resolves to his RI row; another provider's `status` is never offered as a roster status.
      { key: ODUNZE_SLEEPER, name: 'Rome Odunze', rosterStatus: null },
    ])
    expect(res.byId.get('8394')?.status).toBe('Questionable')
  })

  it('projectPlayerMetadata names Percy Butler, not Rome Odunze', () => {
    const res = projectPlayerMetadata([odunzeRi, butler], ['8394'])
    expect(res.byId.get('8394')?.name).toBe('Percy Butler')
  })
})
