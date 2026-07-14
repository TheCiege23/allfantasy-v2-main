import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveAttentionQueueSnapshot } = vi.hoisted(() => ({ mockResolveAttentionQueueSnapshot: vi.fn() }))

vi.mock('@/lib/decision-os/attentionQueue', () => ({ resolveAttentionQueueSnapshot: mockResolveAttentionQueueSnapshot }))

import { analyzeCommissionerDivergence } from '@/lib/shared-services/commissioner/CommissionerDivergenceAnalyzer'
import type { CommissionerAttentionItem } from '@/lib/shared-services/commissioner/types'

function makeMyItem(overrides: Partial<CommissionerAttentionItem> = {}): CommissionerAttentionItem {
  return {
    reasonCode: 'legacy_signal',
    category: 'low_league_health',
    severity: 'critical',
    leagueId: 'league-1',
    affectedManagerIds: [],
    message: 'x',
    evidence: [],
    confidence: 70,
    freshness: 'fresh',
    risk: 'high',
    recommendedAction: null,
    actionAvailableInApp: false,
    providerDeepLink: null,
    permissionRequired: 'commissioner',
    ...overrides,
  }
}

describe('analyzeCommissionerDivergence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports no divergence when both sources agree on signal type and severity', async () => {
    mockResolveAttentionQueueSnapshot.mockResolvedValue({ signals: [{ type: 'low_league_health', severity: 'critical' }] })
    const result = await analyzeCommissionerDivergence({ leagueId: 'league-1', myAttentionItems: [makeMyItem()] })
    expect(result).toEqual([])
  })

  it('flags a missing_signal when the real resolver (with draftDateUtc/financialStatus wired) detects something this service\'s simplified inputs missed', async () => {
    mockResolveAttentionQueueSnapshot.mockResolvedValue({ signals: [{ type: 'draft_approaching', severity: 'medium' }] })
    const result = await analyzeCommissionerDivergence({ leagueId: 'league-1', myAttentionItems: [] })
    expect(result).toEqual([
      { category: 'missing_signal', leagueId: 'league-1', primaryValue: null, legacyValue: 'draft_approaching', notes: expect.any(Array) },
    ])
  })

  it('flags a severity_mismatch when both sources flag the same signal type with different severity', async () => {
    mockResolveAttentionQueueSnapshot.mockResolvedValue({ signals: [{ type: 'low_league_health', severity: 'high' }] })
    const result = await analyzeCommissionerDivergence({ leagueId: 'league-1', myAttentionItems: [makeMyItem({ severity: 'critical' })] })
    expect(result).toEqual([
      { category: 'severity_mismatch', leagueId: 'league-1', primaryValue: 'critical', legacyValue: 'high', notes: expect.any(Array) },
    ])
  })

  it('handles an empty real snapshot cleanly', async () => {
    mockResolveAttentionQueueSnapshot.mockResolvedValue({ signals: [] })
    const result = await analyzeCommissionerDivergence({ leagueId: 'league-1', myAttentionItems: [makeMyItem()] })
    expect(result).toEqual([])
  })

  it('calls resolveAttentionQueueSnapshot for the specific league only', async () => {
    mockResolveAttentionQueueSnapshot.mockResolvedValue({ signals: [] })
    await analyzeCommissionerDivergence({ leagueId: 'league-1', myAttentionItems: [] })
    expect(mockResolveAttentionQueueSnapshot).toHaveBeenCalledWith(['league-1'])
  })
})
