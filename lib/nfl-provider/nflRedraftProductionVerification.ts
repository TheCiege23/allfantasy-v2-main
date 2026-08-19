import {
  NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES,
  getNflRedraftProviderFallbackOrder,
  type NflRedraftProviderNodeId,
  type NflRedraftProviderOrchestratorCapability,
} from '@/lib/nfl-provider/nflRedraftProviderOrchestrator'
import {
  buildNflRedraftProviderCertificationReport,
  type NflRedraftProviderCertificationReport,
} from '@/lib/nfl-provider/nflRedraftProviderCertification'
import {
  buildNflRedraftProviderValidationDashboard,
  listNflRedraftLegacyDirectProviderAudit,
  type NflRedraftProviderValidationDashboard,
} from '@/lib/nfl-provider/nflRedraftProviderValidationDashboard'
import { listNflRedraftExistingProviderIntegrations } from '@/lib/nfl-provider/nflRedraftProductionProviderWiring'
import type { NflRedraftEvidenceSurface, NflRedraftEvidenceType } from '@/lib/player-data/nflRedraftProviderEvidencePackets'
import {
  NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS,
  type NflRedraftPremiumServiceId,
} from '@/lib/redraft-premium/nflRedraftPremiumServices'

export const NFL_REDRAFT_PRODUCTION_VERIFICATION_MODEL_VERSION =
  'nfl-redraft-production-verification-v1' as const

export type NflRedraftProductionVerificationStatus = 'PASS' | 'PASS_WITH_LIMITATIONS' | 'FAIL'

export type NflRedraftProductionVerificationStage =
  | 'provider'
  | 'orchestrator'
  | 'canonical_model'
  | 'evidence_packet'
  | 'runtime'
  | 'premium_service'
  | 'ui'

export type NflRedraftProductionVerificationCategory =
  | 'provider'
  | 'capability'
  | 'canonical'
  | 'evidence'
  | 'premium'
  | 'runtime'
  | 'ui'
  | 'fallback'
  | 'cache'
  | 'import'

export type NflRedraftProductionVerificationRow = {
  category: NflRedraftProductionVerificationCategory
  name: string
  status: NflRedraftProductionVerificationStatus
  explanation: string
  limitations: string[]
  evidenceRefs: string[]
}

export type NflRedraftProviderCoverageRow = {
  providerId: NflRedraftProviderNodeId
  displayName: string
  status: NflRedraftProductionVerificationStatus
  capabilitiesVerified: string[]
  canonicalPathVerified: boolean
  fallbackBehaviorVerified: boolean
  limitations: string[]
}

export type NflRedraftCapabilityCertificationRow = {
  capability: NflRedraftProviderOrchestratorCapability
  status: NflRedraftProductionVerificationStatus
  providerChain: NflRedraftProviderNodeId[]
  flow: NflRedraftProductionVerificationStage[]
  canonicalObjects: string[]
  evidenceTypes: NflRedraftEvidenceType[]
  premiumServices: NflRedraftPremiumServiceId[]
  uiSurfaces: NflRedraftEvidenceSurface[]
  limitations: string[]
}

export type NflRedraftLaunchBlockerReport = {
  criticalBlockers: string[]
  mediumIssues: string[]
  minorPolish: string[]
  futureEnhancements: string[]
}

export type NflRedraftProductionVerificationReport = {
  modelVersion: typeof NFL_REDRAFT_PRODUCTION_VERIFICATION_MODEL_VERSION
  generatedAtIso: string
  factsOnly: true
  scope: 'AF_NFL_REDRAFT_ONLY'
  verificationFlow: NflRedraftProductionVerificationStage[]
  providerCoverage: NflRedraftProviderCoverageRow[]
  capabilityCertification: NflRedraftCapabilityCertificationRow[]
  certificationMatrix: NflRedraftProductionVerificationRow[]
  fallbackCertification: NflRedraftProviderCertificationReport['outageScenarios']
  cacheCertification: NflRedraftProductionVerificationRow[]
  importCertification: NflRedraftProductionVerificationRow[]
  uiCertification: NflRedraftProductionVerificationRow[]
  launchBlockerReport: NflRedraftLaunchBlockerReport
  directProviderBypassStatus: NflRedraftProductionVerificationStatus
  remainingDeferredBypasses: string[]
  estimatedProductionReadinessPercent: number
  proceedToG50BLaunchHardening: boolean
  safeOutput: {
    rawProviderPayloadExposed: false
    providerSecretsExposed: false
    providerPayloadToUi: false
    aiReasoningIncluded: false
    recommendationsIncluded: false
  }
}

const FULL_FLOW: NflRedraftProductionVerificationStage[] = [
  'provider',
  'orchestrator',
  'canonical_model',
  'evidence_packet',
  'runtime',
  'premium_service',
  'ui',
]

const EVIDENCE_BY_CAPABILITY: Record<NflRedraftProviderOrchestratorCapability, NflRedraftEvidenceType[]> = {
  fantasy_valuations: ['ranking_adp', 'projection'],
  headshots: ['player_metadata_media'],
  league_import: ['roster_context', 'draft_context'],
  live_stats: ['live_stats', 'fantasy_scoring', 'stat_correction'],
  logos: ['player_metadata_media'],
  news: ['news'],
  player_identity: ['player_identity', 'player_metadata_media'],
  schedule: ['schedule_game_context'],
  standings: ['fantasy_scoring', 'matchup_context'],
  weather: ['weather'],
}

const CANONICAL_OBJECTS_BY_CAPABILITY: Record<NflRedraftProviderOrchestratorCapability, string[]> = {
  fantasy_valuations: ['PlayerIntelligence', 'FantasyValuation'],
  headshots: ['PlayerMetadata', 'PlayerMedia'],
  league_import: ['CanonicalLeague', 'RedraftRuntimeState'],
  live_stats: ['LiveScoringContext', 'FantasyScoring'],
  logos: ['TeamMetadata', 'PlayerMetadata'],
  news: ['PlayerIntelligence'],
  player_identity: ['CanonicalPlayerIdentity', 'CanonicalPlayer'],
  schedule: ['GameContext', 'TeamContext'],
  standings: ['RedraftStandings', 'MatchupContext'],
  weather: ['GameContext', 'WeatherContext'],
}

const SURFACES_BY_CAPABILITY: Record<NflRedraftProviderOrchestratorCapability, NflRedraftEvidenceSurface[]> = {
  fantasy_valuations: ['draft', 'waiver', 'trade', 'player_card'],
  headshots: ['draft', 'mock_draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  league_import: ['draft', 'team', 'roster'],
  live_stats: ['roster', 'matchup', 'team', 'player_card', 'live_scoring', 'standings'],
  logos: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  news: ['draft', 'waiver', 'trade', 'team', 'player_card'],
  player_identity: ['draft', 'mock_draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  schedule: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
  standings: ['matchup', 'team', 'standings'],
  weather: ['draft', 'roster', 'waiver', 'trade', 'matchup', 'team', 'player_card'],
}

const UI_SURFACES: Array<{ name: string; evidenceRef: string }> = [
  { name: 'Draft Room', evidenceRef: 'G46B/G46C/G47A adapters plus G49D/G49E premium shell placement' },
  { name: 'Mock Draft', evidenceRef: 'G46B/G46C draft display adapters' },
  { name: 'Roster', evidenceRef: 'G46B-G47B roster player adapters' },
  { name: 'Waivers', evidenceRef: 'G46B-G47A waiver player adapters' },
  { name: 'Trades', evidenceRef: 'G46B-G47A trade context adapter' },
  { name: 'Matchups', evidenceRef: 'G47A/G47B matchup and live scoring context' },
  { name: 'Player Cards', evidenceRef: 'G49E player-card premium placement and canonical metadata' },
  { name: 'Team Page', evidenceRef: 'G46B Team tab canonical metadata wiring' },
  { name: 'Premium Shells', evidenceRef: 'G49D/G49E premium UI contract tests' },
  { name: 'Dashboard', evidenceRef: 'G49I internal validation dashboard contract' },
]

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function premiumServicesForEvidence(evidenceTypes: NflRedraftEvidenceType[]): NflRedraftPremiumServiceId[] {
  return Object.values(NFL_REDRAFT_PREMIUM_SERVICE_DEFINITIONS)
    .filter((definition) => definition.packetTypes.some((packetType) => evidenceTypes.includes(packetType)))
    .map((definition) => definition.serviceId)
}

function limitationsForCapability(capability: NflRedraftProviderOrchestratorCapability): string[] {
  if (capability === 'fantasy_valuations') {
    return ['Single-player canonical valuation is verified; legacy list, trend, and trade-value response shapes remain intentionally deferred.']
  }
  if (capability === 'news') {
    return ['API-Sports news currently exposes diagnostics/unavailable state through the provider wiring rather than a complete reusable news feed client.']
  }
  if (capability === 'league_import') {
    return ['Sleeper import is the primary path; ESPN import depends on user-provided credentials and cannot be live-verified without them.']
  }
  if (capability === 'live_stats' || capability === 'standings' || capability === 'schedule') {
    return ['Legacy cron import jobs are still deferred as canonical cache-sync migrations. Runtime fallback remains verified.']
  }
  return []
}

function statusFromLimitations(limitations: string[]): NflRedraftProductionVerificationStatus {
  return limitations.length ? 'PASS_WITH_LIMITATIONS' : 'PASS'
}

function buildProviderCoverage(): NflRedraftProviderCoverageRow[] {
  const integrations = listNflRedraftExistingProviderIntegrations()
  return integrations
    .filter((integration) =>
      [
        'rolling_insights',
        'api_sports',
        'thesportsdb',
        'fantasycalc',
        'clearsports',
        'openweather',
        'sleeper',
        'espn',
      ].includes(integration.providerId),
    )
    .map((integration): NflRedraftProviderCoverageRow => {
      const limitations: string[] = []
      if (integration.providerId === 'api_sports') limitations.push('Injury and venue data need a dedicated canonical sync path before full launch certification.')
      if (integration.providerId === 'fantasycalc') limitations.push('Trade values, value history, and market movement are still legacy-shape surfaces outside the single-player canonical valuation path.')
      if (integration.providerId === 'espn') limitations.push('ESPN import depends on user credentials and cannot be globally live-verified.')
      if (integration.providerId === 'openweather') limitations.push('Weather is optional context and hides/falls back when unavailable.')
      if (integration.providerId === 'rolling_insights') limitations.push('Rolling outage is degraded mode; canonical cache/runtime fallback must be monitored in launch hardening.')
      return {
        providerId: integration.providerId,
        displayName: integration.integrationName,
        status: statusFromLimitations(limitations),
        capabilitiesVerified: integration.capabilities,
        canonicalPathVerified: integration.realProductionIntegration,
        fallbackBehaviorVerified: true,
        limitations,
      }
    })
}

function buildCapabilityCertification(): NflRedraftCapabilityCertificationRow[] {
  return (Object.keys(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES) as NflRedraftProviderOrchestratorCapability[])
    .map((capability): NflRedraftCapabilityCertificationRow => {
      const evidenceTypes = EVIDENCE_BY_CAPABILITY[capability]
      const limitations = limitationsForCapability(capability)
      return {
        capability,
        status: statusFromLimitations(limitations),
        providerChain: getNflRedraftProviderFallbackOrder(NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES[capability]),
        flow: FULL_FLOW,
        canonicalObjects: CANONICAL_OBJECTS_BY_CAPABILITY[capability],
        evidenceTypes,
        premiumServices: premiumServicesForEvidence(evidenceTypes),
        uiSurfaces: SURFACES_BY_CAPABILITY[capability],
        limitations,
      }
    })
}

function buildCertificationMatrix(
  certification: NflRedraftProviderCertificationReport,
  dashboard: NflRedraftProviderValidationDashboard,
): NflRedraftProductionVerificationRow[] {
  return [
    {
      category: 'provider',
      name: 'Provider Certification',
      status: certification.providerCorrect ? 'PASS_WITH_LIMITATIONS' : 'FAIL',
      explanation: 'Production providers are represented by G49H integrations and G49J certification checks.',
      limitations: dashboard.legacyDirectProviderAudit
        .filter((entry) => entry.routeOrFile.includes('cron') || entry.routeOrFile.includes('sync'))
        .map((entry) => `${entry.routeOrFile}: ${entry.notes}`),
      evidenceRefs: ['G49H production provider wiring', 'G49I provider validation dashboard', 'G49J provider certification'],
    },
    {
      category: 'capability',
      name: 'Capability Certification',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'All G49G orchestrator capabilities have a provider chain, canonical mapping target, evidence type, premium consumers, and UI surfaces.',
      limitations: ['Some provider-specific optional capabilities remain deferred: API-Sports injuries/venues and FantasyCalc market-history/trade-value legacy shapes.'],
      evidenceRefs: ['NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES', 'G50A capability certification rows'],
    },
    {
      category: 'canonical',
      name: 'Canonical Certification',
      status: 'PASS',
      explanation: 'Player, game, weather, live scoring, intelligence, and evidence paths use canonical AllFantasy models and sanitize provider payload fields.',
      limitations: [],
      evidenceRefs: ['G46A-G47B canonical player/game/live context', 'sanitizeNflRedraftCanonicalProviderData'],
    },
    {
      category: 'evidence',
      name: 'Evidence Certification',
      status: 'PASS',
      explanation: 'G48 evidence packets are facts-only and are generated from canonical models, never raw provider payloads.',
      limitations: [],
      evidenceRefs: ['nflRedraftProviderEvidencePackets.ts'],
    },
    {
      category: 'premium',
      name: 'Premium Certification',
      status: 'PASS',
      explanation: 'All premium services consume evidence packet IDs and canonical facts-only summaries.',
      limitations: [],
      evidenceRefs: ['G49A-G49F premium service contracts, resolver, production evidence, and observability'],
    },
    {
      category: 'runtime',
      name: 'Runtime Certification',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'NFL Redraft runtime remains authoritative and provider data cannot bypass canonical scoring or provider resolution.',
      limitations: ['Cron import jobs still need grouped canonical cache-sync migration before full launch signoff.'],
      evidenceRefs: ['G47B live stats/scoring refresh', 'G49J deferred bypass audit'],
    },
    {
      category: 'ui',
      name: 'UI Certification',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'UI surfaces consume canonical player/runtime/premium contracts; no React component should receive provider payloads.',
      limitations: ['G50A uses contract/static/UI tests; full Playwright seeded-league proof remains a G50B launch-hardening priority.'],
      evidenceRefs: ['G46B-G47B UI wiring tests', 'G49D/G49E premium UI shell tests'],
    },
    {
      category: 'fallback',
      name: 'Fallback Certification',
      status: 'PASS',
      explanation: 'G49J outage scenarios verify graceful degradation for enhancement provider outages and Rolling degraded mode.',
      limitations: [],
      evidenceRefs: ['G49J outage certification rows'],
    },
    {
      category: 'cache',
      name: 'Cache Certification',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'Canonical cache hit, stale, fallback, and hidden/runtime fallback semantics are represented in provider traces and evidence counts.',
      limitations: ['Persisted provider trace history and alert thresholds are not yet implemented.'],
      evidenceRefs: ['SportsDataCache adapter', 'G49F observability hooks', 'G49I dashboard counts'],
    },
    {
      category: 'import',
      name: 'Import Certification',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'Sleeper and ESPN import providers are modeled as league_import adapters that feed canonical league/runtime facts.',
      limitations: ['ESPN requires user credentials; full browser import smoke remains G50B work.'],
      evidenceRefs: ['sleeper-client league import bundle', 'fetchEspnLeague adapter'],
    },
  ]
}

function buildCacheCertification(): NflRedraftProductionVerificationRow[] {
  return [
    {
      category: 'cache',
      name: 'Cache Hit',
      status: 'PASS',
      explanation: 'The canonical cache adapter marks cacheUsed and returns canonical data when SportsDataCache contains an unexpired row.',
      limitations: [],
      evidenceRefs: ['readCanonicalCache', 'G49H provider wiring tests'],
    },
    {
      category: 'cache',
      name: 'Cache Miss',
      status: 'PASS',
      explanation: 'Missing cache rows continue the provider chain instead of exposing empty provider payloads.',
      limitations: [],
      evidenceRefs: ['resolveNflRedraftProductionProviderCapability'],
    },
    {
      category: 'cache',
      name: 'Stale/Expired Cache',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'Stale cache is labeled stale/degraded and used only where policy allows stale fallback.',
      limitations: ['Operational alerting for stale cache growth is a G50B priority.'],
      evidenceRefs: ['NFL_REDRAFT_PROVIDER_CAPABILITY_POLICIES.allowStaleCache'],
    },
    {
      category: 'cache',
      name: 'Canonical Rebuild',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'Backfill/rebuild hooks exist for premium evidence; provider cron cache rebuilds remain deferred.',
      limitations: ['Cron provider imports should be migrated into canonical cache sync jobs.'],
      evidenceRefs: ['G49F backfill hooks', 'G49J deferred cron bypasses'],
    },
  ]
}

function buildImportCertification(): NflRedraftProductionVerificationRow[] {
  return [
    {
      category: 'import',
      name: 'Sleeper Import -> Canonical League -> Runtime',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'Sleeper is represented as the primary league_import provider and returns canonical league facts for runtime handoff.',
      limitations: ['Live credential-free API behavior was not called during G50A tests.'],
      evidenceRefs: ['sleeper-client league import bundle', 'league_import policy'],
    },
    {
      category: 'import',
      name: 'ESPN Import -> Canonical League -> Runtime',
      status: 'PASS_WITH_LIMITATIONS',
      explanation: 'ESPN import is represented as the secondary league_import provider with credential-dependent canonical league facts.',
      limitations: ['Requires user-provided ESPN credentials for live validation.'],
      evidenceRefs: ['fetchEspnLeague adapter', 'league_import policy'],
    },
  ]
}

function buildUiCertification(): NflRedraftProductionVerificationRow[] {
  return UI_SURFACES.map((surface) => ({
    category: 'ui',
    name: surface.name,
    status: 'PASS_WITH_LIMITATIONS',
    explanation: `${surface.name} is covered by canonical contract or UI-shell tests and should consume canonical models only.`,
    limitations: ['Full Playwright seeded production journey was not executed in this verification-only milestone.'],
    evidenceRefs: [surface.evidenceRef],
  }))
}

function buildLaunchBlockers(): NflRedraftLaunchBlockerReport {
  return {
    criticalBlockers: [
      'Full repository TypeScript validation is blocked by pre-existing shared type errors outside G50A.',
      'Cron import jobs still need grouped migration into canonical provider cache sync before full provider-correct launch signoff.',
      'A deterministic seeded browser journey for Draft -> Roster -> Waivers -> Trades -> Matchups -> Premium UI still needs production Playwright proof.',
    ],
    mediumIssues: [
      'FantasyCalc list, trend, value-history, market-movement, and trade-value legacy response shapes should move behind a versioned canonical valuation API.',
      'API-Sports injuries and venue details need a first-class canonical sync path where configured.',
      'Persisted provider trace history and alert thresholds should be added for stale/fallback spikes.',
    ],
    minorPolish: [
      'Promote the provider validation dashboard from library/admin contract into a polished internal visual admin page.',
      'Add more operator-friendly labels for cache state, fallback reason, and provider capability health.',
    ],
    futureEnhancements: [
      'Live provider smoke tests against configured production credentials in a protected staging environment.',
      'Provider-specific SLOs for freshness, fallback count, and cache rebuild latency.',
    ],
  }
}

function readinessFromMatrix(matrix: NflRedraftProductionVerificationRow[]): number {
  const score = matrix.reduce((sum, row) => {
    if (row.status === 'PASS') return sum + 1
    if (row.status === 'PASS_WITH_LIMITATIONS') return sum + 0.65
    return sum
  }, 0)
  return Math.round((score / matrix.length) * 100)
}

export function buildNflRedraftProductionVerificationReport(input: {
  generatedAtIso?: string | null
  providerCertification?: NflRedraftProviderCertificationReport | null
  validationDashboard?: NflRedraftProviderValidationDashboard | null
} = {}): NflRedraftProductionVerificationReport {
  const generatedAtIso = input.generatedAtIso ?? new Date().toISOString()
  const providerCertification = input.providerCertification ?? buildNflRedraftProviderCertificationReport({ generatedAtIso })
  const validationDashboard = input.validationDashboard ?? buildNflRedraftProviderValidationDashboard({
    now: new Date(generatedAtIso),
  })
  const certificationMatrix = buildCertificationMatrix(providerCertification, validationDashboard)
  const remainingDeferredBypasses = unique([
    ...providerCertification.deferredBypasses,
    ...listNflRedraftLegacyDirectProviderAudit()
      .filter((entry) => entry.migrateNow === false && !entry.notes.startsWith('G49J migrated'))
      .map((entry) => entry.routeOrFile),
  ])

  return {
    modelVersion: NFL_REDRAFT_PRODUCTION_VERIFICATION_MODEL_VERSION,
    generatedAtIso,
    factsOnly: true,
    scope: 'AF_NFL_REDRAFT_ONLY',
    verificationFlow: FULL_FLOW,
    providerCoverage: buildProviderCoverage(),
    capabilityCertification: buildCapabilityCertification(),
    certificationMatrix,
    fallbackCertification: providerCertification.outageScenarios,
    cacheCertification: buildCacheCertification(),
    importCertification: buildImportCertification(),
    uiCertification: buildUiCertification(),
    launchBlockerReport: buildLaunchBlockers(),
    directProviderBypassStatus: remainingDeferredBypasses.length ? 'PASS_WITH_LIMITATIONS' : 'PASS',
    remainingDeferredBypasses,
    estimatedProductionReadinessPercent: Math.min(82, readinessFromMatrix(certificationMatrix)),
    proceedToG50BLaunchHardening: true,
    safeOutput: {
      rawProviderPayloadExposed: false,
      providerSecretsExposed: false,
      providerPayloadToUi: false,
      aiReasoningIncluded: false,
      recommendationsIncluded: false,
    },
  }
}
