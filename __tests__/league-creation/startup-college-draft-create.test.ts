/**
 * League creation for Devy and C2C: two startup drafts by default, one when merged
 * (lib/draft-defaults/startupCollegeDraft.ts). Same transaction harness as playoff-start-week-column-json.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn(), create: vi.fn() },
    survivorExileLeague: { findUnique: vi.fn(), create: vi.fn() },
  },
  survivorConfig: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: m.survivorConfig }))
vi.mock('@/lib/survivor/SurvivorAuditLog', () => ({ appendSurvivorAudit: vi.fn() }))

import { createCanonicalLeagueInTransaction } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'

type Obj = Record<string, any>

function buildTx() {
  let n = 0
  const ok = (id: string) => vi.fn().mockResolvedValue({ id })
  return {
    userProfile: { findUnique: vi.fn().mockResolvedValue({ displayName: 'C', xpLevel: 1, legacyCareerLevel: null }) },
    appUser: { findUnique: vi.fn().mockResolvedValue({ username: 'c', email: 'c@test.local' }) },
    league: { findFirst: vi.fn().mockResolvedValue(null), create: ok('league-1'), update: ok('league-1') },
    leagueSettings: { create: ok('ls') },
    leagueWaiverSettings: { create: ok('lws') },
    scoringSettingsSnapshot: { create: ok('ss') },
    guillotineLeagueConfig: { upsert: ok('g') },
    idpLeagueConfig: { upsert: ok('i') },
    dynastyLeagueConfig: { upsert: ok('d') },
    devyLeagueConfig: { upsert: ok('dv') },
    c2CLeagueConfig: { upsert: ok('c') },
    redraftLeagueExtendedSettings: { create: ok('e') },
    redraftLeagueDraftProfile: { create: ok('dp') },
    redraftLeagueHomepageState: { create: ok('h') },
    redraftLeagueSportIntegration: { create: ok('si') },
    redraftLeagueChatRoom: { create: ok('chat') },
    bestBallContest: { create: ok('bbc') },
    roster: {
      create: vi.fn().mockImplementation(async (args?: Obj) => {
        n += 1
        return { id: `roster-${n}`, platformUserId: args?.data?.platformUserId ?? `p-${n}` }
      }),
    },
    leagueTeam: { create: vi.fn().mockImplementation(async () => ({ id: `team-${++n}` })) },
    redraftLeagueMember: { create: ok('m') },
    leagueEntrySlot: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    draftSession: { create: ok('ds') },
    leagueInvite: { create: vi.fn().mockResolvedValue({ id: 'inv', token: 'T' }) },
    findLeagueListing: { upsert: ok('fl') },
  }
}


const PRESET: Record<string, string> = { NFL: 'fb_half_ppr', NBA: 'nba_points', NCAAF: 'ncaaf_half_ppr', NCAAB: 'ncaab_points' }

async function create(concept: string, sport: string, conceptSetup: Obj = {}) {
  const tx = buildTx()
  const body = {
    concept, sport, teamCount: 12, draftType: 'snake', scoringPreset: PRESET[sport],
    leagueName: 'Startup drafts', language: 'en', tradeReviewMode: 'commissioner', conceptSetup,
  } as any
  await createCanonicalLeagueInTransaction(tx as any, 'u1', body, runPresetEngine({ ...body, commissionerId: 'u1' }))
  const session = tx.draftSession.create.mock.calls[0][0].data as Obj
  const planWrite = tx.league.update.mock.calls.find(([a]: [Obj]) => a.data?.settings?.startupCollegeDraft)
  const c2cRow = tx.c2CLeagueConfig.upsert.mock.calls[0]?.[0]?.create as Obj | undefined
  return { session, plan: planWrite ? (planWrite[0].data.settings.startupCollegeDraft as Obj) : null, c2cRow }
}

describe('a new Devy / C2C league gets a pro draft, then a college draft (owner rule, 2026-11-22)', () => {
  it('NFL Devy: the first draft is pro-only and the college draft is queued', async () => {
    const { session, plan } = await create('devy', 'NFL')
    expect(session.draftModeLabel).toBe('startup_pro')
    expect(session.devyConfig).toMatchObject({ enabled: true, devyRounds: [] })
    expect(plan).toMatchObject({ mode: 'separate', format: 'devy', status: 'pending' })
    expect(plan!.collegeRounds).toBeGreaterThan(0)
  })

  it('NFL C2C: the college rounds leave the first draft, and the C2C settings say two drafts', async () => {
    const { session, plan, c2cRow } = await create('c2c', 'NFL')
    expect(session).toMatchObject({ draftModeLabel: 'startup_pro', c2cConfig: { enabled: true, collegeRounds: [] } })
    expect(plan).toMatchObject({ mode: 'separate', format: 'c2c', status: 'pending', mergedCollegeRounds: 2 })
    expect(c2cRow).toMatchObject({ startupFormat: 'separate', mergedStartupDraft: false, separateStartupCollegeDraft: true })
  })

  it('merged on: one draft exactly as before, recorded as merged', async () => {
    const { session, plan, c2cRow } = await create('c2c', 'NFL', { mergedCollegeDraft: true })
    expect(session.draftModeLabel).toBeUndefined()
    expect(session.c2cConfig).toMatchObject({ enabled: true, collegeRounds: [session.rounds - 1, session.rounds] })
    expect(plan).toMatchObject({ mode: 'merged' })
    expect(c2cRow).toMatchObject({ startupFormat: 'merged', mergedStartupDraft: true })
  })

  it('a college-sport C2C league keeps its one draft: its pool does not separate the two', async () => {
    const { session, plan, c2cRow } = await create('c2c', 'NCAAF')
    expect(session.draftModeLabel).toBeUndefined()
    expect(plan).toBeNull()
    expect(c2cRow).toMatchObject({ startupFormat: 'merged', mergedStartupDraft: true })
  })

  it('a dynasty league is untouched', async () => {
    const { session, plan } = await create('dynasty', 'NFL')
    expect(session.draftModeLabel).toBeUndefined()
    expect(plan).toBeNull()
  })
})
