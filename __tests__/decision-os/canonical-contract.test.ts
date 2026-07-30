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
  computeRevisionContentHash,
  isNewerGeneration,
  isExternalSourcePlatform,
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
    getRevisions: async () => { throw new Error('store must NOT be called when shadow is disabled') },
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

  it('is idempotent on retry (same run twice → created then stale-skipped, one row, one revision)', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const batch = [buildCanonicalDecision(baseInput())]
    const first = await shadowPersistDecisions({ decisions: batch, mode: 'shadow', store, env: enabledEnv() })
    const second = await shadowPersistDecisions({ decisions: batch, mode: 'shadow', store, env: enabledEnv() })
    expect(first.created).toBe(1)
    expect(first.revised).toBe(1)
    expect(second.created).toBe(0)
    expect(second.updated).toBe(0) // same generation is NOT newer → current state not touched
    expect(second.staleSkipped).toBe(1)
    expect(second.revised).toBe(0) // same (decisionId, runId) occurrence already recorded
    expect(store.rows.size).toBe(1)
    expect((await store.getRevisions(batch[0]!.decisionId)).length).toBe(1)
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

// ── H1: logical identity (subjectKey) — distinct subjects must NOT collapse ───────────────────────────────────
describe('logical identity / fingerprint collisions', () => {
  const fp = (o: Partial<CanonicalDecisionInput>) => buildCanonicalDecision(baseInput(o)).fingerprint

  it('two waiver targets (different players) in the same league/week stay distinct', () => {
    const a = fp({ category: 'waiver_target', players: [{ canonicalPlayerId: 'pl-RB1' }] })
    const b = fp({ category: 'waiver_target', players: [{ canonicalPlayerId: 'pl-RB2' }] })
    expect(a).not.toBe(b)
  })

  it('two commissioner signals of the SAME category about different subjects stay distinct (subjectKey)', () => {
    // Reproduces the pre-hardening collapse: commissioner signals set teamRef=null/players=[].
    const mgrA = adaptCommissionerSignal({ id: 's1', type: 'inactive_manager', severity: 'high', title: 'Inactive', explanation: 'No moves', subjectKey: 'roster-A' }, ctx())
    const mgrB = adaptCommissionerSignal({ id: 's2', type: 'inactive_manager', severity: 'high', title: 'Inactive', explanation: 'No moves', subjectKey: 'roster-B' }, ctx())
    expect(mgrA.fingerprint).not.toBe(mgrB.fingerprint)
    // …and WITHOUT a subjectKey they would collapse (documents why subjectKey is required for multi-subject signals).
    const noKeyA = adaptCommissionerSignal({ id: 's1', type: 'inactive_manager', severity: 'high', title: 'Inactive', explanation: 'No moves' }, ctx())
    const noKeyB = adaptCommissionerSignal({ id: 's2', type: 'inactive_manager', severity: 'high', title: 'Inactive', explanation: 'No moves' }, ctx())
    expect(noKeyA.fingerprint).toBe(noKeyB.fingerprint)
  })

  it('two trade proposals with the SAME players stay distinct via subjectKey', () => {
    const players = [{ canonicalPlayerId: 'pl-A' }, { canonicalPlayerId: 'pl-B' }]
    const t1 = adaptTradeReview({ id: 't1', category: 'trade_review', title: 'Offer 1', explanation: 'x', players, subjectKey: 'trade-1001' }, ctx())
    const t2 = adaptTradeReview({ id: 't2', category: 'trade_review', title: 'Offer 2', explanation: 'y', players, subjectKey: 'trade-1002' }, ctx())
    expect(t1.fingerprint).not.toBe(t2.fingerprint)
  })

  it('one player, two DIFFERENT action subjects (category) are distinct by explicit identity rule', () => {
    const player = [{ canonicalPlayerId: 'pl-X' }]
    const startSit = fp({ category: 'start_sit', players: player })
    const dropCand = fp({ category: 'drop_candidate', players: player })
    expect(startSit).not.toBe(dropCand)
  })

  it('connected vs unconnected franchise contexts do not collide', () => {
    const unconnected = fp({ connectedFranchiseId: null })
    const connected = fp({ connectedFranchiseId: 'cf-1' })
    expect(unconnected).not.toBe(connected)
  })

  it('NFL and NCAAF identities do not collide (sport is part of identity)', () => {
    expect(fp({ sport: 'NFL' })).not.toBe(fp({ sport: 'NCAAF' }))
  })

  it('reworded re-run with the SAME subjectKey remains idempotent (same id)', () => {
    const a = buildCanonicalDecision(baseInput({ subjectKey: 'trade-1001', category: 'trade_review' }))
    const b = buildCanonicalDecision(baseInput({ subjectKey: 'trade-1001', category: 'trade_review', headline: 'reworded', confidencePct: 3, generatedAt: '2030-01-01T00:00:00.000Z' }))
    expect(b.fingerprint).toBe(a.fingerprint)
  })
})

// ── H4: execution / source policy ─────────────────────────────────────────────────────────────────────────────
describe('execution / source policy', () => {
  it('adapters default to external_read_only + sourceReadOnly true (no adapter is externally writable)', () => {
    const d = adaptWaiverTarget({ id: 'w', title: 't', explanation: 'e', player: { canonicalPlayerId: 'pl-1' } }, ctx())
    expect(d.sourceExecutionPolicy).toBe('external_read_only')
    expect(d.sourceReadOnly).toBe(true)
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })

  it('an external platform can NEVER be native_actionable_dormant', () => {
    const d = buildCanonicalDecision(baseInput({ sourcePlatform: 'sleeper', sourceExecutionPolicy: 'native_actionable_dormant' }))
    expect(d.sourceReadOnly).toBe(false) // builder derived it…
    expect(validateCanonicalDecision(d).ok).toBe(false) // …but validation refuses external + native
  })

  it('native AllFantasy source may be actionable-later (dormant) + is representable', () => {
    const d = buildCanonicalDecision(baseInput({ sourcePlatform: 'allfantasy', source: null, sourceExecutionPolicy: 'native_actionable_dormant' }))
    expect(d.sourceReadOnly).toBe(false)
    expect(d.sourceExecutionPolicy).toBe('native_actionable_dormant')
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })

  it('advisory_only is read-only regardless of source', () => {
    const d = buildCanonicalDecision(baseInput({ sourcePlatform: 'allfantasy', source: null, sourceExecutionPolicy: 'advisory_only' }))
    expect(d.sourceReadOnly).toBe(true)
    expect(validateCanonicalDecision(d).ok).toBe(true)
  })

  it('a forged read-only flag inconsistent with the policy is rejected', () => {
    const d = { ...buildCanonicalDecision(baseInput({ sourcePlatform: 'allfantasy', source: null })), sourceReadOnly: false }
    expect(validateCanonicalDecision(d).ok).toBe(false) // policy external_read_only ⇒ must be true
  })

  it('isExternalSourcePlatform recognizes the imported platforms only', () => {
    for (const p of ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']) expect(isExternalSourcePlatform(p)).toBe(true)
    for (const p of ['allfantasy', null, undefined]) expect(isExternalSourcePlatform(p as string | null)).toBe(false)
  })
})

// ── H5: bounded JSON / oversized input rejection ──────────────────────────────────────────────────────────────
describe('bounded JSON + oversized input', () => {
  it('rejects an over-length evidence array', () => {
    const evidence = Array.from({ length: 51 }, (_, i) => ({ id: `e${i}`, kind: 'matchup', label: 'x' }))
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ evidence }))).ok).toBe(false)
  })
  it('rejects an over-length players array', () => {
    const players = Array.from({ length: 61 }, (_, i) => ({ canonicalPlayerId: `pl-${i}` }))
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ players }))).ok).toBe(false)
  })
  it('rejects extensions with too many keys', () => {
    const extensions = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 1]))
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ extensions }))).ok).toBe(false)
  })
  it('rejects oversized extensions payload (bytes)', () => {
    const extensions = { blob: 'x'.repeat(9000) }
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ extensions }))).ok).toBe(false)
  })
  it('rejects an over-length explanation', () => {
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ explanation: 'x'.repeat(5001) }))).ok).toBe(false)
  })
  it('accepts an at-limit evidence array (boundary)', () => {
    const evidence = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, kind: 'matchup', label: 'x' }))
    expect(validateCanonicalDecision(buildCanonicalDecision(baseInput({ evidence }))).ok).toBe(true)
  })
})

// ── I1: revision CONTENT hash (integrity, NOT identity) ───────────────────────────────────────────────────────
describe('revision content hash (integrity, not identity)', () => {
  it('same content → same content hash (idempotent)', () => {
    expect(computeRevisionContentHash(buildCanonicalDecision(baseInput()))).toBe(computeRevisionContentHash(buildCanonicalDecision(baseInput())))
  })
  it('different content → different content hash', () => {
    expect(computeRevisionContentHash(buildCanonicalDecision(baseInput()))).not.toBe(computeRevisionContentHash(buildCanonicalDecision(baseInput({ explanation: 'materially different' }))))
  })
  it('content hash EXCLUDES runId (occurrence identity is (decisionId, runId), not the hash)', () => {
    const a = buildCanonicalDecision(baseInput({ runId: 'run-1' }))
    const b = buildCanonicalDecision(baseInput({ runId: 'run-2' }))
    expect(computeRevisionContentHash(a)).toBe(computeRevisionContentHash(b))
  })
  it('content hash EXCLUDES timestamps (a re-stamped generatedAt is not a content change)', () => {
    const a = buildCanonicalDecision(baseInput({ generatedAt: '2026-07-29T12:00:00.000Z' }))
    const b = buildCanonicalDecision(baseInput({ generatedAt: '2026-07-29T18:30:00.000Z' }))
    expect(computeRevisionContentHash(a)).toBe(computeRevisionContentHash(b))
  })
  it('content hash is INSENSITIVE to evidence ordering', () => {
    const e1 = { id: 'e1', kind: 'matchup', label: 'A' }
    const e2 = { id: 'e2', kind: 'injury', label: 'B' }
    const a = buildCanonicalDecision(baseInput({ evidence: [e1, e2] }))
    const b = buildCanonicalDecision(baseInput({ evidence: [e2, e1] }))
    expect(computeRevisionContentHash(a)).toBe(computeRevisionContentHash(b))
  })
})

// ── I1: same-run occurrence identity (decisionId, runId) — in-memory ──────────────────────────────────────────
describe('same-run occurrence identity', () => {
  const env = () => ({ [CANONICAL_SHADOW_FLAG]: 'true' }) as unknown as NodeJS.ProcessEnv

  it('null runId is rejected by the shadow boundary (occurrence identity requires a run)', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const d = buildCanonicalDecision(baseInput({ runId: null }))
    const r = await shadowPersistDecisions({ decisions: [d], mode: 'shadow', store, env: env() })
    expect(r.created).toBe(0)
    expect(r.rejected.length).toBe(1)
    expect(r.rejected[0]!.errors[0]).toMatch(/runId is required/)
    expect(store.rows.size).toBe(0)
  })

  it('same run + changed prose → NO second revision (first preserved) + typed conflict', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const first = buildCanonicalDecision(baseInput({ runId: 'run-X', explanation: 'first-gen' }))
    const changed = buildCanonicalDecision(baseInput({ runId: 'run-X', explanation: 'DIFFERENT prose' }))
    await shadowPersistDecisions({ decisions: [first], mode: 'shadow', store, env: env() })
    const r = await shadowPersistDecisions({ decisions: [changed], mode: 'shadow', store, env: env() })
    expect(r.revised).toBe(0)
    expect(r.revisionConflicts).toBe(1)
    const revs = await store.getRevisions(first.decisionId)
    expect(revs.length).toBe(1)
    expect(revs[0]!.explanation).toBe('first-gen') // first occurrence preserved, never overwritten
  })

  it('same run + changed generatedAt → one revision, NO conflict', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const a = buildCanonicalDecision(baseInput({ runId: 'run-Y', generatedAt: '2026-07-29T12:00:00.000Z' }))
    const b = buildCanonicalDecision(baseInput({ runId: 'run-Y', generatedAt: '2026-07-29T20:00:00.000Z' }))
    await shadowPersistDecisions({ decisions: [a], mode: 'shadow', store, env: env() })
    const r = await shadowPersistDecisions({ decisions: [b], mode: 'shadow', store, env: env() })
    expect(r.revisionConflicts).toBe(0)
    expect((await store.getRevisions(a.decisionId)).length).toBe(1)
  })

  it('same run + reordered evidence → one revision, NO conflict', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const e1 = { id: 'e1', kind: 'matchup', label: 'A' }
    const e2 = { id: 'e2', kind: 'injury', label: 'B' }
    const a = buildCanonicalDecision(baseInput({ runId: 'run-Z', evidence: [e1, e2] }))
    const b = buildCanonicalDecision(baseInput({ runId: 'run-Z', evidence: [e2, e1] }))
    await shadowPersistDecisions({ decisions: [a], mode: 'shadow', store, env: env() })
    const r = await shadowPersistDecisions({ decisions: [b], mode: 'shadow', store, env: env() })
    expect(r.revisionConflicts).toBe(0)
    expect((await store.getRevisions(a.decisionId)).length).toBe(1)
  })

  it('different run → a second revision occurrence; prior remains recoverable', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const run1 = buildCanonicalDecision(baseInput({ runId: 'run-1', explanation: 'first' }))
    const run2 = buildCanonicalDecision(baseInput({ runId: 'run-2', explanation: 'second' }))
    await shadowPersistDecisions({ decisions: [run1], mode: 'shadow', store, env: env() })
    const r2 = await shadowPersistDecisions({ decisions: [run2], mode: 'shadow', store, env: env() })
    expect(r2.revised).toBe(1)
    const revs = await store.getRevisions(run1.decisionId)
    expect(revs.map((r) => r.runId)).toEqual(['run-1', 'run-2'])
    expect(revs.map((r) => r.explanation)).toEqual(['first', 'second'])
  })
})

// ── I2: deterministic current-state ordering — in-memory ──────────────────────────────────────────────────────
describe('deterministic current-state ordering', () => {
  const env = () => ({ [CANONICAL_SHADOW_FLAG]: 'true' }) as unknown as NodeJS.ProcessEnv
  const newer = { generatedAt: '2026-07-29T13:00:00.000Z', runId: 'run-new' }
  const older = { generatedAt: '2026-07-29T12:00:00.000Z', runId: 'run-old' }

  it('isNewerGeneration: generatedAt primary, runId tie-break', () => {
    expect(isNewerGeneration(newer, older)).toBe(true)
    expect(isNewerGeneration(older, newer)).toBe(false)
    expect(isNewerGeneration({ generatedAt: 'T', runId: 'b' }, { generatedAt: 'T', runId: 'a' })).toBe(true) // tie-break
    expect(isNewerGeneration({ generatedAt: 'T', runId: 'a' }, { generatedAt: 'T', runId: 'a' })).toBe(false) // equal
  })

  it('an OLDER run cannot overwrite a NEWER current decision (both arrival orders converge)', async () => {
    const mkNew = () => buildCanonicalDecision(baseInput({ runId: 'run-new', generatedAt: newer.generatedAt, explanation: 'NEW' }))
    const mkOld = () => buildCanonicalDecision(baseInput({ runId: 'run-old', generatedAt: older.generatedAt, explanation: 'OLD' }))

    // order 1: old then new → ends NEW
    const s1 = new InMemoryCanonicalDecisionStore()
    await shadowPersistDecisions({ decisions: [mkOld()], mode: 'shadow', store: s1, env: env() })
    await shadowPersistDecisions({ decisions: [mkNew()], mode: 'shadow', store: s1, env: env() })
    // order 2: new then old → still NEW (older cannot regress)
    const s2 = new InMemoryCanonicalDecisionStore()
    await shadowPersistDecisions({ decisions: [mkNew()], mode: 'shadow', store: s2, env: env() })
    const rOld = await shadowPersistDecisions({ decisions: [mkOld()], mode: 'shadow', store: s2, env: env() })

    expect((await s1.get(mkNew().decisionId))!.explanation).toBe('NEW')
    expect((await s2.get(mkNew().decisionId))!.explanation).toBe('NEW')
    expect(rOld.staleSkipped).toBe(1) // older write did not regress current state
    // …but the older run's occurrence is still recorded for audit
    expect((await s2.getRevisions(mkNew().decisionId)).map((r) => r.runId).sort()).toEqual(['run-new', 'run-old'])
  })

  it('a stale write after supersession does NOT revert status', async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const oldD = buildCanonicalDecision(baseInput({ runId: 'run-old', period: 'week:sup-old' }))
    await shadowPersistDecisions({ decisions: [oldD], mode: 'shadow', store, env: env() })
    const newD = buildCanonicalDecision(baseInput({ runId: 'run-new', period: 'week:sup-new', supersedes: oldD.decisionId }))
    await shadowPersistDecisions({ decisions: [newD], mode: 'shadow', store, env: env() })
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded')
    // stale retry of the old decision (same run, same generation) must not un-supersede it
    const r = await shadowPersistDecisions({ decisions: [buildCanonicalDecision(baseInput({ runId: 'run-old', period: 'week:sup-old' }))], mode: 'shadow', store, env: env() })
    expect(r.staleSkipped).toBe(1)
    expect((await store.get(oldD.decisionId))!.status).toBe('superseded')
  })
})
