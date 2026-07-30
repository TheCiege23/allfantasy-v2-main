/**
 * Phase 3A — canonical Decision OS contract + shadow persistence (UNIT, no DB, no providers, no tokens).
 * Proves: the versioned envelope + deterministic identity; validation (NFL/NCAAF/commissioner/manager/dual-role
 * pass; unknown category / missing identity / forged id / non-read-only / wrong version reject); the adapters;
 * and — critically — that the shadow boundary is INERT unless explicitly enabled, and never charges a token,
 * calls a provider, mints freshness, or touches the store when disabled.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  CANONICAL_DECISION_CONTRACT_VERSION,
  buildCanonicalDecision,
  computeDecisionFingerprint,
  validateCanonicalDecision,
  isSupportedContractVersion,
  shadowPersistDecisions,
  InMemoryCanonicalDecisionStore,
  canonicalShadowEnabled,
  CANONICAL_SHADOW_FLAG,
  computePriorityScore,
  DECISION_CATEGORIES,
  type CanonicalDecision,
  type CanonicalDecisionInput,
  type CanonicalDecisionStore,
  type AdapterContext,
  adaptCommissionerSignal,
  adaptManagerRecommendation,
  adaptLineupStartSit,
  adaptWaiverTarget,
  adaptTradeReview,
} from '@/lib/decision-os/canonical'

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
const baseInput = (over: Partial<CanonicalDecisionInput> = {}): CanonicalDecisionInput => ({
  userId: 'user-1',
  leagueId: 'league-1',
  connectedFranchiseId: null,
  sourcePlatform: 'sleeper',
  sport: 'NFL',
  season: 2026,
  period: 'week:5',
  category: 'start_sit',
  subtype: null,
  scope: 'player',
  audience: 'manager',
  headline: 'Start Player A over Player B',
  explanation: 'A has a better matchup and B is questionable.',
  recommendedAction: 'Start Player A',
  evidence: [{ id: 'e1', kind: 'matchup', label: 'A vs weak defense' }],
  confidencePct: 72,
  severity: 'medium',
  urgency: 'this_week',
  priorityScore: null,
  expectedImpact: '+3.5 projected pts',
  players: [{ canonicalPlayerId: 'pl-A', name: 'Player A', position: 'WR' }],
  teamRef: 'roster-1',
  source: { platform: 'sleeper', platformLeagueId: 'S123', deepLinkUrl: 'https://sleeper.com/leagues/S123' },
  dataAsOf: '2026-07-29T12:00:00.000Z',
  generatedAt: '2026-07-29T12:00:05.000Z',
  staleAt: null,
  freshness: 'fresh',
  entitlementTier: 'subscription',
  tokenCostClass: 'included',
  status: 'active',
  suppressionReason: null,
  conflictGroupKey: null,
  supersedes: null,
  producer: 'test',
  producerVersion: '1',
  runId: 'run-1',
  extensions: null,
  ...over,
})

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  userId: 'user-1',
  leagueId: 'league-1',
  sport: 'NFL',
  season: 2026,
  period: 'week:5',
  sourcePlatform: 'sleeper',
  generatedAt: '2026-07-29T12:00:00.000Z',
  runId: 'run-1',
  ...over,
})

// ── contract + identity ──────────────────────────────────────────────────────────────────────────────────────
describe('canonical contract + identity', () => {
  it('build stamps version, dcn: id, fingerprint, read-only, and defaults', () => {
    const d = buildCanonicalDecision(baseInput())
    expect(d.contractVersion).toBe(CANONICAL_DECISION_CONTRACT_VERSION)
    expect(d.decisionId).toBe(`dcn:${d.fingerprint}`)
    expect(d.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(d.sourceReadOnly).toBe(true)
  })

  it('fingerprint is deterministic over IDENTITY, not content — a reworded re-run keeps the same id (idempotent)', () => {
    const a = buildCanonicalDecision(baseInput())
    const b = buildCanonicalDecision(baseInput({ headline: 'DIFFERENT WORDING', explanation: 'x', confidencePct: 10, generatedAt: '2027-01-01T00:00:00.000Z' }))
    expect(b.fingerprint).toBe(a.fingerprint) // same identity → same id
  })

  it('fingerprint changes when identity changes (category/player/period)', () => {
    const a = buildCanonicalDecision(baseInput())
    expect(buildCanonicalDecision(baseInput({ category: 'waiver_target' })).fingerprint).not.toBe(a.fingerprint)
    expect(buildCanonicalDecision(baseInput({ period: 'week:6' })).fingerprint).not.toBe(a.fingerprint)
    expect(buildCanonicalDecision(baseInput({ players: [{ canonicalPlayerId: 'pl-Z' }] })).fingerprint).not.toBe(a.fingerprint)
  })

  it('taxonomy has all three families + no duplicates', () => {
    expect(new Set(DECISION_CATEGORIES).size).toBe(DECISION_CATEGORIES.length)
    expect(DECISION_CATEGORIES).toContain('waiver_run_today') // commissioner
    expect(DECISION_CATEGORIES).toContain('start_sit') // manager
    expect(DECISION_CATEGORIES).toContain('cross_league_conflict') // portfolio
  })

  it('priority score is deterministic + bounded', () => {
    expect(computePriorityScore({ severity: 'critical', urgency: 'now', confidencePct: 100 })).toBe(100)
    expect(computePriorityScore({ severity: 'info', urgency: 'none', confidencePct: 0 })).toBeGreaterThanOrEqual(0)
    expect(computePriorityScore({ severity: 'medium', urgency: 'today', confidencePct: null })).toBeLessThanOrEqual(100)
  })
})

// ── validation ───────────────────────────────────────────────────────────────────────────────────────────────
describe('canonical validation', () => {
  it('valid NFL decision passes', () => {
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ sport: 'NFL' }))).ok).toBe(true)
  })
  it('valid NCAAF decision passes (no NFL-only assumption)', () => {
    const d = buildCanonicalDecision(baseInput({ sport: 'NCAAF', players: [{ canonicalPlayerId: 'ncaaf-1', name: 'College WR' }] }))
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })
  it('commissioner + manager + dual-role decisions pass', () => {
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ category: 'waiver_run_today', scope: 'commissioner', audience: 'commissioner', players: [], teamRef: null }))).ok).toBe(true)
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ category: 'trade_review', scope: 'team', audience: 'manager', players: [] }))).ok).toBe(true)
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ category: 'trade_review', scope: 'league', audience: 'dual_role', players: [] }))).ok).toBe(true)
  })
  it('rejects an unknown category', () => {
    const d = { ...buildCanonicalDecision(baseInput()), category: 'not_a_category' as never }
    expect(validateCanonicalDecision(d).ok).toBe(false)
  })
  it('rejects missing identity where the scope requires it', () => {
    const noLeague = validateCanonicalDecision(buildCanonicalDecision(baseInput({ scope: 'commissioner', audience: 'commissioner', category: 'league_requires_review', leagueId: null, players: [], teamRef: null })))
    expect(noLeague.ok).toBe(false)
    const noPortfolio = validateCanonicalDecision(buildCanonicalDecision(baseInput({ scope: 'portfolio', category: 'cross_league_conflict', connectedFranchiseId: null, players: [], teamRef: null })))
    expect(noPortfolio.ok).toBe(false)
  })
  it('rejects a non-read-only source flag (imported platforms are read-only)', () => {
    const d = { ...buildCanonicalDecision(baseInput()), sourceReadOnly: false as unknown as true }
    expect(validateCanonicalDecision(d).ok).toBe(false)
  })
  it('rejects a forged fingerprint / id', () => {
    const d = { ...buildCanonicalDecision(baseInput()) }
    const tampered = { ...d, fingerprint: 'a'.repeat(64), decisionId: `dcn:${'a'.repeat(64)}` }
    expect(validateCanonicalDecision(tampered).ok).toBe(false)
  })
  it('rejects an unsupported contract version + isSupportedContractVersion', () => {
    expect(isSupportedContractVersion(CANONICAL_DECISION_CONTRACT_VERSION)).toBe(true)
    expect(isSupportedContractVersion('999')).toBe(false)
    const d = { ...buildCanonicalDecision(baseInput()), contractVersion: '999' }
    expect(validateCanonicalDecision(d).ok).toBe(false)
  })
})

// ── adapters ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('adapters produce valid canonical decisions', () => {
  it('commissioner signal', () => {
    const d = adaptCommissionerSignal({ id: 's1', type: 'waiver_run_today', severity: 'high', title: 'Waivers run tonight', explanation: '3 unclaimed FAAB bids.' }, ctx())
    const r = validateCanonicalDecision(d)
    expect(r.ok).toBe(true)
    expect(d.audience).toBe('commissioner')
    expect(d.scope).toBe('commissioner')
  })
  it('manager recommendation', () => {
    const d = adaptManagerRecommendation({ id: 'r1', category: 'roster_risk', title: 'Roster risk', explanation: 'Two starters on bye.', players: [{ canonicalPlayerId: 'pl-1' }] }, ctx())
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })
  it('lineup / start-sit', () => {
    const d = adaptLineupStartSit({ id: 'l1', category: 'manager_lineup_missing', title: 'Set your lineup', explanation: 'Lineup not submitted.', teamRef: 'roster-1' }, ctx())
    expect(validateCanonicalDecision(d).ok).toBe(true)
    expect(d.scope).toBe('team')
    expect(d.urgency).toBe('today')
  })
  it('waiver target sets a cross-league conflict-group key (portfolio forward-compat, not computed)', () => {
    const d = adaptWaiverTarget({ id: 'w1', title: 'Add breakout RB', explanation: 'High opportunity share.', player: { canonicalPlayerId: 'pl-RB' } }, ctx())
    expect(validateCanonicalDecision(d).ok).toBe(true)
    expect(d.conflictGroupKey).toBe('waiver:NFL:2026:pl-RB') // canonical player id preserved (not lowercased)
  })
  it('trade review', () => {
    const d = adaptTradeReview({ id: 't1', category: 'trade_review', title: 'Evaluate offer', explanation: 'You give A for B.', players: [{ canonicalPlayerId: 'pl-A' }, { canonicalPlayerId: 'pl-B' }] }, ctx())
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })
  it('NFL and NCAAF flow through the SAME adapter', () => {
    expect(validateCanonicalDecision(adaptWaiverTarget({ id: 'w1', title: 't', explanation: 'e', player: { canonicalPlayerId: 'nfl-1' } }, ctx({ sport: 'NFL' }))).ok).toBe(true)
    expect(validateCanonicalDecision(adaptWaiverTarget({ id: 'w2', title: 't', explanation: 'e', player: { canonicalPlayerId: 'ncaaf-1' } }, ctx({ sport: 'NCAAF', sourcePlatform: 'fantrax' }))).ok).toBe(true)
  })
  it('malformed input → the produced decision fails validation (honest, not fabricated)', () => {
    const d = adaptCommissionerSignal({ id: 's1', type: 'waiver_run_today', severity: 'high', title: '', explanation: '' }, ctx())
    expect(validateCanonicalDecision(d).ok).toBe(false) // empty headline/explanation rejected
  })
})

// ── shadow persistence: SAFETY (inert by default) ────────────────────────────────────────────────────────────
describe('shadow persistence — safety / inertness', () => {
  const KEYS = [CANONICAL_SHADOW_FLAG, 'DECISION_OS_MAINTENANCE_ENABLED'] as const
  let saved: Record<string, string | undefined> = {}
  /** A store that FAILS the test if it is ever touched — proves the disabled path never reaches persistence. */
  const throwingStore: CanonicalDecisionStore = {
    persistBatch: async () => { throw new Error('store must NOT be called when shadow is disabled') },
    get: async () => { throw new Error('store must NOT be called when shadow is disabled') },
  }
  beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); KEYS.forEach((k) => delete process.env[k]) })
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  const decisions = () => [buildCanonicalDecision(baseInput())]

  it('flag ABSENT → zero work, store never touched', async () => {
    const r = await shadowPersistDecisions({ decisions: decisions(), mode: 'shadow', store: throwingStore })
    expect(r.enabled).toBe(false)
    expect(r.skippedReason).toBe('shadow_disabled')
    expect(r.persisted).toBe(0)
  })
  it('flag "false" → zero work', async () => {
    process.env[CANONICAL_SHADOW_FLAG] = 'false'
    const r = await shadowPersistDecisions({ decisions: decisions(), mode: 'shadow', store: throwingStore })
    expect(r.enabled).toBe(false)
    expect(r.persisted).toBe(0)
  })
  it('non-exact-"true" values ("1","yes","TRUE") → disabled', async () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      process.env[CANONICAL_SHADOW_FLAG] = v
      expect(canonicalShadowEnabled()).toBe(false)
      const r = await shadowPersistDecisions({ decisions: decisions(), mode: 'shadow', store: throwingStore })
      expect(r.persisted, `value=${JSON.stringify(v)}`).toBe(0)
    }
  })
  it('mode !== "shadow" (e.g. "live") → refused, store never touched', async () => {
    process.env[CANONICAL_SHADOW_FLAG] = 'true'
    const r = await shadowPersistDecisions({ decisions: decisions(), mode: 'live', store: throwingStore })
    expect(r.skippedReason).toBe('not_shadow_mode')
    expect(r.persisted).toBe(0)
  })
  it('the flag is INDEPENDENT of DECISION_OS_MAINTENANCE_ENABLED', async () => {
    process.env.DECISION_OS_MAINTENANCE_ENABLED = 'true' // maintenance on…
    expect(canonicalShadowEnabled()).toBe(false) // …does not enable canonical shadow
    process.env[CANONICAL_SHADOW_FLAG] = 'true'
    expect(canonicalShadowEnabled()).toBe(true)
  })
})

// ── shadow persistence: LOGIC (enabled, in-memory store) ─────────────────────────────────────────────────────
describe('shadow persistence — logic (enabled, in-memory)', () => {
  const enabledEnv = () => ({ [CANONICAL_SHADOW_FLAG]: 'true' }) as unknown as NodeJS.ProcessEnv

  it('persists on a successful shadow write + records run linkage + audit fields', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const d = buildCanonicalDecision(baseInput({ runId: 'run-42', producer: 'p', producerVersion: '3' }))
    const r = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: enabledEnv() })
    expect(r).toMatchObject({ enabled: true, persisted: 1, created: 1, updated: 0 })
    const saved = await store.get(d.decisionId)
    expect(saved?.runId).toBe('run-42')
    expect(saved?.producer).toBe('p')
    expect(saved?.generatedAt).toBe(d.generatedAt)
    expect(saved?.freshness).toBe(d.freshness)
  })

  it('is idempotent on retry (same batch twice → created then updated, one row)', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const batch = [buildCanonicalDecision(baseInput())]
    const first = await shadowPersistDecisions({ decisions: batch, mode: 'shadow', store, env: enabledEnv() })
    const second = await shadowPersistDecisions({ decisions: batch, mode: 'shadow', store, env: enabledEnv() })
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(1)
    expect(store.rows.size).toBe(1)
  })

  it('suppresses duplicates within one batch', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const d = buildCanonicalDecision(baseInput())
    const r = await shadowPersistDecisions({ decisions: [d, { ...d }, { ...d }], mode: 'shadow', store, env: enabledEnv() })
    expect(r.created).toBe(1)
    expect(store.rows.size).toBe(1)
  })

  it('applies supersession (new decision marks the prior one superseded)', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const oldD = buildCanonicalDecision(baseInput({ period: 'week:4' }))
    await shadowPersistDecisions({ decisions: [oldD], mode: 'shadow', store, env: enabledEnv() })
    const newD = buildCanonicalDecision(baseInput({ period: 'week:5', supersedes: oldD.decisionId }))
    const r = await shadowPersistDecisions({ decisions: [newD], mode: 'shadow', store, env: enabledEnv() })
    expect(r.superseded).toBe(1)
    expect((await store.get(oldD.decisionId))?.status).toBe('superseded')
    expect((await store.get(newD.decisionId))?.status).toBe('active')
  })

  it('rejects invalid decisions without persisting them', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const good = buildCanonicalDecision(baseInput())
    const bad = { ...buildCanonicalDecision(baseInput({ period: 'week:9' })), category: 'nope' as never }
    const r = await shadowPersistDecisions({ decisions: [good, bad], mode: 'shadow', store, env: enabledEnv() })
    expect(r.created).toBe(1)
    expect(r.rejected.length).toBe(1)
    expect(store.rows.size).toBe(1)
  })
})
