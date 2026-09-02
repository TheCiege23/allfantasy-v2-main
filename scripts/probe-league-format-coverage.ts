/**
 * READ-ONLY, PURE, OFFLINE. What does the value engine actually know about each LEAGUE FORMAT?
 * Never opens a socket, never touches Postgres, never calls a provider.
 *
 * ── WHY, AND WHY THIS FILE WAS REWRITTEN ────────────────────────────────────────────────────
 * The first version of this probe listed league types from a HARDCODED `ls` of `lib/`, and so
 * reported nine. That was wrong by omission — it silently dropped `big_brother` (91 references
 * in source), `exile` (77), `king_of_the_hill` (18) and `pirate` (12), each of which has real
 * code behind it. Guessing a list and then measuring the guess is not a census.
 *
 * So the format list below is derived from EVIDENCE and the evidence is cited per row:
 * occurrence counts of the type's own string literal across lib/, app/ and types/, plus the
 * `__tests__/*-trade-value.test.ts` file that exists for it, plus its `supabase_ensure_*.sql`.
 *
 * ── THE DEEPER FINDING THIS VERSION ADDS ────────────────────────────────────────────────────
 * QB demand is a CONTINUOUS variable — how many quarterbacks a league forces you to start — and
 * every layer of this stack models it as a 2-state boolean. A league starting FOUR quarterbacks
 * is, to the value engine, the same as one starting two.
 *
 * ── 🛑 PURE ON PURPOSE ──────────────────────────────────────────────────────────────────────
 * Importing anything that reaches `@prisma/client` populates `process.env` from `.env` ON IMPORT
 * (CLAUDE.md), which on this repo resolves to the PRODUCTION Neon endpoint. This probe imports
 * only `lib/trade-value/valueEngine` and `lib/core-app/slotEligibility`, both pure.
 *
 * Run:  npx tsx scripts/probe-league-format-coverage.ts
 * Exit: 0 = controls fired, results trustworthy. 1 = a control failed; ignore the output.
 */

import {
  POSITION_SCARCITY,
  SUPERFLEX_QB_MULTIPLIER,
  TWO_QB_MULTIPLIER,
  TE_PREMIUM_PER_POINT,
  type ScoringContext,
  normalizedPlayerValue,
  scoringScarcityMultiplier,
} from '../lib/trade-value/valueEngine'
import { starterNeedsFromSlots } from '../lib/core-app/slotEligibility'

let controlFailures = 0
const findings: string[] = []

const head = (t: string) => console.log(`\n${'═'.repeat(84)}\n${t}\n${'═'.repeat(84)}`)
function control(desc: string, ok: boolean): void {
  if (ok) console.log(`  ✅ POSITIVE CONTROL fired — ${desc}`)
  else {
    controlFailures += 1
    console.log(`  🛑 POSITIVE CONTROL DID NOT FIRE — ${desc}\n     This section is NOT trustworthy.`)
  }
}
function finding(t: string): void {
  findings.push(t)
  console.log(`  ⚠ ${t}`)
}
const r3 = (n: number) => Math.round(n * 1000) / 1000

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — QB demand is continuous; the model is a boolean
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionQbCount(): void {
  head('SECTION 1 — N-QB leagues: 1QB · SF · 2QB · 3QB · 4QB ("Four Horsemen") · 6QB')

  /** Realistic `roster_positions` arrays, in the vocabulary SLOT_POSITIONS actually accepts. */
  const shapes: Array<{ label: string; slots: string[] }> = [
    { label: '1QB',            slots: ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF'] },
    { label: 'Superflex',      slots: ['QB','RB','RB','WR','WR','TE','SUPER_FLEX','K','DEF'] },
    { label: '2QB',            slots: ['QB','QB','RB','RB','WR','WR','TE','FLEX','K','DEF'] },
    { label: '3QB',            slots: ['QB','QB','QB','RB','RB','WR','WR','TE','FLEX'] },
    { label: '4QB (Horsemen)', slots: ['QB','QB','QB','QB','RB','RB','RB','WR','WR','WR','TE','TE','FLEX','FLEX'] },
    { label: '6QB (extreme)',  slots: ['QB','QB','QB','QB','QB','QB','RB','RB','WR','WR','TE','FLEX'] },
  ]

  console.log('\n  What `starterNeedsFromSlots` returns, and what survives into the value engine.\n')
  console.log('    league          QB slots   needs.QB   superflex   QB multiplier   380-pt QB')
  console.log('    ' + '─'.repeat(80))

  const multipliers = new Set<number>()
  const values = new Set<number>()
  const rows: Array<{ label: string; qbSlots: number; needsQb: number; mult: number; value: number }> = []

  for (const s of shapes) {
    const derived = starterNeedsFromSlots(s.slots)
    const qbSlots = s.slots.filter((x) => x === 'QB').length
    const needsQb = derived.needs.QB ?? 0

    // This is the ONLY thing that reaches the value engine today: a boolean.
    const ctx: ScoringContext = { isSuperflex: derived.superflex }
    const mult = scoringScarcityMultiplier('QB', ctx)
    const value = normalizedPlayerValue({ projection: 380, position: 'QB', scoring: ctx })

    multipliers.add(mult)
    values.add(value)
    rows.push({ label: s.label, qbSlots, needsQb, mult, value })

    console.log(
      `    ${s.label.padEnd(15)} ${String(qbSlots).padEnd(10)} ${String(needsQb).padEnd(10)} ` +
        `${String(derived.superflex).padEnd(11)} ${String(r3(mult)).padEnd(15)} ${value}`,
    )
  }

  console.log()
  // CONTROL: needs.QB must actually track the slot count, or the "count survives" claim is false.
  const countTracks = rows.every((r) => r.needsQb === r.qbSlots)
  control('needs.QB tracks the real dedicated-QB slot count in every shape', countTracks)
  // CONTROL: the engine can distinguish SOMETHING here (1QB vs the rest), else we measure nothing.
  control('1QB is distinguishable from the multi-QB shapes', multipliers.size > 1)

  const multiQb = rows.filter((r) => r.qbSlots >= 2)
  const allSameMult = new Set(multiQb.map((r) => r.mult)).size === 1
  if (allSameMult && multiQb.length > 1) {
    finding(
      `2QB, 3QB, 4QB and 6QB all receive the SAME QB multiplier (${r3(multiQb[0].mult)}) and the same ` +
        `price (${multiQb[0].value}). QB demand is continuous — a 4QB league needs twice the startable ` +
        `quarterbacks a 2QB league does — and every layer models it as a boolean. A "Four Horsemen" ` +
        `league starting four QBs is, to this engine, a superflex league.`,
    )
  }

  console.log(`
  WHERE THE COUNT IS LOST — lib/core-app/slotEligibility.ts:210-228

      let dedicatedQb = 0
      ...
      if (eligible[0] === 'QB') dedicatedQb++          // the real number, counted
      ...
      if (dedicatedQb > 1) superflex = true            // collapsed to a boolean, then discarded

  \`dedicatedQb\` is never returned; \`StarterNeeds\` has no field for it. GOOD NEWS: the count DOES
  survive as \`needs.QB\`, so the fix is threading a number that already exists — not new plumbing.

  ⚠ AND THE COMMENT ON LINE 225 CONTRADICTS THE VALUE ENGINE. It says 2QB "prices quarterbacks like
     superflex does". The engine disagrees with itself: TWO_QB_MULTIPLIER=${TWO_QB_MULTIPLIER} vs
     SUPERFLEX_QB_MULTIPLIER=${SUPERFLEX_QB_MULTIPLIER}. One of the two files is wrong and nothing
     reconciles them, because the slot resolver's boolean can only ever select the superflex branch.`)

  const engineDisagrees = TWO_QB_MULTIPLIER !== SUPERFLEX_QB_MULTIPLIER
  control('the value engine really does price 2QB differently from superflex', engineDisagrees)
  if (engineDisagrees) {
    finding(
      `slotEligibility.ts:225 asserts 2QB "prices quarterbacks like superflex does"; valueEngine.ts ` +
        `prices them ${TWO_QB_MULTIPLIER} vs ${SUPERFLEX_QB_MULTIPLIER}. Because the resolver only emits ` +
        `\`superflex: boolean\`, is2QB can NEVER be set from roster slots — the 1.8 branch is unreachable ` +
        `except via the substring match in describedTradeEvaluator.ts:91.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — the real format census, from evidence
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface FormatRow {
  type: string
  refs: number
  tradeTest: boolean
  needs: string
}

/**
 * Occurrence counts of each type's own string literal across lib/, app/ and types/, measured
 * 2026-09-01. `tradeTest` = a `__tests__/<type>-trade-value.test.ts` exists.
 */
const FORMATS: FormatRow[] = [
  { type: 'redraft',          refs: 652, tradeTest: false, needs: 'baseline — win-now only, no future value' },
  { type: 'dynasty',          refs: 612, tradeTest: false, needs: 'age curve, rookie picks, contention window' },
  { type: 'devy',             refs: 416, tradeTest: true,  needs: 'separate currency (devy_points); arrival horizon' },
  { type: 'survivor',         refs: 265, tradeTest: true,  needs: 'weekly-survival value, not season-long points' },
  { type: 'keeper',           refs: 250, tradeTest: false, needs: 'keeper cost/round, years of control remaining' },
  { type: 'zombie',           refs: 201, tradeTest: true,  needs: 'elimination/revival state changes asset horizon' },
  { type: 'tournament',       refs: 173, tradeTest: true,  needs: 'advancement odds; value ends at elimination' },
  { type: 'guillotine',       refs: 165, tradeTest: true,  needs: 'survival-weighted; a cut team\'s roster hits waivers' },
  { type: 'best_ball',        refs: 187, tradeTest: false, needs: 'ceiling/variance over floor; often no trades at all' },
  { type: 'big_brother',      refs:  91, tradeTest: false, needs: 'HOH/eviction state; alliance + immunity affect horizon' },
  { type: 'exile',            refs:  77, tradeTest: false, needs: 'exile draft rules; removed-player pool' },
  { type: 'salary_cap',       refs:  78, tradeTest: false, needs: 'contract $ and cap space ARE part of the price' },
  { type: 'idol',             refs:  19, tradeTest: false, needs: 'idol possession is a tradeable non-player asset' },
  { type: 'king_of_the_hill', refs:  18, tradeTest: true,  needs: 'streak/throne state; value of holding vs taking' },
  { type: 'lottery',          refs:  17, tradeTest: false, needs: 'weighted pick odds change pick value directly' },
  { type: 'pirate',           refs:  12, tradeTest: true,  needs: 'steal/plunder mechanics — asset can be TAKEN, not traded' },
]

function sectionFormatCensus(): void {
  head('SECTION 2 — every league format with real code, priced identically')

  console.log('\n  Same player (WR, 240 projected points) under every format the codebase implements.')
  console.log('  `refs` = occurrences of the type\'s string literal in lib/ + app/ + types/.')
  console.log('  `tt`   = a dedicated __tests__/<type>-trade-value.test.ts exists.\n')
  console.log('    format             refs   tt   value    what its value model would need')
  console.log('    ' + '─'.repeat(104))

  const values = new Set<number>()
  for (const f of FORMATS) {
    // There is deliberately no argument for f.type — that IS the finding.
    const v = normalizedPlayerValue({ projection: 240, position: 'WR' })
    values.add(v)
    console.log(
      `    ${f.type.padEnd(18)} ${String(f.refs).padEnd(6)} ${(f.tradeTest ? '✓' : ' ').padEnd(4)} ` +
        `${String(v).padEnd(8)} ${f.needs}`,
    )
  }

  console.log()
  const canVary = new Set([
    normalizedPlayerValue({ projection: 240, position: 'WR' }),
    normalizedPlayerValue({ projection: 240, position: 'WR', scoring: { scoringFormat: 'ppr' } }),
    normalizedPlayerValue({ projection: 240, position: 'TE', scoring: { tePremium: 1 } }),
  ]).size
  control('the engine DOES vary output for inputs it understands (scoring format, TE premium)', canVary > 1)

  const withTests = FORMATS.filter((f) => f.tradeTest).length
  if (values.size === 1) {
    finding(
      `All ${FORMATS.length} implemented formats price identically (${[...values][0]}). ${withTests} of them ` +
        `have a dedicated *-trade-value test file, so trades in them are a shipped feature — the tests ` +
        `pin the surrounding plumbing, not a format-specific price. \`ScoringContext\` has no field a ` +
        `league type can travel through, and \`TradeValueContext.leagueType\` is persisted on every ` +
        `snapshot and read by nothing in the valuation.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — roster depth
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionRosterDepth(): void {
  head('SECTION 3 — roster size and starter count: replacement level is not modelled')

  const leagues = [
    { label: '10-tm shallow', teams: 10, starters: 8,  bench: 5  },
    { label: '12-tm standard', teams: 12, starters: 9,  bench: 6  },
    { label: '14-tm deep',     teams: 14, starters: 11, bench: 8  },
    { label: 'Horsemen XL',    teams: 12, starters: 14, bench: 20 },
  ]

  console.log('\n  Rostered players = teams × (starters + bench). The deeper the league, the worse the')
  console.log('  best available free agent — which is exactly what "replacement level" means, and')
  console.log('  what positional scarcity is a proxy for.\n')
  console.log('    league           teams  starters  bench  rostered   WR value')
  console.log('    ' + '─'.repeat(66))

  const values = new Set<number>()
  for (const l of leagues) {
    const rostered = l.teams * (l.starters + l.bench)
    const v = normalizedPlayerValue({ projection: 240, position: 'WR' })
    values.add(v)
    console.log(
      `    ${l.label.padEnd(16)} ${String(l.teams).padEnd(6)} ${String(l.starters).padEnd(9)} ` +
        `${String(l.bench).padEnd(6)} ${String(rostered).padEnd(10)} ${v}`,
    )
  }

  console.log()
  control('the engine varies WR value when given a scoring input it understands',
    normalizedPlayerValue({ projection: 240, position: 'WR' }) !==
    normalizedPlayerValue({ projection: 240, position: 'WR', scoring: { scoringFormat: 'ppr' } }))

  if (values.size === 1) {
    finding(
      `A 10-team league rostering 130 players and a 12-team league rostering 408 price the same WR ` +
        `identically (${[...values][0]}). \`normalizedPlayerValue\` takes no league size, no starter ` +
        `count and no bench depth. POSITION_SCARCITY is one fixed table — RB 1.15, WR 1.05, TE 1.0, ` +
        `QB 0.85 — tuned for 12-team 1-QB standard and applied to all ${FORMATS.length} formats above.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 4 — the expressible/inexpressible ledger
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionLedger(): void {
  head('SECTION 4 — everything the value engine can and cannot express about a league')

  const expressible: Array<[string, string]> = [
    ['isSuperflex',   `QB × ${SUPERFLEX_QB_MULTIPLIER}`],
    ['is2QB',         `QB × ${TWO_QB_MULTIPLIER} — unreachable from roster slots (see §1)`],
    ['tePremium',     `TE × (1 + prem × ${TE_PREMIUM_PER_POINT}), capped`],
    ['scoringFormat', 'WR +8% / TE +10% / RB +4% at full PPR; half at half-PPR'],
  ]
  const missing: Array<[string, string]> = [
    ['QB starter COUNT',     '3QB/4QB/6QB indistinguishable from 2QB — §1'],
    ['league type',          `all ${FORMATS.length} formats in §2 price identically`],
    ['league size',          'sets replacement level'],
    ['starter count',        'sets replacement level'],
    ['bench / roster depth', 'a 20-man bench changes what a stash is worth'],
    ['IDP starting slots',   'engine consumes a finished idpValue; cannot derive one'],
    ['kicker slots',         'no kicker projection model at all (audit P1)'],
    ['playoff weeks',        'when value stops mattering'],
    ['taxi / IR slots',      'free stash capacity'],
    ['trade deadline',       'after it a rental is worth nothing in redraft'],
    ['cap space / contracts', 'salary_cap: the money IS part of the price'],
    ['elimination state',    'guillotine / survivor / zombie / big_brother / KOTH'],
  ]

  console.log('\n  EXPRESSIBLE (4):')
  for (const [k, v] of expressible) console.log(`    ✅ ${k.padEnd(22)} ${v}`)
  console.log(`\n  NOT EXPRESSIBLE (${missing.length}):`)
  for (const [k, v] of missing) console.log(`    ❌ ${k.padEnd(22)} ${v}`)

  console.log()
  control('inexpressible facts outnumber expressible ones', missing.length > expressible.length)
  finding(
    `${expressible.length} league facts expressible, ${missing.length} not. Three of the missing four ` +
      `that matter most — QB starter count, league size, starter count — are already COMPUTED elsewhere ` +
      `in this codebase (starterNeedsFromSlots returns needs + flex; league size is on the world). They ` +
      `are lost at the ScoringContext boundary, not unavailable. That makes this a plumbing problem ` +
      `before it is a modelling one.`,
  )
}

function main(): void {
  console.log('AF LEAGUE-FORMAT COVERAGE PROBE — pure, offline, read-only')
  console.log('No database connection. No provider call. No writes.')

  sectionQbCount()
  sectionFormatCensus()
  sectionRosterDepth()
  sectionLedger()

  head('SUMMARY')
  if (controlFailures > 0) {
    console.log(`\n  🛑 ${controlFailures} POSITIVE CONTROL(S) FAILED — results untrustworthy.\n`)
    process.exitCode = 1
    return
  }
  console.log(`\n  All positive controls fired. ${findings.length} finding(s):\n`)
  findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}\n`))
  process.exitCode = 0
}

main()
