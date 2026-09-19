import { afterEach, describe, expect, it } from 'vitest'

import {
  signProposalEvidenceToken,
  tradeAssetFingerprint,
  verifyProposalEvidenceToken,
} from '@/lib/league-trade-engine/proposalEvidenceToken'

const assets = [
  { itemType: 'player' as const, itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' },
  { itemType: 'faab' as const, fromRosterId: 'r2', toRosterId: 'r1', faabAmount: 12 },
]

afterEach(() => {
  delete process.env.NEXTAUTH_SECRET
  delete process.env.AUTH_SECRET
})

describe('signed proposal evidence', () => {
  it('verifies only for the exact league, proposer, and asset package', async () => {
    process.env.NEXTAUTH_SECRET = 'proposal-evidence-test-secret'
    const token = await signProposalEvidenceToken({
      leagueId: 'l1',
      proposerRosterId: 'r1',
      tradeAssets: assets,
      assets: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: null, name: 'Player One', value: 5200, weeklyProjection: 16.2 },
        { itemType: 'faab', itemReference: null, fromRosterId: 'r2', toRosterId: 'r1', faabAmount: 12, name: '$12 FAAB', value: 240, weeklyProjection: null },
      ],
      managerStrategy: 'win-now',
      simulation: { available: true, metric: 'playoff', beforePct: 41, afterPct: 48, deltaPct: 7, iterations: 5000, reason: null },
      modelVersion: 'league-proposal-v3',
      valueSource: 'FantasyCalc · redraft · 1QB', projectionSource: 'league-scored projection feed · 2026 week 2',
      capturedAt: '2026-09-19T16:00:00.000Z',
    })
    expect(token).toBeTruthy()
    await expect(verifyProposalEvidenceToken({ token, leagueId: 'l1', proposerRosterId: 'r1', assets }))
      .resolves.toMatchObject({ assetFingerprint: tradeAssetFingerprint(assets), modelVersion: 'league-proposal-v3' })
    await expect(verifyProposalEvidenceToken({ token, leagueId: 'wrong', proposerRosterId: 'r1', assets })).resolves.toBeNull()
    await expect(verifyProposalEvidenceToken({ token, leagueId: 'l1', proposerRosterId: 'r1', assets: [assets[0]!] })).resolves.toBeNull()
  })

  it('rejects tampered tokens and fails closed when signing is unavailable', async () => {
    process.env.AUTH_SECRET = 'proposal-evidence-test-secret'
    const token = await signProposalEvidenceToken({
      leagueId: 'l1', proposerRosterId: 'r1', tradeAssets: assets, assets: [], managerStrategy: 'balanced',
      simulation: { available: true, metric: 'survival', beforePct: 70, afterPct: 74, deltaPct: 4, iterations: 1000, reason: null },
      modelVersion: 'league-proposal-v3', valueSource: 'FantasyCalc', projectionSource: 'feed', capturedAt: '2026-09-19T16:00:00.000Z',
    })
    expect(token).toBeTruthy()
    await expect(verifyProposalEvidenceToken({ token: `${token}x`, leagueId: 'l1', proposerRosterId: 'r1', assets })).resolves.toBeNull()
    delete process.env.AUTH_SECRET
    await expect(signProposalEvidenceToken({
      leagueId: 'l1', proposerRosterId: 'r1', tradeAssets: assets, assets: [], managerStrategy: 'balanced',
      simulation: { available: true, metric: 'playoff', beforePct: 1, afterPct: 2, deltaPct: 1, iterations: 1, reason: null },
      modelVersion: 'v', valueSource: 'source', projectionSource: 'source', capturedAt: '2026-09-19T16:00:00.000Z',
    })).resolves.toBeNull()
  })
})
