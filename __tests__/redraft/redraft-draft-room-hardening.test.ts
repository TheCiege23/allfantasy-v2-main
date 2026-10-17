import { describe, expect, it } from 'vitest'

/**
 * lib/redraft-draft-room (mode contract, pick-error contract, personas, War Room suggestions,
 * grounded Chimmy draft context) was deleted as dead code on 2026-09-29 — nothing outside this
 * test imported it. Its sections went with it; the commissioner AI persona contract below tests a
 * live module and stays.
 */

import {
  buildApiResponse,
  parseCommissionerAiManagers,
} from '@/lib/commissioner-ai-draft-manager/CommissionerAiDraftManagerService'

describe('commissioner AI persona assignment contract', () => {
  it('preserves npcDraftPersonality and favorite team in assigned AI teams', () => {
    const blob = parseCommissionerAiManagers({
      assignments: [
        {
          rosterId: 'r1',
          aiStyle: 'BALANCED',
          tradeAggression: 'medium',
          active: true,
          npcDraftPersonality: 'HOMER_TEAM_FAVORITE',
          npcFavoriteTeamAbbr: 'DAL',
        },
      ],
      tradeRules: {
        allowOutbound: true,
        allowInbound: true,
        blockAiToAi: true,
        proposalCooldownSeconds: 90,
        maxProposalsPerRound: 4,
        acceptConfidenceMin: 0.58,
      },
    })
    const response = buildApiResponse(blob, [{ slot: 1, rosterId: 'r1', displayName: 'Orphan Team' }])
    expect(response.assignedAiTeams[0]).toMatchObject({
      teamId: 'r1',
      npcDraftPersonality: 'HOMER_TEAM_FAVORITE',
      npcFavoriteTeamAbbr: 'DAL',
    })
  })
})
