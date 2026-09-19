import { createHmac, timingSafeEqual } from 'node:crypto'

import { resolveAuthSecret } from '@/lib/auth/resolve-auth-secret'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'
import type { ProposalManagerStrategy, ProposalOutcomeSimulation } from '@/lib/league-trade-engine/proposalSuggestions'

const TOKEN_VERSION = 1
const TOKEN_TTL_SECONDS = 30 * 60

export type VerifiedProposalAssetEvidence = {
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount: number | null
  name: string
  value: number | null
  weeklyProjection: number | null
}

export type VerifiedProposalEvidence = {
  version: number
  leagueId: string
  proposerRosterId: string
  assetFingerprint: string
  assets: VerifiedProposalAssetEvidence[]
  managerStrategy: ProposalManagerStrategy
  simulation: ProposalOutcomeSimulation
  modelVersion: string
  valueSource: string
  projectionSource: string
  capturedAt: string
}

function signingKey(): string | null {
  const secret = resolveAuthSecret()
  return secret ? `${secret}:trade-proposal-evidence:v1` : null
}

function normalizedAsset(asset: TradeAssetInput) {
  return {
    itemType: String(asset.itemType),
    itemReference: asset.itemReference ? String(asset.itemReference) : null,
    fromRosterId: String(asset.fromRosterId),
    toRosterId: String(asset.toRosterId),
    faabAmount: asset.itemType === 'faab' ? Math.floor(Number(asset.faabAmount ?? 0)) : null,
  }
}

export function tradeAssetFingerprint(assets: TradeAssetInput[]): string {
  return JSON.stringify(assets.map(normalizedAsset).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
}

export async function signProposalEvidenceToken(input: Omit<VerifiedProposalEvidence, 'version' | 'assetFingerprint'> & {
  tradeAssets: TradeAssetInput[]
}): Promise<string | null> {
  const key = signingKey()
  if (!key) return null
  const payload: VerifiedProposalEvidence = {
    version: TOKEN_VERSION,
    leagueId: input.leagueId,
    proposerRosterId: input.proposerRosterId,
    assetFingerprint: tradeAssetFingerprint(input.tradeAssets),
    assets: input.assets,
    managerStrategy: input.managerStrategy,
    simulation: input.simulation,
    modelVersion: input.modelVersion,
    valueSource: input.valueSource,
    projectionSource: input.projectionSource,
    capturedAt: input.capturedAt,
  }
  const encoded = Buffer.from(JSON.stringify({ evidence: payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', key).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export async function verifyProposalEvidenceToken(input: {
  token: string | null | undefined
  leagueId: string
  proposerRosterId: string
  assets: TradeAssetInput[]
}): Promise<VerifiedProposalEvidence | null> {
  const key = signingKey()
  if (!key || !input.token) return null
  try {
    const [encoded, signature, extra] = input.token.split('.')
    if (!encoded || !signature || extra) return null
    const expected = createHmac('sha256', key).update(encoded).digest('base64url')
    const actualBuffer = Buffer.from(signature, 'base64url')
    const expectedBuffer = Buffer.from(expected, 'base64url')
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { evidence?: VerifiedProposalEvidence; exp?: number }
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null
    const evidence = payload.evidence
    if (!evidence || evidence.version !== TOKEN_VERSION) return null
    if (evidence.leagueId !== input.leagueId || evidence.proposerRosterId !== input.proposerRosterId) return null
    if (evidence.assetFingerprint !== tradeAssetFingerprint(input.assets)) return null
    if (!Array.isArray(evidence.assets) || evidence.assets.length !== input.assets.length) return null
    if (!evidence.simulation || evidence.simulation.available !== true) return null
    return evidence
  } catch {
    return null
  }
}
