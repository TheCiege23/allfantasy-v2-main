/**
 * Draft OS contract (2026-11-20: the feed has a reader).
 *
 * The draft engine's rules — slots, IDP, superflex / 2QB, scoring — are read through Draft OS's 60-second cache
 * (`readDraftRosterRules`) instead of being re-assembled on every poll. ONE derivation (`deriveDraftRosterRules`),
 * cached; and when the cache cannot answer, the same derivation runs live, so a cache problem is never a draft
 * problem. The domain still declares no source for the draft STATE or the POOL, which change on every pick.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const isIdpLeague = vi.fn(async () => false)
const getRosterTemplate = vi.fn(async () => ({
  slots: [
    { slotName: 'QB', starterCount: 1 },
    { slotName: 'RB', starterCount: 2 },
    { slotName: 'WR', starterCount: 2 },
    { slotName: 'SUPER_FLEX', starterCount: 1 },
    { slotName: 'BN', starterCount: 0 },
  ],
}))
const leagueFindUnique = vi.fn(async () => ({ sport: 'NFL', settings: { scoring_settings: { rec: 1 } }, starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'SUPER_FLEX'] }))
vi.mock('@/lib/idp', () => ({ isIdpLeague }))
vi.mock('@/lib/multi-sport/RosterTemplateService', () => ({ getRosterTemplate }))
// An in-memory `domain_os_facts`, so the reader the ENGINE uses can be shown to go through the cache.
const factRows = new Map<string, Record<string, unknown>>()
const factKey = (w: { domain_kind_level_scopeKey: Record<string, string> }) => Object.values(w.domain_kind_level_scopeKey).join('/')
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    domainOsFacts: {
      findUnique: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> } }) => factRows.get(factKey(a.where)) ?? null),
      upsert: vi.fn(async (a: { where: { domain_kind_level_scopeKey: Record<string, string> }; create: Record<string, unknown> }) => {
        factRows.set(factKey(a.where), { ...a.create, capturedAt: new Date() })
        return a.create
      }),
    },
  },
}))

const { createDraftOsLoaders, draftOsSources, draftRosterRulesSource } = await import('@/lib/decision-os/draft-os')
const { deriveDraftRosterRules, readDraftRosterRules, resolveDraftRosterShape, resolveLeagueScoringFlags } = await import(
  '@/lib/shared-services/draft/DraftContextAssembler'
)
const { OS_SCOPE_LEVELS } = await import('@/lib/decision-os/domain-os')

const LEAGUE = { sport: 'NFL', settings: { scoring_settings: { rec: 1 } }, starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'SUPER_FLEX'] }

function memoryStore() {
  const rows = new Map<string, { facts: unknown; capturedAt: Date }>()
  const key = (a: { domain: string; kind: string; level: string; scopeKey: string }) => `${a.domain}/${a.kind}/${a.level}/${a.scopeKey}`
  return {
    rows,
    store: {
      read: vi.fn(async (a: { domain: string; kind: string; level: string; scopeKey: string; ttlMs: number }) => {
        const row = rows.get(key(a))
        if (!row || Date.now() - row.capturedAt.getTime() > a.ttlMs) return null
        return { facts: row.facts, level: a.level, confidence: null, sampleSize: null, capturedAt: row.capturedAt, ageMs: 0 }
      }),
      write: vi.fn(async (a: { domain: string; kind: string; level: string; scopeKey: string; facts: unknown }) => {
        rows.set(key(a), { facts: a.facts, capturedAt: new Date() })
        return true
      }),
    },
  }
}

beforeEach(() => {
  factRows.clear()
  isIdpLeague.mockClear()
  getRosterTemplate.mockClear()
  leagueFindUnique.mockClear()
})

describe('Draft OS: the draft engine’s rules, cached for a minute', () => {
  it('declares exactly ONE source — the rules — and none for the board or the pool', () => {
    expect(draftOsSources).toHaveLength(1)
    expect(draftOsSources[0]!.kind).toBe('rosterRules')
    const loaders = createDraftOsLoaders({ store: memoryStore().store as never })
    expect(Object.keys(loaders).sort()).toEqual(['drainOutcomes', 'loadRosterRules'])
  })

  it('is league-scoped and lives 60 seconds, not six hours', () => {
    expect(draftRosterRulesSource.level).toBe('league')
    expect(OS_SCOPE_LEVELS).toContain(draftRosterRulesSource.level)
    expect(draftRosterRulesSource.ttlMs).toBe(60 * 1000)
    expect(draftRosterRulesSource.scopeKey({ leagueId: 'lg1' })).toBe('lg1')
    expect(draftRosterRulesSource.sport({ leagueId: 'lg1', sport: 'nba' })).toBe('NBA')
  })

  it('derives what the engine read inline: template slots, IDP, superflex and scoring', async () => {
    const rules = await deriveDraftRosterRules('lg1', LEAGUE)
    // The same flags the engine computed inline, from the same helper — one derivation, not a second.
    expect(rules).toEqual({
      rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'SUPER_FLEX'],
      idp: false,
      ...resolveLeagueScoringFlags(LEAGUE.settings, LEAGUE.starters),
    })
    expect(rules).toMatchObject({ isSF: true, is2QB: false })
    expect(getRosterTemplate).toHaveBeenCalledWith('NFL', 'standard', 'lg1')
  })

  it('an IDP league still gets the IDP template (Phase 32 holds inside the derivation)', async () => {
    isIdpLeague.mockResolvedValueOnce(true)
    expect((await deriveDraftRosterRules('lg1', LEAGUE))?.idp).toBe(true)
    expect(getRosterTemplate).toHaveBeenCalledWith('NFL', 'IDP', 'lg1')
  })

  it('a second read inside the minute is served from the cache — no IDP lookup, no template read', async () => {
    const { store } = memoryStore()
    const loaders = createDraftOsLoaders({ store: store as never })
    const first = await loaders.loadRosterRules({ leagueId: 'lg1', sport: 'NFL' })
    expect(loaders.drainOutcomes()).toMatchObject({ rosterRules: { servedFrom: 'live' } })
    const callsAfterFirst = getRosterTemplate.mock.calls.length
    const second = await loaders.loadRosterRules({ leagueId: 'lg1', sport: 'NFL' })
    expect(loaders.drainOutcomes()).toMatchObject({ rosterRules: { servedFrom: 'store' } })
    expect(second).toEqual(first)
    expect(getRosterTemplate.mock.calls.length).toBe(callsAfterFirst)
  })

  it('a dead store degrades to the live derivation and never throws', async () => {
    const dead = {
      read: vi.fn(async () => {
        throw new Error('relation "domain_os_facts" does not exist')
      }),
      write: vi.fn(async () => {
        throw new Error('relation "domain_os_facts" does not exist')
      }),
    }
    const loaders = createDraftOsLoaders({ store: dead as never })
    await expect(loaders.loadRosterRules({ leagueId: 'lg1' })).resolves.toMatchObject({ isSF: true })
  })

  it('the reader the engine uses returns the same rules as the live derivation', async () => {
    const live = await deriveDraftRosterRules('lg1', LEAGUE)
    await expect(readDraftRosterRules('lg1', LEAGUE)).resolves.toEqual(live)
  })

  it('the engine’s reader goes through the cache: a league polled twice in a minute reads its template once', async () => {
    const a = await readDraftRosterRules('lg-poll', LEAGUE)
    const b = await readDraftRosterRules('lg-poll', LEAGUE)
    expect(b).toEqual(a)
    expect(getRosterTemplate).toHaveBeenCalledTimes(1)
    expect(isIdpLeague).toHaveBeenCalledTimes(1)
  })

  it('🛑 when the cache cannot answer, the reader derives live from the league it was handed', async () => {
    // The cache's own derive reads the league itself; make that read find nothing.
    leagueFindUnique.mockResolvedValueOnce(null as never)
    const rules = await readDraftRosterRules('lg1', LEAGUE)
    expect(rules.rosterSlots).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'SUPER_FLEX'])
  })

  it('the queue reorder reads the same rules', async () => {
    await expect(resolveDraftRosterShape('lg1', LEAGUE)).resolves.toEqual({
      rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'SUPER_FLEX'],
      isSF: true,
      is2QB: false,
    })
  })
})
