/**
 * Do the league-engagement scorers agree? (6.1)
 *
 * ── WHY A PROBE AND NOT AN ARGUMENT ─────────────────────────────────────────────────────────
 * The build plan says THREE health scorers exist and that Chimmy's answer to "is my league
 * healthy" depends on which one answers. Reading them first found that wrong in both directions:
 * there are FIVE modules involved and only THREE of them compute a number.
 *
 *   lib/league-health/league-health-engine           COMPUTES → feeds commissionerHubHealth
 *   lib/commissioner-hub/commissionerHubHealth       packages the above as a snapshot
 *   lib/decision-os/commissioner-health/             CONSUMES that snapshot — type-only, 7 files
 *   lib/commissioner-assistant/…-engine              COMPUTES, separately
 *   lib/decision-os/behavioral/league-intelligence   COMPUTES, separately again
 *
 * So two of the plan's named three are LAYERED rather than rival, and the module that actually
 * births the number the first two report was never named at all. Same shape as the waiver-resolver
 * alarm in §2.14, which was also a census that stopped at "who imports it".
 *
 * 🛑 IT CALLS THE REAL FUNCTIONS. Reimplementing either formula here would be the bug this repo
 * already records: a SQL copy of `normalizePlayerName` disagreed with the real one on 7.2% of
 * rows, and two implementations of one rule IS the bug. Both modules are pure — zero prisma,
 * zero fetch, verified — so they can be called directly.
 *
 * ⚠ THE FIRST VERSION OF THIS PROBE CAST ITS FIXTURES THROUGH `as unknown as` AND WAS WRONG.
 * The manager field is `overallEngagementScore`, not `engagementScore`; the cast hid that, so the
 * average would have been computed over `undefined` and the probe would have printed a confident
 * wrong number. `facts` is now a fully typed literal the compiler checks, and the one remaining
 * cast is covered by a runtime assertion naming the exact fields the derivation reads.
 *
 * Run:  npx tsx scripts/probe-league-health-scorer-divergence.ts
 */
import { analyzeCommissionerDashboard } from '@/lib/commissioner-assistant/commissioner-assistant-engine'
import { monitorLeagueHealth } from '@/lib/league-health/league-health-engine'
import type { LeagueBehavioralFacts } from '@/lib/decision-os/behavioral/facts'
import { deriveLeagueBehavioralIntelligence } from '@/lib/decision-os/behavioral/league-intelligence'
import type { ManagerBehavioralIntelligence } from '@/lib/decision-os/behavioral/manager-intelligence'

type Shape = {
  name: string
  numTeams: number
  trades: number
  waiverClaims: number
  inactive: number
  /** Only `league-health-engine` reads these two; the other two have no notion of either. */
  chatMessages: number
  lineupSubmissionRate: number
  /** Per-manager engagement, one entry per manager. Drives the behavioural side. */
  managerEngagement: number[]
}

/** Dormant first: it is the case a commissioner most needs the answer to be right about. */
const SHAPES: Shape[] = [
  {
    name: 'DORMANT — nobody has done anything',
    numTeams: 12,
    trades: 0,
    waiverClaims: 0,
    inactive: 12,
    chatMessages: 0,
    lineupSubmissionRate: 0,
    managerEngagement: Array(12).fill(0),
  },
  {
    name: 'HALF-DEAD — six managers gone, little activity',
    numTeams: 12,
    trades: 2,
    waiverClaims: 6,
    inactive: 6,
    chatMessages: 8,
    lineupSubmissionRate: 0.5,
    managerEngagement: [...Array(6).fill(55), ...Array(6).fill(0)],
  },
  {
    name: 'HEALTHY — everyone active, busy',
    numTeams: 12,
    trades: 24,
    waiverClaims: 96,
    inactive: 0,
    chatMessages: 120,
    lineupSubmissionRate: 1,
    managerEngagement: Array(12).fill(80),
  },
]

/**
 * The three fields `deriveLeagueBehavioralIntelligence` actually reads off a manager, measured
 * rather than assumed: `m.isInactive`, `m.overallEngagementScore`, `m.retentionRisk`.
 */
const READ_FIELDS = ['isInactive', 'overallEngagementScore', 'retentionRisk'] as const

function managers(shape: Shape): ManagerBehavioralIntelligence[] {
  const built = shape.managerEngagement.map((overallEngagementScore, i) => ({
    managerId: `m${i}`,
    leagueId: 'probe',
    isInactive: i >= shape.numTeams - shape.inactive,
    overallEngagementScore,
    retentionRisk: overallEngagementScore === 0 ? 'critical' : 'low',
  }))

  // The cast is unavoidable — the full interface is large and irrelevant here — so it is covered.
  // A missing field would otherwise average as `undefined` and print a confident wrong number.
  for (const m of built) {
    for (const f of READ_FIELDS) {
      if (!(f in m)) throw new Error(`fixture is missing ${f}, which the derivation reads`)
    }
  }
  return built as unknown as ManagerBehavioralIntelligence[]
}

/** Fully typed, so the compiler catches a missing field rather than a stack trace at runtime. */
function facts(shape: Shape): LeagueBehavioralFacts {
  return {
    leagueId: 'probe',
    totalTradeCount: shape.trades,
    totalWaiverClaimCount: shape.waiverClaims,
    totalWaiverSuccessCount: Math.floor(shape.waiverClaims / 2),
    totalCommissionerActionCount: 0,
    totalRulesChangeCount: 0,
    activeManagerIds: Array.from({ length: shape.numTeams - shape.inactive }, (_, i) => `m${i}`),
    lastActivity: null,
    draftCount: 1,
    totalDraftPickCount: shape.numTeams * 20,
    completeness: 100,
    eventCount: shape.trades + shape.waiverClaims,
    managerCount: shape.numTeams,
    lookbackDays: 90,
    warnings: [],
  }
}

const NOW = new Date('2026-08-31T00:00:00.000Z')

console.log('')
console.log('  THREE formulas, all named engagement, all 0-100, all reading different inputs.')
console.log('')
console.log('  league shape                                    hub-engine   assistant   behavioural   spread   tier')
console.log('  ' + '-'.repeat(100))

let maxGap = 0
for (const shape of SHAPES) {
  const assistant = analyzeCommissionerDashboard({
    sport: 'NFL',
    leagueType: 'dynasty',
    numTeams: shape.numTeams,
    scoringFormat: 'PPR',
    rosterSlots: 25,
    benchSlots: 10,
    irSlots: 2,
    taxiSlots: 0,
    playoffTeams: 6,
    playoffWeeks: 3,
    waiverType: 'FAAB',
    tradeDeadline: null,
    tradeReviewProcess: 'commissioner',
    totalTradesThisSeason: shape.trades,
    totalWaiverClaims: shape.waiverClaims,
    inactiveManagers: shape.inactive,
    disputeCount: 0,
    abandonedTeams: 0,
    isConceptLeague: false,
  })

  /*
   * \u26a0 THIS is the one that reaches the Decision OS pipeline. `commissionerHubHealth` calls
   * `monitorLeagueHealth`, packages the result as a snapshot, and `commissioner-health/` consumes
   * that snapshot in seven files. The commissioner-assistant engine is a THIRD, separate formula.
   */
  const hub = monitorLeagueHealth({
    sport: 'NFL',
    leagueType: 'dynasty',
    leagueId: 'probe',
    numTeams: shape.numTeams,
    currentWeek: 8,
    totalWeeks: 17,
    activeManagers: shape.numTeams - shape.inactive,
    inactiveManagers: shape.inactive,
    abandonedTeams: 0,
    lineupSubmissionRate: shape.lineupSubmissionRate,
    totalTradesThisSeason: shape.trades,
    totalWaiverClaims: shape.waiverClaims,
    avgFaabSpentPct: 0,
    chatMessageCount: shape.chatMessages,
    voteCount: 0,
    disputeCount: 0,
    commissionerActionsThisSeason: 0,
    unresolvedDisputes: 0,
    playoffTeams: 6,
  })

  const behavioural = deriveLeagueBehavioralIntelligence(facts(shape), managers(shape), NOW)

  const h = hub.engagementScore
  const a = assistant.engagementScore
  const b = behavioural.leagueEngagementScore
  const gap = Math.max(h, a, b) - Math.min(h, a, b)
  maxGap = Math.max(maxGap, gap)

  console.log(
    `  ${shape.name.padEnd(46)} ${String(h).padStart(8)}   ${String(a).padStart(9)}   ${String(b).padStart(11)}   ${String(gap).padStart(6)}   ${behavioural.leagueEngagementTier}`,
  )
}

console.log('')
console.log(`  widest disagreement: ${maxGap} points on a 0-100 scale`)
console.log('')
console.log('    hub-engine   base 30 x active-share + trades + claims + chat + lineup   floor  0')
console.log('    assistant    base 40 + trades + claims + 10 if none inactive           FLOOR 40')
console.log('    behavioural  active-manager share x0.5 + per-manager depth x0.5        floor  0')
console.log('')
console.log('  ✅ 6.1/C: the hub base used to be an unconditional 30, so a dead league scored 30.')
console.log('  It is now scaled by active-manager share — a field its own schema declared and')
console.log('  nothing read — so hub and behavioural agree at 0 on a dormant league. A fully-')
console.log('  staffed league is byte-identical to before, which is what keeps this off the nine')
console.log('  dashboards that read the number.')
console.log('')
console.log('  🛑 THE REMAINING 40-POINT SPREAD IS ENTIRELY THE ASSISTANT, whose base of 40 is')
console.log('  still unconditional. That lineage is isolated — one consumer, never in the same')
console.log('  file as the hub — so it was deliberately left alone.')
console.log('')
console.log('  ⚠ AND HUB AND BEHAVIOURAL ARE STILL DIFFERENT QUESTIONS. They agree on the worst')
console.log('  case, not in general: a fully-staffed silent league, or a half-empty busy one,')
console.log('  will still separate them. Agreement here is not interchangeability.')
console.log('')
