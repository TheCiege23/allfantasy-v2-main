/**
 * Decision OS telemetry gate-check script.
 *
 * Reads [decision-os] JSON events from stdin, counts parity events per slice, and reports
 * whether parity gate thresholds are met before Stage 1 production activation.
 *
 * Handles two input formats:
 *   • Plain: one raw log line per stdin line (may start with "[decision-os] {...}")
 *   • Vercel log drain JSON: each line is a JSON object with a "message" field
 *
 * INVOCATION:
 *   # From Vercel CLI log drain:
 *   vercel logs --json | npx tsx scripts/decision-os-telemetry-gate.ts
 *
 *   # From plain log export (one line per event):
 *   cat logs.txt | npx tsx scripts/decision-os-telemetry-gate.ts
 *
 *   # With time window (using vercel CLI):
 *   vercel logs --json --since 7d | npx tsx scripts/decision-os-telemetry-gate.ts
 *
 * GATE THRESHOLDS (ADR_PHASE4_CUTOVER_READINESS.md):
 *   parity_passed ≥ 500  for Lineup / Waiver / Trade
 *   parity_passed ≥ 100  for Commissioner
 *   parity_failed = 0    (ANY failure blocks the gate)
 *   shadow_error  ≤ 1%   of total shadow runs per slice
 *   enriched rate ≥ 95%  of LIVE runs returned decisionOs (Stage 1 soak quality)
 *
 * EXIT CODES:
 *   0 = all configured gates PASS
 *   1 = one or more gates BLOCKED
 */
import * as readline from 'node:readline'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionOsEvent {
  event: string
  decision_type: string
  decision_id?: string
  flags?: Record<string, unknown>
  at?: string
}

interface SliceStats {
  parityPassed: number
  parityFailed: number
  shadowError: number
  totalShadow: number
  liveEnriched: number
  liveTotal: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DECISION_TYPES = ['lineup.set', 'waiver.claim', 'trade.value', 'commissioner.league.health'] as const
type DecisionType = (typeof DECISION_TYPES)[number]

/** Gate thresholds per slice (from ADR_PHASE4_CUTOVER_READINESS.md) */
const PARITY_GATE: Record<DecisionType, number> = {
  'lineup.set': 500,
  'waiver.claim': 500,
  'trade.value': 500,
  'commissioner.league.health': 100,
}

const ENRICHED_RATE_MIN = 0.95   // ≥ 95% of LIVE runs should return decisionOs
const SHADOW_ERROR_MAX = 0.01    // ≤ 1% shadow error rate

// ─── Parse helpers ────────────────────────────────────────────────────────────

/** Extract a DecisionOsEvent from a single log line (plain or Vercel JSON format). */
function parseEventFromLine(line: string): DecisionOsEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // Vercel log drain format: the line is a JSON object with a "message" key
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const msg = typeof obj['message'] === 'string' ? obj['message'] : null
      if (msg) return extractEventFromMessage(msg)
      // Sometimes Vercel embeds the event directly in the drain payload
      if (typeof obj['event'] === 'string' && typeof obj['decision_type'] === 'string') {
        return obj as unknown as DecisionOsEvent
      }
    } catch {
      // fall through to plain format
    }
  }

  return extractEventFromMessage(trimmed)
}

function extractEventFromMessage(msg: string): DecisionOsEvent | null {
  // Plain format: "[decision-os] {...json...}"
  const prefix = '[decision-os] '
  const idx = msg.indexOf(prefix)
  if (idx === -1) return null
  const jsonStr = msg.slice(idx + prefix.length).trim()
  try {
    const parsed = JSON.parse(jsonStr) as DecisionOsEvent
    if (typeof parsed?.event !== 'string' || typeof parsed?.decision_type !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

// ─── Accumulate stats ─────────────────────────────────────────────────────────

function accumulate(stats: Map<string, SliceStats>, event: DecisionOsEvent): void {
  const dt = event.decision_type
  if (!stats.has(dt)) {
    stats.set(dt, { parityPassed: 0, parityFailed: 0, shadowError: 0, totalShadow: 0, liveEnriched: 0, liveTotal: 0 })
  }
  const s = stats.get(dt)!
  const flags = event.flags ?? {}

  if (event.event === 'decision.shadow_parity') {
    s.totalShadow++
    if (flags['shadow_error']) {
      s.shadowError++
    } else if (flags['parity_passed'] === true) {
      s.parityPassed++
    } else if (flags['parity_passed'] === false) {
      s.parityFailed++
    }
  } else if (event.event === 'decision.live_enrichment') {
    s.liveTotal++
    if (flags['enriched'] === true) s.liveEnriched++
  }
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

interface GateResult {
  slice: string
  parityPassedGate: { count: number; threshold: number; passed: boolean }
  parityFailedGate: { count: number; passed: boolean }
  shadowErrorGate: { rate: number; passed: boolean; total: number; errors: number } | null
  enrichedRateGate: { rate: number; passed: boolean; total: number; enriched: number } | null
  overallPass: boolean
}

function evaluateGate(dt: string, s: SliceStats): GateResult {
  const threshold = PARITY_GATE[dt as DecisionType] ?? 500
  const parityPassedGate = { count: s.parityPassed, threshold, passed: s.parityPassed >= threshold }
  const parityFailedGate = { count: s.parityFailed, passed: s.parityFailed === 0 }

  const shadowErrorGate = s.totalShadow > 0
    ? { rate: s.shadowError / s.totalShadow, passed: s.shadowError / s.totalShadow <= SHADOW_ERROR_MAX, total: s.totalShadow, errors: s.shadowError }
    : null

  const enrichedRateGate = s.liveTotal > 0
    ? { rate: s.liveEnriched / s.liveTotal, passed: s.liveEnriched / s.liveTotal >= ENRICHED_RATE_MIN, total: s.liveTotal, enriched: s.liveEnriched }
    : null

  const overallPass = parityPassedGate.passed && parityFailedGate.passed &&
    (shadowErrorGate === null || shadowErrorGate.passed) &&
    (enrichedRateGate === null || enrichedRateGate.passed)

  return { slice: dt, parityPassedGate, parityFailedGate, shadowErrorGate, enrichedRateGate, overallPass }
}

// ─── Print helpers ────────────────────────────────────────────────────────────

function pct(rate: number): string { return `${(rate * 100).toFixed(1)}%` }
function gateIcon(passed: boolean): string { return passed ? '✅' : '❌' }

function printResult(r: GateResult): void {
  const icon = r.overallPass ? '✅' : '❌'
  console.log(`\n${icon} ${r.slice.toUpperCase()}`)
  const pg = r.parityPassedGate
  console.log(`   parity_passed:  ${pg.count} / ${pg.threshold} required  ${gateIcon(pg.passed)}`)
  const fg = r.parityFailedGate
  console.log(`   parity_failed:  ${fg.count} (must be 0)  ${gateIcon(fg.passed)}`)
  if (r.shadowErrorGate) {
    const sg = r.shadowErrorGate
    console.log(`   shadow_error:   ${sg.errors} / ${sg.total} (${pct(sg.rate)}, max 1%)  ${gateIcon(sg.passed)}`)
  } else {
    console.log(`   shadow_error:   no shadow events seen`)
  }
  if (r.enrichedRateGate) {
    const eg = r.enrichedRateGate
    console.log(`   enriched_rate:  ${eg.enriched} / ${eg.total} (${pct(eg.rate)}, min 95%)  ${gateIcon(eg.passed)}`)
  } else {
    console.log(`   enriched_rate:  no LIVE events seen (Stage 1 not yet active for this slice)`)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Decision OS Telemetry Gate Check')
  console.log('Reading [decision-os] events from stdin...\n')

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  const stats = new Map<string, SliceStats>()
  let totalLines = 0
  let parsedEvents = 0

  for await (const line of rl) {
    totalLines++
    const event = parseEventFromLine(line)
    if (event) {
      parsedEvents++
      accumulate(stats, event)
    }
  }

  console.log(`Lines read: ${totalLines}  |  Decision OS events parsed: ${parsedEvents}`)

  if (parsedEvents === 0) {
    console.log('\n⚠️  No [decision-os] events found in input.')
    console.log('Ensure the Vercel log drain is configured and the shadow is running.')
    console.log('\nDECISION_OS_TELEMETRY_GATE_BLOCKED (no events)')
    process.exit(1)
  }

  const results: GateResult[] = []
  // Report known slices first, then any unexpected decision_types
  const knownTypes = new Set<string>(DECISION_TYPES)
  for (const dt of DECISION_TYPES) {
    const s = stats.get(dt)
    if (!s) {
      console.log(`\n⚠️  ${dt.toUpperCase()}: no events seen`)
      continue
    }
    const r = evaluateGate(dt, s)
    results.push(r)
    printResult(r)
  }
  for (const [dt, s] of stats) {
    if (!knownTypes.has(dt)) {
      const r = evaluateGate(dt, s)
      results.push(r)
      printResult(r)
    }
  }

  const allPass = results.every((r) => r.overallPass)
  console.log('')
  if (allPass) {
    console.log('DECISION_OS_TELEMETRY_GATE_OK')
    process.exit(0)
  } else {
    const blocked = results.filter((r) => !r.overallPass).map((r) => r.slice).join(', ')
    console.log(`DECISION_OS_TELEMETRY_GATE_BLOCKED  (${blocked})`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[decision-os-telemetry-gate] fatal:', err)
  process.exit(1)
})
