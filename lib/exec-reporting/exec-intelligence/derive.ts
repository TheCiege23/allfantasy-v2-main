/**
 * Fantasy OS Phase 4 — deterministic derivation layer (Part 4).
 *
 * Pure functions: (neutral snapshot) -> (typed contract). No I/O, no randomness, no LLM, no time-dependent
 * math beyond `generatedAt`. Every metric is a documented aggregation over the certified portfolio. Where
 * evidence is absent (position metadata, per-season manager membership, offseason week-0 txns) the output
 * says so via `Insufficient Evidence` / `limitations` rather than guessing.
 *
 * Rule glossary (single source of truth for the tests + docs):
 *  - Operational status per league-season (sampled weeks 1–18): active = transactions ≥ 50, quiet = 1–49,
 *    dormant = 0. Threshold is explicit and disclosed, never an opaque score.
 *  - FAAB adoption = leagues with faab>0 ÷ leagues with any waiver activity (faab>0 OR waivers>0).
 *  - Trade YoY = (latest full season trades − prior season trades) ÷ prior season trades.
 *  - Manager participation buckets: 1 league, 2–3, 4–6, 7+ (by distinct league_count).
 */
import type {
  CommissionerIntelligence,
  DraftIntelligence,
  Distribution,
  LeagueIntelligence,
  ManagerIntelligence,
  PlatformIntelligence,
  RankedLeague,
  StackedYearlyPoint,
  TradeIntelligence,
  WaiverIntelligence,
  YearlySeries,
} from './contracts'
import type { ExecSnapshot, ExecLeagueRow } from '../exec-data/types'
import { buildEnvelope, EXEC_OFFSEASON_LIMITATION, type TruthLabel } from './truth'
import { confidenceFromSampleSize, type Explanation } from './explanation'

const ACTIVE_THRESHOLD = 50

/** Deterministic pseudonymous display key (FNV-1a → base36). Never exposes the raw provider id. */
export function pseudoRef(id: string, prefix: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}-${(h >>> 0).toString(36).padStart(6, '0').slice(0, 6)}`
}

function seasonNum(s: string): number {
  return Number(s)
}

function bySeasonSum(leagues: ExecLeagueRow[], pick: (l: ExecLeagueRow) => number): { season: number; value: number }[] {
  const map = new Map<number, number>()
  for (const l of leagues) {
    const s = seasonNum(l.season)
    if (!Number.isFinite(s)) continue
    map.set(s, (map.get(s) ?? 0) + pick(l))
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([season, value]) => ({ season, value }))
}

function bySeasonCount(leagues: ExecLeagueRow[], keep: (l: ExecLeagueRow) => boolean = () => true): { season: number; value: number }[] {
  return bySeasonSum(leagues, (l) => (keep(l) ? 1 : 0))
}

function series(key: string, label: string, unit: string, points: { season: number; value: number }[]): YearlySeries {
  return { key, label, unit, points }
}

function envelopeFor(snapshot: ExecSnapshot, truthLabel: TruthLabel, generatedAt: string) {
  return buildEnvelope({
    manifestHash: snapshot.run.manifestHash,
    runId: snapshot.run.runId,
    seasons: snapshot.run.seasons,
    importedAt: snapshot.run.importedAt,
    truthLabel,
    generatedAt,
  })
}

// ── Platform ──────────────────────────────────────────────────────────────────
export function derivePlatform(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): PlatformIntelligence {
  const { leagues, managers } = snapshot
  const sum = (p: (l: ExecLeagueRow) => number) => leagues.reduce((a, l) => a + p(l), 0)

  const totals = {
    leagueSeasons: leagues.length,
    uniqueManagers: managers.length,
    commissioners: managers.filter((m) => m.isCommissioner).length,
    rosters: sum((l) => l.rosters),
    matchups: sum((l) => l.matchupRecords),
    transactions: sum((l) => l.transactions),
    trades: sum((l) => l.trades),
    waivers: sum((l) => l.waivers),
    freeAgents: sum((l) => l.freeAgents),
    faab: sum((l) => l.faab),
    drafts: sum((l) => l.drafts),
    draftPicks: sum((l) => l.draftPicks),
    tradedFuturePicks: sum((l) => l.tradedFuturePicks),
    continuityChains: snapshot.continuityChainCount,
  }

  const tradesByYear = bySeasonSum(leagues, (l) => l.trades)
  const waiversByYear = bySeasonSum(leagues, (l) => l.waivers)
  const faByYear = bySeasonSum(leagues, (l) => l.freeAgents)
  const composition: StackedYearlyPoint[] = [...new Set(leagues.map((l) => seasonNum(l.season)))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((season) => ({
      season,
      trades: tradesByYear.find((p) => p.season === season)?.value ?? 0,
      waivers: waiversByYear.find((p) => p.season === season)?.value ?? 0,
      freeAgents: faByYear.find((p) => p.season === season)?.value ?? 0,
    }))

  const insights: Explanation[] = [platformActivityInsight(tradesByYear, totals.trades)]

  return {
    kind: 'platform',
    ...envelopeFor(snapshot, 'Live League Data', generatedAt),
    totals,
    leaguesByYear: series('leagues', 'League seasons', 'leagues', bySeasonCount(leagues)),
    transactionsByYear: series('transactions', 'Transactions', 'transactions', bySeasonSum(leagues, (l) => l.transactions)),
    tradesByYear: series('trades', 'Trades', 'trades', tradesByYear),
    waiversByYear: series('waivers', 'Waivers', 'waivers', waiversByYear),
    freeAgentsByYear: series('freeAgents', 'Free-agent moves', 'moves', faByYear),
    draftsByYear: series('drafts', 'Drafts', 'drafts', bySeasonSum(leagues, (l) => l.drafts)),
    draftPicksByYear: series('draftPicks', 'Draft picks', 'picks', bySeasonSum(leagues, (l) => l.draftPicks)),
    activityCompositionByYear: composition,
    insights: insights.filter(Boolean),
    limitations: [EXEC_OFFSEASON_LIMITATION, 'Per-season manager participation is not available (membership edges were not persisted).'],
  }
}

function platformActivityInsight(tradesByYear: { season: number; value: number }[], totalTrades: number): Explanation {
  const withSignal = tradesByYear.filter((p) => p.value > 0)
  const last = withSignal[withSignal.length - 1]
  const prev = withSignal[withSignal.length - 2]
  const yoy = prev && prev.value > 0 && last ? Math.round(((last.value - prev.value) / prev.value) * 100) : null
  const dir = yoy == null ? 'held steady' : yoy >= 0 ? `rose ${yoy}%` : `declined ${Math.abs(yoy)}%`
  return {
    whatHappened:
      yoy == null
        ? `The portfolio recorded ${totalTrades.toLocaleString()} completed trades across the sampled window.`
        : `Portfolio trade volume ${dir} in ${last!.season} versus ${prev!.season}.`,
    evidence: [
      { metric: 'trades.total', value: totalTrades },
      ...(last ? [{ metric: `trades.${last.season}`, value: last.value }] : []),
      ...(prev ? [{ metric: `trades.${prev.season}`, value: prev.value }] : []),
    ],
    whyItMatters: 'Trade volume is a direct, roster-movement measure of league engagement across the portfolio.',
    recommendation:
      yoy != null && yoy < 0
        ? 'Prioritize engagement nudges (trade-deadline reminders) in the leagues driving the decline.'
        : 'Maintain current engagement cadence; monitor season-over-season movement.',
    confidence: confidenceFromSampleSize(totalTrades, { unit: 'completed trades' }),
    truthLabel: 'Derived League Intelligence',
    limitations: [EXEC_OFFSEASON_LIMITATION],
  }
}

// ── League ────────────────────────────────────────────────────────────────────
export function deriveLeague(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): LeagueIntelligence {
  const { leagues } = snapshot
  const byFormat: Distribution[] = distributionBy(leagues, (l) => l.formatType)
  const byStatus: Distribution[] = distributionBy(leagues, (l) => l.status ?? 'unknown')

  const classify = (l: ExecLeagueRow) => (l.transactions >= ACTIVE_THRESHOLD ? 'active' : l.transactions > 0 ? 'quiet' : 'dormant')
  const health = (['active', 'quiet', 'dormant'] as const).map((status) => ({
    status,
    count: leagues.filter((l) => classify(l) === status).length,
    rule:
      status === 'active'
        ? `≥ ${ACTIVE_THRESHOLD} transactions in the sampled window`
        : status === 'quiet'
          ? `1–${ACTIVE_THRESHOLD - 1} transactions`
          : '0 transactions in the sampled window',
  }))

  const rank = (arr: ExecLeagueRow[], metric: (l: ExecLeagueRow) => number): RankedLeague[] =>
    [...arr]
      .sort((a, b) => metric(b) - metric(a))
      .slice(0, 8)
      .map((l) => ({ ref: pseudoRef(l.leagueId, 'lg'), season: seasonNum(l.season), metric: metric(l), detail: l.formatType }))

  const dormantCount = leagues.filter((l) => classify(l) === 'dormant').length

  return {
    kind: 'league',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    leagueSeasons: leagues.length,
    distinctLeagueChains: snapshot.continuityChainCount,
    byFormat,
    byStatus,
    operationalHealth: health,
    mostActive: rank(leagues, (l) => l.transactions),
    needsAttention: rank(
      leagues.filter((l) => classify(l) !== 'active'),
      (l) => -l.transactions,
    ).map((r) => ({ ...r, metric: Math.abs(r.metric) })),
    insights: [
      {
        whatHappened: `${dormantCount} of ${leagues.length} league-seasons recorded no transactions during the sampled regular-season window.`,
        evidence: [
          { metric: 'league.dormant', value: dormantCount },
          { metric: 'league.total', value: leagues.length },
        ],
        whyItMatters: 'Zero-transaction league-seasons are the clearest operational signal of a stalled or inactive league.',
        recommendation: 'Review the flagged league-seasons for re-engagement or archival; confirm they are not simply best-ball formats.',
        confidence: confidenceFromSampleSize(leagues.length, { unit: 'league-seasons' }),
        truthLabel: 'Derived League Intelligence',
        limitations: [EXEC_OFFSEASON_LIMITATION, 'Best-ball leagues legitimately have few in-season transactions.'],
      },
    ],
    limitations: [EXEC_OFFSEASON_LIMITATION],
  }
}

// ── Commissioner ───────────────────────────────────────────────────────────────
export function deriveCommissioner(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): CommissionerIntelligence {
  const { leagues, managers } = snapshot
  const commLeagues = leagues.filter((l) => l.seedRole === 'commissioner')
  const activity = commLeagues.reduce(
    (a, l) => ({ transactions: a.transactions + l.transactions, trades: a.trades + l.trades, waivers: a.waivers + l.waivers }),
    { transactions: 0, trades: 0, waivers: 0 },
  )
  const dormantComm = commLeagues.filter((l) => l.transactions === 0).length
  const smallRoster = commLeagues.filter((l) => (l.totalRosters ?? 0) > 0 && l.rosters < (l.totalRosters ?? 0)).length

  return {
    kind: 'commissioner',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    commissionedLeagueSeasons: commLeagues.length,
    commissionersInPortfolio: managers.filter((m) => m.isCommissioner).length,
    commissionedByYear: series('commissioned', 'Commissioned league seasons', 'leagues', bySeasonCount(commLeagues)),
    activityUnderCommissioner: activity,
    attentionFlags: [
      { flag: 'Zero-transaction commissioned seasons', count: dormantComm, rule: '0 transactions in the sampled window under commissioner ownership' },
      { flag: 'Under-filled rosters', count: smallRoster, rule: 'active rosters < configured team count' },
    ],
    insights: [
      {
        whatHappened: `You commissioned ${commLeagues.length} league-seasons carrying ${activity.transactions.toLocaleString()} transactions.`,
        evidence: [
          { metric: 'commissioner.leagueSeasons', value: commLeagues.length },
          { metric: 'commissioner.transactions', value: activity.transactions },
          { metric: 'commissioner.dormant', value: dormantComm },
        ],
        whyItMatters: 'Commissioner workload concentration highlights where operational attention is most demanded.',
        recommendation: dormantComm > 0 ? `Review the ${dormantComm} zero-transaction commissioned seasons for re-engagement or archival.` : 'Commissioned leagues show consistent activity; maintain current cadence.',
        confidence: confidenceFromSampleSize(commLeagues.length, { unit: 'commissioned league-seasons' }),
        truthLabel: 'Derived League Intelligence',
        limitations: ['Commissioner status is the provider ownership flag (self-attested, as elsewhere in the product).', EXEC_OFFSEASON_LIMITATION],
      },
    ],
    limitations: ['Transaction-review actions are not exposed by the source; workload is inferred from transaction volume only.'],
  }
}

// ── Trade ─────────────────────────────────────────────────────────────────────
export function deriveTrade(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): TradeIntelligence {
  const { leagues } = snapshot
  const tradesByYear = bySeasonSum(leagues, (l) => l.trades).filter((p) => p.value > 0)
  const last = tradesByYear[tradesByYear.length - 1]
  const prev = tradesByYear[tradesByYear.length - 2]
  const yoy = prev && prev.value > 0 && last ? Math.round(((last.value - prev.value) / prev.value) * 1000) / 10 : null
  const totalTrades = leagues.reduce((a, l) => a + l.trades, 0)
  const active = leagues.filter((l) => l.trades > 0).length

  return {
    kind: 'trade',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    totalTrades,
    activeTradingLeagueSeasons: active,
    quietLeagueSeasons: leagues.length - active,
    tradedFuturePicks: leagues.reduce((a, l) => a + l.tradedFuturePicks, 0),
    tradesByYear: series('trades', 'Trades', 'trades', bySeasonSum(leagues, (l) => l.trades)),
    yoyChangePct: yoy,
    concentration: [...leagues]
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 8)
      .map((l) => ({ ref: pseudoRef(l.leagueId, 'lg'), season: seasonNum(l.season), metric: l.trades, detail: l.formatType })),
    insights: [
      {
        whatHappened:
          yoy == null
            ? `${totalTrades.toLocaleString()} completed trades across ${active} active trading league-seasons.`
            : `Trade volume ${yoy >= 0 ? 'rose' : 'declined'} ${Math.abs(yoy)}% in ${last!.season} vs ${prev!.season}.`,
        evidence: [
          { metric: 'trades.total', value: totalTrades },
          { metric: 'trades.activeLeagueSeasons', value: active },
          ...(last ? [{ metric: `trades.${last.season}`, value: last.value }] : []),
        ],
        whyItMatters: 'Trade market vitality is a leading indicator of manager engagement and league stickiness.',
        recommendation: yoy != null && yoy < 0 ? 'Introduce a trade-deadline reminder in declining leagues to re-stimulate the market.' : 'Trade markets are healthy; continue current engagement.',
        confidence: confidenceFromSampleSize(totalTrades, { unit: 'completed trades' }),
        truthLabel: 'Derived League Intelligence',
        limitations: ['Declined offers, negotiation sentiment, veto intent, and fairness are NOT exposed by the source and are not inferred.', EXEC_OFFSEASON_LIMITATION],
      },
    ],
    limitations: ['Only completed trades are counted; declined/pending offers are not available.'],
  }
}

// ── Waiver ────────────────────────────────────────────────────────────────────
export function deriveWaiver(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): WaiverIntelligence {
  const { leagues } = snapshot
  const waivers = leagues.reduce((a, l) => a + l.waivers, 0)
  const freeAgents = leagues.reduce((a, l) => a + l.freeAgents, 0)
  const faab = leagues.reduce((a, l) => a + l.faab, 0)
  const anyWaiver = leagues.filter((l) => l.waivers > 0 || l.faab > 0)
  const faabLeagues = leagues.filter((l) => l.faab > 0)
  const faabAdoption = anyWaiver.length > 0 ? Math.round((faabLeagues.length / anyWaiver.length) * 1000) / 10 : null

  return {
    kind: 'waiver',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    waivers,
    freeAgents,
    faab,
    activeLeagueSeasons: leagues.filter((l) => l.waivers > 0 || l.freeAgents > 0).length,
    waiversByYear: series('waivers', 'Waivers', 'waivers', bySeasonSum(leagues, (l) => l.waivers)),
    freeAgentsByYear: series('freeAgents', 'Free-agent moves', 'moves', bySeasonSum(leagues, (l) => l.freeAgents)),
    faabByYear: series('faab', 'FAAB moves', 'moves', bySeasonSum(leagues, (l) => l.faab)),
    faabAdoptionPct: faabAdoption,
    insights: [
      {
        whatHappened: `${faabLeagues.length} of ${anyWaiver.length} waiver-active league-seasons use FAAB bidding${faabAdoption != null ? ` (${faabAdoption}% adoption)` : ''}.`,
        evidence: [
          { metric: 'waiver.faabLeagues', value: faabLeagues.length },
          { metric: 'waiver.anyWaiverLeagues', value: anyWaiver.length },
          { metric: 'waiver.faabMoves', value: faab },
        ],
        whyItMatters: 'FAAB adoption indicates a more competitive, engaged acquisition environment than reverse-order waivers.',
        recommendation: 'Highlight FAAB best-practices to non-FAAB leagues where a switch would raise engagement.',
        confidence: confidenceFromSampleSize(anyWaiver.length, { unit: 'waiver-active league-seasons' }),
        truthLabel: 'Derived League Intelligence',
        limitations: [EXEC_OFFSEASON_LIMITATION],
      },
    ],
    limitations: ['Waivers, free-agent moves, and FAAB events are distinct categories and are reported separately.'],
  }
}

// ── Draft ─────────────────────────────────────────────────────────────────────
export function deriveDraft(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): DraftIntelligence {
  const { leagues } = snapshot
  const drafts = leagues.reduce((a, l) => a + l.drafts, 0)
  const draftPicks = leagues.reduce((a, l) => a + l.draftPicks, 0)
  const avg = drafts > 0 ? Math.round((draftPicks / drafts) * 10) / 10 : null

  return {
    kind: 'draft',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    drafts,
    draftPicks,
    draftsByYear: series('drafts', 'Drafts', 'drafts', bySeasonSum(leagues, (l) => l.drafts)),
    draftPicksByYear: series('draftPicks', 'Draft picks', 'picks', bySeasonSum(leagues, (l) => l.draftPicks)),
    avgPicksPerDraft: avg,
    tradedFuturePicks: leagues.reduce((a, l) => a + l.tradedFuturePicks, 0),
    positionalDistributionAvailable: false,
    insights: [
      {
        whatHappened: `${drafts.toLocaleString()} drafts produced ${draftPicks.toLocaleString()} picks${avg != null ? ` (avg ${avg}/draft)` : ''}.`,
        evidence: [
          { metric: 'draft.count', value: drafts },
          { metric: 'draft.picks', value: draftPicks },
        ],
        whyItMatters: 'Draft participation is a foundational indicator of league setup completion and season kickoff.',
        recommendation: 'No action required; draft coverage is complete across the portfolio.',
        confidence: confidenceFromSampleSize(drafts, { unit: 'drafts' }),
        truthLabel: 'Derived League Intelligence',
        limitations: ['Player position metadata is not persisted → positional distribution renders as Insufficient Evidence, never guessed.'],
      },
    ],
    limitations: ['Positional distribution is unavailable (position metadata not persisted).'],
  }
}

// ── Manager ───────────────────────────────────────────────────────────────────
export function deriveManager(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()): ManagerIntelligence {
  const { managers } = snapshot
  const bucket = (n: number) => (n >= 7 ? '7+ leagues' : n >= 4 ? '4–6 leagues' : n >= 2 ? '2–3 leagues' : '1 league')
  const order = ['1 league', '2–3 leagues', '4–6 leagues', '7+ leagues']
  const dist: Distribution[] = order.map((b) => ({ bucket: b, count: managers.filter((m) => bucket(m.leagueCount) === b).length }))

  return {
    kind: 'manager',
    ...envelopeFor(snapshot, 'Derived League Intelligence', generatedAt),
    uniqueManagers: managers.length,
    commissioners: managers.filter((m) => m.isCommissioner).length,
    managersInMultipleLeagues: managers.filter((m) => m.leagueCount > 1).length,
    managersAcrossMultipleSeasons: managers.filter((m) => m.seasonCount > 1).length,
    participationDistribution: dist,
    topByLeaguePresence: [...managers]
      .sort((a, b) => b.leagueCount - a.leagueCount)
      .slice(0, 10)
      .map((m) => ({ ref: pseudoRef(m.userId, 'mgr'), season: m.seasonCount, metric: m.leagueCount, detail: `${m.seasonCount} seasons` })),
    forbiddenInferences: [
      'psychology',
      'motivation',
      'personality',
      'skill rating',
      'loyalty',
      'satisfaction',
      'churn probability',
      'retention intent',
      'willingness to pay',
      'managerial competence',
    ],
    insights: [
      {
        whatHappened: `${managers.filter((m) => m.leagueCount > 1).length.toLocaleString()} of ${managers.length.toLocaleString()} managers appear in more than one league.`,
        evidence: [
          { metric: 'manager.multiLeague', value: managers.filter((m) => m.leagueCount > 1).length },
          { metric: 'manager.total', value: managers.length },
        ],
        whyItMatters: 'Cross-league presence indicates the connected core of the manager network — a retention and growth surface.',
        recommendation: 'Engage high-presence managers as network anchors; do not infer intent or churn from presence alone.',
        confidence: confidenceFromSampleSize(managers.length, { unit: 'managers' }),
        truthLabel: 'Derived League Intelligence',
        limitations: ['Participation counts only; no psychological, skill, retention, or willingness-to-pay inference is produced.'],
      },
    ],
    limitations: ['Manager Intelligence is participation-only. Psychology, skill, loyalty, churn, and retention are NOT inferred (no validated contract).'],
  }
}

function distributionBy(leagues: ExecLeagueRow[], key: (l: ExecLeagueRow) => string): Distribution[] {
  const map = new Map<string, number>()
  for (const l of leagues) map.set(key(l), (map.get(key(l)) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([bucket, count]) => ({ bucket, count }))
}

/** Reconcile derived platform totals against the certified manifest totals (used by tests + a UI guard). */
export function reconcileAgainstManifest(snapshot: ExecSnapshot): { key: string; derived: number; manifest: number; match: boolean }[] {
  const p = derivePlatform(snapshot)
  const t = snapshot.run.totals
  const pairs: [string, number, unknown][] = [
    ['leagueSeasons', p.totals.leagueSeasons, t.leagueSeasons],
    ['uniqueManagers', p.totals.uniqueManagers, t.uniqueRealManagers],
    ['commissioners', p.totals.commissioners, t.commissioners],
    ['transactions', p.totals.transactions, t.transactions],
    ['trades', p.totals.trades, t.trades],
    ['waivers', p.totals.waivers, t.waivers],
    ['freeAgents', p.totals.freeAgents, t.freeAgents],
    ['faab', p.totals.faab, t.faab],
    ['drafts', p.totals.drafts, t.drafts],
    ['draftPicks', p.totals.draftPicks, t.draftPicks],
    ['matchups', p.totals.matchups, t.matchupRecords],
    ['tradedFuturePicks', p.totals.tradedFuturePicks, t.tradedFuturePicks],
    ['rosters', p.totals.rosters, t.rosters],
  ]
  return pairs.map(([key, derived, manifest]) => ({ key, derived, manifest: Number(manifest), match: derived === Number(manifest) }))
}

export function deriveAll(snapshot: ExecSnapshot, generatedAt = new Date().toISOString()) {
  return {
    platform: derivePlatform(snapshot, generatedAt),
    league: deriveLeague(snapshot, generatedAt),
    commissioner: deriveCommissioner(snapshot, generatedAt),
    trade: deriveTrade(snapshot, generatedAt),
    waiver: deriveWaiver(snapshot, generatedAt),
    draft: deriveDraft(snapshot, generatedAt),
    manager: deriveManager(snapshot, generatedAt),
  }
}
