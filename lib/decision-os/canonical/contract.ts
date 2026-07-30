/**
 * Decision OS — CANONICAL DECISION CONTRACT (Phase 3A).
 *
 * ONE authoritative, versioned envelope every AllFantasy "brain" (Decision OS, Commissioner OS, Manager OS,
 * Chimmy Intelligence, draft/trade/waiver/lineup intelligence, AF Legacy, Best Ball, Salary Cap, C2C, Devy — for
 * NFL, NCAAF, and every future sport/platform) maps its outputs into. Those systems produce different decision
 * CATEGORIES, but share this identity + envelope so a single dashboard / Chimmy / portfolio layer can consume
 * them uniformly in later phases.
 *
 * PURE + PROVIDER-AGNOSTIC. This module is types + constants only — no I/O, no `server-only`, safe to import
 * anywhere (tests, adapters, future client-safe projections). It performs NO persistence, provider calls, token
 * charges, or freshness minting. Provider-specific ids appear ONLY inside `source` refs; the canonical decision
 * otherwise uses AllFantasy canonical identities.
 *
 * Design rule: typed fields for stable, business-critical concepts; constrained JSON (`evidence`, `extensions`)
 * only for category-specific data that cannot yet be normalized. Do NOT push business-critical facts into
 * `extensions` — add a typed field instead.
 */
import type { DecisionCategory } from './taxonomy'

/** Bump to invalidate/renumber the whole envelope when its shape changes incompatibly. */
export const CANONICAL_DECISION_CONTRACT_VERSION = '1' as const

/** What the decision is about. */
export type DecisionScope = 'user' | 'league' | 'team' | 'player' | 'matchup' | 'commissioner' | 'portfolio'

/** Who the decision is for. */
export type DecisionAudience = 'manager' | 'commissioner' | 'dual_role'

/** Lifecycle of a persisted decision. `active` is the only surfaceable state; the rest are terminal/hidden. */
export type DecisionStatus = 'active' | 'superseded' | 'suppressed' | 'expired' | 'resolved'

export type DecisionSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

/** How time-sensitive the recommended action is. */
export type DecisionUrgency = 'none' | 'this_week' | 'today' | 'now'

/** Data-freshness state of the underlying evidence at generation time. */
export type DecisionFreshnessState = 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown'

/** Entitlement CLASSIFICATION only — never used to gate or charge in Phase 3A. Mirrors the product's access
 *  tiers (aligns with `EntitlementMode` + commissioner gating) so a future gate can act on it. */
export type DecisionEntitlementTier = 'free' | 'subscription' | 'tokens' | 'commissioner'

/** Token-cost CLASSIFICATION only — declares how a decision WOULD be billed if a future phase charged for it.
 *  Phase 3A never reserves, finalizes, or releases tokens. Aligns with the no-charge classifier in
 *  `lib/ai/aiBillingDecision.ts`. */
export type DecisionTokenCostClass = 'free' | 'included' | 'token_billable' | 'unknown'

/** Provider-agnostic source platform. Launch set is a hint, not a closed set (extensible for new providers). */
export type DecisionSourcePlatform = 'sleeper' | 'espn' | 'yahoo' | 'fantrax' | 'allfantasy' | (string & {})

/** Sport key. NFL + NCAAF are first-class launch sports; the envelope must not encode NFL-only assumptions.
 *  Open string (validated against a known set in `validate.ts`) so new sports need no envelope change. */
export type DecisionSport = 'NFL' | 'NCAAF' | 'NBA' | 'MLB' | 'NHL' | 'NCAAB' | 'SOCCER' | (string & {})

/** A grounded evidence reference. Never fabricate — omit or leave the array empty when evidence is absent. */
export type DecisionEvidenceRef = {
  id: string
  /** e.g. 'roster' | 'matchup' | 'injury' | 'transaction' | 'snapshot' | 'projection' | 'standings'. */
  kind: string
  label: string
  sourceType?: string | null
  sourceId?: string | null
  observedAt?: string | null
  /** Read-only deep link back to the source platform, when supported. AF never writes via this link. */
  url?: string | null
  trust?: 'high' | 'medium' | 'low' | 'unverified'
}

/** Reference to the imported/source platform. The ONLY place provider-specific ids belong. Read-only. */
export type DecisionSourceRef = {
  platform: DecisionSourcePlatform
  platformLeagueId?: string | null
  /** Provider-specific entity id (team/roster/player as the provider names it). Never a write target. */
  platformEntityId?: string | null
  /** Verified read-only deep link into the source platform (open-in-Sleeper/ESPN/Yahoo). */
  deepLinkUrl?: string | null
  snapshotId?: string | null
  snapshotAt?: string | null
}

/** A player the decision concerns, keyed by AllFantasy canonical `Player.id` where available. */
export type DecisionPlayerRef = {
  canonicalPlayerId?: string | null
  name?: string | null
  position?: string | null
  teamAbbr?: string | null
}

/**
 * Whether — and against what — a decision could ever be executed. Phase 3A NEVER executes anything (persistence
 * only); this is a forward-compat CLASSIFICATION so the universal contract stays accurate rather than declaring
 * every decision permanently external/read-only.
 *  - `external_read_only`  : concerns an imported platform (Sleeper/ESPN/Yahoo/Fantrax/MFL/Fleaflicker). AF may
 *                            analyze + deep-link but NEVER writes to it. `sourceReadOnly` is always true.
 *  - `advisory_only`       : pure advice with no execution target, regardless of source. `sourceReadOnly` true.
 *  - `native_actionable_dormant` : native AllFantasy source that a LATER phase MAY execute internally (never an
 *                            imported platform). Dormant + non-executable in Phase 3A. `sourceReadOnly` false.
 * INVARIANT (enforced in validate.ts): an external `sourcePlatform` can NEVER be `native_actionable_dormant`.
 */
export type DecisionExecutionPolicy = 'external_read_only' | 'advisory_only' | 'native_actionable_dormant'

/** External (imported) platforms AF must never write to. `allfantasy`/null are native and may be actionable later. */
export const EXTERNAL_SOURCE_PLATFORMS = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as const
export function isExternalSourcePlatform(p: string | null | undefined): boolean {
  return p != null && (EXTERNAL_SOURCE_PLATFORMS as readonly string[]).includes(p)
}

export type CanonicalDecision = {
  contractVersion: string
  /** Stable, deterministic id (`dcn:` + fingerprint). Same canonical inputs → same id → idempotent persistence. */
  decisionId: string
  /** Deterministic content/identity fingerprint (hex). Dedup + supersession key. */
  fingerprint: string

  // ── identity / scoping ──────────────────────────────────────────────────────────────────────────────────
  userId: string | null
  leagueId: string | null
  /** User-authorized connected-franchise/portfolio group id. Phase 3A: placeholder only — NEVER inferred by AF. */
  connectedFranchiseId: string | null
  sourcePlatform: DecisionSourcePlatform | null
  sport: DecisionSport
  season: number | null
  /** Week/event period label, e.g. 'week:5' | 'event:playoffs_r1'. Null when not period-bound. */
  period: string | null

  // ── classification ──────────────────────────────────────────────────────────────────────────────────────
  category: DecisionCategory
  subtype: string | null
  scope: DecisionScope
  audience: DecisionAudience
  /** Stable, DETERMINISTIC discriminator for the specific subject/action this decision concerns, when
   *  category+scope+players+teamRef do NOT already uniquely identify it — e.g. which manager an `inactive_manager`
   *  signal is about, which trade proposal a `trade_review` evaluates, which matchup a `matchup_opportunity`
   *  concerns. Part of the identity fingerprint. MUST be stable across re-runs for the same logical subject
   *  (a roster/proposal/matchup id — NEVER a per-run/random id), or idempotency breaks. Null when unneeded. */
  subjectKey: string | null

  // ── content ─────────────────────────────────────────────────────────────────────────────────────────────
  headline: string
  explanation: string
  recommendedAction: string | null
  evidence: DecisionEvidenceRef[]

  // ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────
  confidencePct: number | null
  severity: DecisionSeverity
  urgency: DecisionUrgency
  /** 0–100 server-computed priority (see `priority.ts`); null when not scored. */
  priorityScore: number | null
  expectedImpact: string | null

  // ── entities ────────────────────────────────────────────────────────────────────────────────────────────
  players: DecisionPlayerRef[]
  /** AF roster/team identity within the league (e.g. Roster.id / LeagueTeam.id). */
  teamRef: string | null

  // ── source + read-only guarantee ────────────────────────────────────────────────────────────────────────
  source: DecisionSourceRef | null
  /** Execution/source classification (see `DecisionExecutionPolicy`). Producers/adapters set this; adapters that
   *  wrap imported analysis always leave it `external_read_only`. Phase 3A NEVER executes on any policy. */
  sourceExecutionPolicy: DecisionExecutionPolicy
  /** True whenever AF must never write to the decision's SOURCE (external_read_only + advisory_only). DERIVED from
   *  `sourceExecutionPolicy` by `buildCanonicalDecision` — producers cannot set it directly. Only a native
   *  (`native_actionable_dormant`) decision may be false, and even then Phase 3A executes nothing. */
  sourceReadOnly: boolean

  // ── timestamps + freshness ──────────────────────────────────────────────────────────────────────────────
  /** As-of time of the underlying data (ISO). */
  dataAsOf: string | null
  generatedAt: string
  /** Expiry / stale-at (ISO); null when non-expiring. */
  staleAt: string | null
  freshness: DecisionFreshnessState

  // ── entitlement + token (classification ONLY — no gating/charging in Phase 3A) ──────────────────────────
  entitlementTier: DecisionEntitlementTier
  tokenCostClass: DecisionTokenCostClass

  // ── lifecycle + relationships ───────────────────────────────────────────────────────────────────────────
  status: DecisionStatus
  suppressionReason: string | null
  /** Groups mutually-exclusive/duplicate decisions (e.g. same waiver target across leagues) for later dedup. */
  conflictGroupKey: string | null
  /** decisionId this decision replaces (supersession chain). */
  supersedes: string | null

  // ── producer / audit ────────────────────────────────────────────────────────────────────────────────────
  /** Brain identity, e.g. 'canonical-adapter:commissioner' | 'three-brain'. */
  producer: string
  producerVersion: string
  runId: string | null

  /** Constrained extension for category-specific data not yet normalized. Do NOT store business-critical stable
   *  concepts here — add a typed field instead. */
  extensions: Record<string, unknown> | null
}

/** Fields a producer supplies; the rest (contractVersion, decisionId, fingerprint, sourceReadOnly, defaults) are
 *  stamped by `buildCanonicalDecision`. Keeps producers from inventing ids/version or forging the read-only flag
 *  (`sourceReadOnly` is DERIVED from `sourceExecutionPolicy`, never supplied). The soft fields are OMITTED from
 *  the base and re-added as optional (defaulted in the builder) — omitting from the base is required, since
 *  intersecting a required field with an optional one does NOT relax it. */
export type CanonicalDecisionInput = Omit<
  CanonicalDecision,
  | 'contractVersion' | 'decisionId' | 'fingerprint' | 'sourceReadOnly'
  | 'evidence' | 'players' | 'status' | 'extensions' | 'subjectKey' | 'sourceExecutionPolicy'
> &
  Partial<Pick<CanonicalDecision, 'evidence' | 'players' | 'status' | 'extensions' | 'subjectKey' | 'sourceExecutionPolicy'>>

/**
 * An immutable point-in-time snapshot of a decision's CONTENT for ONE run, appended to
 * `canonical_decision_revisions` (Phase 3A). The `canonical_decisions` row holds current state; revisions preserve
 * prior generated content + run linkage so a re-run never silently overwrites history.
 *
 * OCCURRENCE IDENTITY is `(decisionId, runId)` — a logical decision has AT MOST ONE immutable revision per run
 * (DB-enforced unique). Retrying the same run is idempotent; a different run appends a new revision. `runId` is
 * therefore REQUIRED (shadow persistence rejects a null-runId decision). `contentHash` is a NON-identity integrity
 * field (order-normalized over content, timestamps excluded) used ONLY to DETECT when the same run produced
 * materially different content — a conflict handled deterministically (first occurrence preserved), never a second
 * row and never an overwrite.
 */
export type CanonicalDecisionRevision = {
  decisionId: string
  runId: string
  contentHash: string
  producer: string
  producerVersion: string
  status: DecisionStatus
  supersedesDecisionId: string | null
  headline: string
  explanation: string
  recommendedAction: string | null
  evidence: DecisionEvidenceRef[]
  confidencePct: number | null
  priorityScore: number | null
  severity: DecisionSeverity
  urgency: DecisionUrgency
  source: DecisionSourceRef | null
  dataAsOf: string | null
  generatedAt: string
  staleAt: string | null
  freshness: DecisionFreshnessState
  extensions: Record<string, unknown> | null
  createdAt?: string
}
