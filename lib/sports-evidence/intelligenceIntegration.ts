import 'server-only'
/**
 * Fantasy OS Phase 5E-h — shared certified Intelligence integration service.
 *
 * Server-only. Supplies certified FACTUAL grounding (freshness, provider health, schedule/game context, evidence
 * availability) to the customer-facing intelligence layer (League / Manager / Commissioner / Platform
 * Intelligence, Coach, Chimmy) and operator observability. It COMPOSES the existing runtime primitives and the
 * certified matchup game reads — it does NOT reimplement any reasoning, recommendation, confidence, scoring, or
 * ranking logic, and it NEVER invents intelligence. It exposes only verified facts; injuries / projections /
 * statistics / availability / rankings / predictions / psychology / intent / retention are honestly unavailable.
 */
import { SportsRuntimeStore } from '@/lib/sports-data-gateway/runtime/store'
import { buildCertifiedFreshness } from '@/lib/sports-data-gateway/runtime/freshnessPure'
import { PROVIDER_INVENTORY } from '@/lib/sports-data-gateway/inventory'
import { CertifiedMatchupIntegrationService, type CertifiedMatchupContext } from './matchupIntegration'

/**
 * Facts the certified plane does NOT provide to the intelligence layer — always explicitly unavailable, never
 * inferred. (Phase 5F-a: certified player `statistics` now EXIST as a data capability but are not yet a wired
 * intelligence display input; injuries/projections/availability remain genuinely absent.)
 */
export const INTELLIGENCE_UNSUPPORTED = {
  injuries: 'unavailable',
  projections: 'unavailable',
  playerAvailability: 'unavailable',
  rankings: 'unavailable',
  predictions: 'unavailable',
  managerPsychology: 'unavailable',
  commissionerIntent: 'unavailable',
  retentionLikelihood: 'unavailable',
} as const

/**
 * Capabilities that are actually implemented as certified snapshots vs listed-but-not-certified. Honest truth.
 * Phase 5F-a: `statistics` (certified player-game box scores from ESPN) is now a real certified capability —
 * player identities within it may be `unresolved` (no cross-provider athlete map yet), and it is NOT yet a
 * scoring input (the scoring engine still uses PlayerWeeklyScore / PlayerGameLogCache).
 */
export const CERTIFIED_CAPABILITY_TRUTH = {
  certified: ['players', 'rosters', 'transactions', 'games', 'draft_data', 'statistics'],
  notCertified: ['injuries', 'projections', 'live_scores', 'play_by_play', 'depth_charts', 'news', 'weather'],
} as const

export type SnapshotFreshnessEntry = { capability: string; available: boolean; freshnessStatus: string; snapshotVersion: string | null; provider: string | null; generatedAt: string | null }
export type ProviderHealthEntry = { provider: string; sports: string[]; status: string; capabilities: string[]; lastVerifiedAt: string | null }
export type EvidenceAvailability = { certifiedCapabilities: string[]; notCertifiedCapabilities: string[]; unsupported: typeof INTELLIGENCE_UNSUPPORTED }

export type IntelligenceSportsContext = {
  subsystem: string
  generatedAt: string
  gameContext: CertifiedMatchupContext | null
  snapshotFreshness: SnapshotFreshnessEntry[]
  evidenceAvailability: EvidenceAvailability
  unsupported: typeof INTELLIGENCE_UNSUPPORTED
}

export class CertifiedIntelligenceIntegrationService {
  constructor(private store = new SportsRuntimeStore(), private matchup = new CertifiedMatchupIntegrationService(store)) {}

  /** Per-capability certified snapshot freshness (probes the season/global-scoped capabilities). Fail-safe. */
  async describeSnapshotFreshness(input: { season: string; week: string | null; now?: Date }): Promise<SnapshotFreshnessEntry[]> {
    const now = input.now ?? new Date()
    const probes: Array<{ capability: string; scopeRef: string | null }> = [
      { capability: 'games', scopeRef: `${input.season}-w${input.week ?? 'x'}` },
      { capability: 'players', scopeRef: null },
    ]
    const out: SnapshotFreshnessEntry[] = []
    for (const p of probes) {
      try {
        const meta = await this.store.getCertifiedSnapshotMeta('NFL', p.capability, p.scopeRef)
        const freshness = buildCertifiedFreshness(meta, now)
        out.push({ capability: p.capability, available: !!meta, freshnessStatus: freshness.freshnessStatus, snapshotVersion: meta?.version ?? null, provider: meta?.provider ?? null, generatedAt: meta?.generatedAt ?? null })
      } catch {
        out.push({ capability: p.capability, available: false, freshnessStatus: 'unavailable', snapshotVersion: null, provider: null, generatedAt: null })
      }
    }
    return out
  }

  /** Sanitized provider health from the audited inventory — provenance only, NEVER env var names or credentials. */
  describeProviderHealth(): ProviderHealthEntry[] {
    return PROVIDER_INVENTORY.map((p) => ({ provider: p.provider, sports: p.sports, status: p.status, capabilities: p.capabilities, lastVerifiedAt: p.lastVerifiedAt }))
  }

  /** Which certified capabilities actually exist vs are listed-but-not-implemented, plus the unsupported map. */
  describeEvidenceAvailability(): EvidenceAvailability {
    return { certifiedCapabilities: [...CERTIFIED_CAPABILITY_TRUTH.certified], notCertifiedCapabilities: [...CERTIFIED_CAPABILITY_TRUTH.notCertified], unsupported: INTELLIGENCE_UNSUPPORTED }
  }

  /** Core informational bundle for a customer-facing surface. Facts only — never a recommendation/ranking/score. */
  private async buildContext(subsystem: string, input: { season: string; week: string | null; includeGameContext?: boolean; now?: Date }): Promise<IntelligenceSportsContext> {
    const gameContext = input.includeGameContext !== false ? await this.matchup.describeMatchupGameStates({ season: input.season, week: input.week, now: input.now }).catch(() => null) : null
    const snapshotFreshness = await this.describeSnapshotFreshness(input)
    return { subsystem, generatedAt: new Date().toISOString(), gameContext, snapshotFreshness, evidenceAvailability: this.describeEvidenceAvailability(), unsupported: INTELLIGENCE_UNSUPPORTED }
  }

  describeLeagueSportsContext(input: { season: string; week: string | null; now?: Date }) { return this.buildContext('league_intelligence', input) }
  describeManagerSportsContext(input: { season: string; week: string | null; now?: Date }) { return this.buildContext('manager_intelligence', input) }
  describeCommissionerSportsContext(input: { season: string; week: string | null; now?: Date }) { return this.buildContext('commissioner_intelligence', input) }
  describeCoachSportsContext(input: { season: string; week: string | null; now?: Date }) { return this.buildContext('coach', input) }

  /** Platform / operator observability bundle: provider coverage + freshness + evidence availability. No credentials. */
  async describePlatformSportsContext(input: { season: string; week: string | null; now?: Date }): Promise<IntelligenceSportsContext & { providerHealth: ProviderHealthEntry[] }> {
    const base = await this.buildContext('platform_intelligence', { ...input, includeGameContext: false })
    return { ...base, providerHealth: this.describeProviderHealth() }
  }
}
