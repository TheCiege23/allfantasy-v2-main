/**
 * What a commissioner can change, and when.
 *
 * Measured on e5f038706:
 *   - sport, season, team count, format and dynasty were patchable at any time (the lifecycle gate
 *     ran only for a request that named a section, and one of the two write paths had no gate);
 *   - after the draft a league sits in `post_draft` for its whole first season — nothing moves it
 *     to `in_season` — and that state refused every waiver claim and the Trades/Playoffs/AI tabs;
 *   - PUT /league-settings replaced the league's whole settings JSON with defaults + the request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  startedDraft: null as null | { id: string },
  season: null as null | { id: string },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: vi.fn(async () => db.startedDraft) },
    redraftSeason: { findFirst: vi.fn(async () => db.season) },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { changedStructuralKeys, structuralPatchRefusal } from '@/lib/league/structuralSettingsLock'
import { isActionAllowed } from '@/server/services/leagueLifecycleService'

const current = { sport: 'NFL', season: 2026, leagueSize: 12, leagueType: 'redraft', isDynasty: false }

beforeEach(() => {
  db.startedDraft = null
  db.season = null
})

describe('structural settings lock', () => {
  it('sees only a real change', () => {
    expect(changedStructuralKeys({ sport: 'NFL', leagueSize: 12 }, current)).toEqual([])
    expect(changedStructuralKeys({ sport: 'NBA', leagueSize: 14, name: 'x' }, current)).toEqual(['sport', 'leagueSize'])
  })

  it('allows it before the draft starts', async () => {
    expect(await structuralPatchRefusal('L', { sport: 'NBA' }, current)).toBeNull()
  })

  it('refuses it once the draft has started', async () => {
    db.startedDraft = { id: 'ds' }
    expect(await structuralPatchRefusal('L', { sport: 'NBA', isDynasty: true }, current)).toMatch(
      /sport, isDynasty cannot change after the draft has started/,
    )
  })

  it('refuses it once a season exists', async () => {
    db.season = { id: 's' }
    expect(await structuralPatchRefusal('L', { leagueSize: 14 }, current)).toMatch(/once the season exists/)
  })

  it('never refuses a patch that changes nothing structural', async () => {
    db.startedDraft = { id: 'ds' }
    expect(await structuralPatchRefusal('L', { name: 'New name', leagueSize: 12 }, current)).toBeNull()
  })
})

describe('after the draft, the league plays', () => {
  it.each(['waiver_claim_submit', 'roster_edit', 'trade_act', 'settings_edit_trades', 'settings_edit_playoffs'] as const)(
    'post_draft allows %s',
    (action) => {
      expect(isActionAllowed(action, 'post_draft')).toBe(true)
    },
  )

  it('post_draft still refuses a draft pick', () => {
    expect(isActionAllowed('draft_pick', 'post_draft')).toBe(false)
  })
})

describe('the whole-settings overwrite is retired', () => {
  it('PUT /league-settings answers 410 and writes nothing', async () => {
    const { PUT } = await import('@/app/api/commissioner/leagues/[leagueId]/league-settings/route')
    const res = await PUT(new Request('http://x', { method: 'PUT', body: '{}' }) as never, { params: { leagueId: 'L' } })
    expect(res.status).toBe(410)
  })
})
