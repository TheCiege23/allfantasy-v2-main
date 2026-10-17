import { expect, it, vi } from 'vitest'

vi.mock('@/lib/chimmy/tools/myRosterTool', () => ({ buildMyRosterContext: vi.fn().mockResolvedValue('ROSTER: QB 4, RB 7, WR 8, TE 6') }))
vi.mock('@/lib/chimmy/waiverGrounding', () => ({ buildWaiverContext: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: vi.fn().mockResolvedValue({
  ok: true,
  context: {
    leagueName: 'Imported Best Ball', season: 2026, scoring: {}, roster: {}, matchupPeriod: {},
    lineupBehavior: { bestBallMode: true, bestBallSettings: null }, flags: {}, waiver: {},
    importHealth: { lastSyncedAt: null },
  },
}) }))

import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

it('warns the answering model that imported Best Ball transaction permissions are unverified', async () => {
  const result = await executeChimmyTool('get_my_roster', {}, { leagueId: 'selected-league', userId: 'viewer' })
  expect(result).toContain('ROSTER: QB 4, RB 7, WR 8, TE 6')
  expect(result).toContain('Automatic scoring lineup is confirmed')
  expect(result).toContain('Waiver, trade, and substitution permissions are UNVERIFIED')
  expect(result).toContain('Prior chat answers and generic Best Ball defaults are not evidence')
})
