import { describe, expect, it, vi } from 'vitest'

const rules = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('@/lib/chimmy/tools/myRosterTool', () => ({
  buildMyRosterContext: vi.fn().mockResolvedValue('STARTERS: Jayden Daniels (QB WAS) — Out; Juwan Johnson (TE NO) — Out'),
}))
vi.mock('@/lib/chimmy/waiverGrounding', () => ({ buildWaiverContext: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: vi.fn(async () => rules.value) }))

import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'
import { LINEUP_ACTION_RULES, lineupActionEvidence } from '@/lib/chimmy/lineupActionEvidence'

function context(overrides: { platform: string; bestBallMode: boolean; lastSyncedAt: string | null }) {
  return {
    ok: true,
    context: {
      leagueName: 'KBFL', season: 2026, scoring: {}, roster: {}, matchupPeriod: {}, flags: {}, waiver: {},
      platform: overrides.platform,
      lineupBehavior: { bestBallMode: overrides.bestBallMode, bestBallSettings: null },
      importHealth: { lastSyncedAt: overrides.lastSyncedAt },
    },
  }
}

describe('lineupActionEvidence', () => {
  it('forbids the two KBFL overclaims by name, in a classic lineup league', () => {
    const text = lineupActionEvidence({ platform: 'sleeper', bestBallMode: false, lastSyncedAt: '2026-09-28T00:00:00.000Z' })
    expect(text).toContain('not a live read from Sleeper')
    expect(text).toContain('league last synced 2026-09-28T00:00:00.000Z')
    expect(text).toContain('whether Sleeper auto-substitutes inactive starters')
    expect(text).toContain('Never say categorically that an Out/IR starter "scores zero" or "you take the zero"')
    expect(text).toContain('Never say optimize_my_lineup or any AllFantasy tool shows which moves are LEGAL')
    expect(text).toContain('confirm on Sleeper before acting')
  })

  it('names no provider it does not know', () => {
    const text = lineupActionEvidence({ platform: null, bestBallMode: false })
    expect(text).toContain("the league's host platform")
    expect(text).not.toContain('last synced')
  })

  it('recommends no swap at all in Best Ball, where the lineup is automatic', () => {
    const text = lineupActionEvidence({ platform: 'sleeper', bestBallMode: true })
    expect(text).toContain('chosen automatically')
    expect(text).toContain('Do not tell the user to bench, start or swap anyone')
    expect(text).not.toContain('confirm on')
  })
})

describe('get_my_roster carries the lineup action evidence', () => {
  it('classic imported league: stored starters are not provider-verified', async () => {
    rules.value = context({ platform: 'sleeper', bestBallMode: false, lastSyncedAt: '2026-09-28T00:00:00.000Z' })
    const out = await executeChimmyTool('get_my_roster', {}, { leagueId: 'kbfl', userId: 'viewer' })
    expect(out).toContain('Jayden Daniels')
    expect(out).toContain('LINEUP ACTION EVIDENCE')
    expect(out).toContain(LINEUP_ACTION_RULES)
    expect(out).toContain('not a live read from Sleeper')
  })

  it('imported Best Ball: automatic lineup, no swap advice, permissions still unverified', async () => {
    rules.value = context({ platform: 'sleeper', bestBallMode: true, lastSyncedAt: null })
    const out = await executeChimmyTool('get_my_roster', {}, { leagueId: 'bb', userId: 'viewer' })
    expect(out).toContain('Do not tell the user to bench, start or swap anyone')
    expect(out).toContain('Waiver, trade, and substitution permissions are UNVERIFIED')
    expect(out).not.toContain(LINEUP_ACTION_RULES)
  })

  it('rules unreadable: still warns, without naming a provider', async () => {
    rules.value = { ok: false }
    const out = await executeChimmyTool('get_my_roster', {}, { leagueId: 'x', userId: 'viewer' })
    expect(out).toContain(LINEUP_ACTION_RULES)
    expect(out).toContain("the league's host platform")
  })
})
