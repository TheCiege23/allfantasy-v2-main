import { expect, it, vi } from 'vitest'
const reads = vi.hoisted(() => ({ block: vi.fn(), pending: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/chimmy-trade/tradeChimmyGrounding', () => ({ buildTradeContextForChimmy: reads.block }))
vi.mock('@/lib/chimmy-trade/pendingTradeDecisionGrounding', () => ({ buildPendingTradeDecisionContext: reads.pending }))
vi.mock('@/lib/chimmy-trade/leagueTradeHistoryGrounding', () => ({ buildLeagueTradeHistoryContext: reads.history }))
vi.mock('@/lib/chimmy/tools/myRosterTool', () => ({ buildMyRosterContext: vi.fn().mockResolvedValue('Your verified roster') }))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/chimmy/waiverGrounding', () => ({ buildWaiverContext: vi.fn().mockResolvedValue(null) }))
import { executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

it('reads all trade sources using the authenticated scope, ignoring supplied league ids', async () => {
  reads.block.mockResolvedValue('Trade block evidence')
  reads.pending.mockResolvedValue('Pending evidence')
  reads.history.mockResolvedValue('Completed evidence')
  const result = await executeChimmyTool('get_league_trade_activity', { leagueId: 'other-league', userId: 'other-user' }, { leagueId: 'selected-league', userId: 'viewer' })
  for (const read of Object.values(reads)) expect(read).toHaveBeenCalledWith('selected-league', 'viewer')
  expect(result).toContain('Trade block evidence')
  expect(result).toContain('Pending evidence')
  expect(result).toContain('Completed evidence')
  expect(result).toContain('Your verified roster')
})

it('does not interpret a failed inbox read as no trades', async () => {
  reads.pending.mockRejectedValue(new Error('unavailable'))
  const result = await executeChimmyTool('get_league_trade_activity', {}, { leagueId: 'selected-league', userId: 'viewer' })
  expect(result).toContain('Incoming proposals: No verified data available')
})
