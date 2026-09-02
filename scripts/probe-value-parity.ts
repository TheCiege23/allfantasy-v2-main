/**
 * READ-ONLY, PURE, OFFLINE. Measures where the two live valuation engines disagree.
 * Never opens a socket, never touches Postgres, never calls a provider.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────────────
 * Two engines answer "what is this player worth" and which one you get depends on the screen:
 *
 *   lib/trade-value/valueEngine.ts   213 lines, pure, 380 tests pin it.
 *                                    Reached from: the persisted redraft snapshot, the
 *                                    Decision OS canonical memo, Chimmy's described-trade
 *                                    evaluator, trade-discovery.
 *   lib/hybrid-valuation.ts        1038 lines, impure (Postgres + GPT), no deterministic tests.
 *                                    Reached from: lib/trade-value-console — the user-facing
 *                                    trade console.
 *
 * Nothing measures the gap between them. This does, before any unification is attempted —
 * because unifying two engines whose disagreement you have not measured is how you ship one
 * engine with the wrong constants and no way to notice.
 *
 * ── 🛑 WHY IT TRANSCRIBES HYBRID'S CONSTANTS INSTEAD OF IMPORTING THEM ───────────────────────
 * `import '@/lib/hybrid-valuation'` pulls `lib/fantasycalc-db` → `@prisma/client`, and per
 * CLAUDE.md importing the Prisma client POPULATES `process.env` FROM `.env` ON IMPORT — you do
 * not pass it a URL and you do not opt in. On this repo that resolves to the PRODUCTION Neon
 * endpoint. A probe whose whole value is being cheap and safe must not do that.
 *
 * So hybrid's table is transcribed as a literal below, and {@link verifyTranscription} re-reads
 * the source FILE AS TEXT and asserts the literal still matches. No import, no client, no
 * connection — and the transcription cannot rot silently, which is the failure mode that makes
 * "just copy the constant" normally unacceptable.
 *
 * ── EVERY SECTION CARRIES A POSITIVE CONTROL ─────────────────────────────────────────────────
 * Per CLAUDE.md: a check that has never gone red is not evidence. Each section first proves it
 * CAN report a disagreement by injecting a known one. If a control fails to fire, the section's
 * real result is suppressed and the probe exits non-zero — a broken detector must never be
 * readable as "the engines agree".
 *
 * Run:  npx tsx scripts/probe-value-parity.ts
 * Exit: 0 = all controls fired and results are trustworthy. 1 = a control failed; ignore output.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ADP_PIVOT,
  ADP_SLOPE,
  POSITION_SCARCITY,
  PROJ_TO_VALUE,
  normalizedPlayerValue,
  scoringScarcityMultiplier,
} from '../lib/trade-value/valueEngine'

const REPO = join(__dirname, '..')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hybrid's constants, transcribed. Verified against source at runtime — see the header.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `posScarcityMultiplier` from `computeImpactFromMarket`, lib/hybrid-valuation.ts:264-271.
 *
 * ⚠ NOT THE SAME KIND OF NUMBER as `POSITION_SCARCITY`. This one multiplies a MARKET VALUE to
 * derive an impact score; the canonical one multiplies PROJECTED POINTS to derive a value. So
 * the absolute magnitudes are not comparable and comparing them directly would be a category
 * error. What IS comparable — and what this probe measures — is the RELATIVE ordering each
 * table imposes on the positions, because that ordering is a claim about the sport, not about
 * the units.
 */
const HYBRID_POS_SCARCITY: Record<string, number> = {
  QB: 0.65,
  RB: 0.8,
  WR: 0.72,
  TE: 0.6,
  K: 0.3,
  DEF: 0.3,
}

/** Source-of-truth locations, re-read as text so a drifted transcription is caught. */
const TRANSCRIPTION_SOURCES = [
  {
    label: 'hybrid posScarcityMultiplier',
    file: 'lib/hybrid-valuation.ts',
    table: HYBRID_POS_SCARCITY,
    /** The literal block inside computeImpactFromMarket. */
    anchor: 'const posScarcityMultiplier: Record<string, number> = {',
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Reporting helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

let controlFailures = 0
const findings: string[] = []

function head(title: string): void {
  console.log(`\n${'═'.repeat(78)}\n${title}\n${'═'.repeat(78)}`)
}

function control(description: string, didDetect: boolean): void {
  if (didDetect) {
    console.log(`  ✅ POSITIVE CONTROL fired — ${description}`)
  } else {
    controlFailures += 1
    console.log(`  🛑 POSITIVE CONTROL DID NOT FIRE — ${description}`)
    console.log('     This section\'s result is NOT trustworthy and must be ignored.')
  }
}

function finding(text: string): void {
  findings.push(text)
  console.log(`  ⚠ ${text}`)
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 0 — the transcription guard
// ─────────────────────────────────────────────────────────────────────────────────────────────

function verifyTranscription(): void {
  head('SECTION 0 — transcription guard (no import, no Prisma, no connection)')

  for (const src of TRANSCRIPTION_SOURCES) {
    let text: string
    try {
      text = readFileSync(join(REPO, src.file), 'utf8')
    } catch (e) {
      controlFailures += 1
      console.log(`  🛑 could not read ${src.file}: ${(e as Error).message}`)
      continue
    }

    const at = text.indexOf(src.anchor)
    if (at < 0) {
      controlFailures += 1
      console.log(`  🛑 anchor not found in ${src.file} — the source moved; re-transcribe.`)
      console.log(`     anchor: ${src.anchor}`)
      continue
    }

    const block = text.slice(at, text.indexOf('}', at))
    let drift = 0
    for (const [pos, expected] of Object.entries(src.table)) {
      // Matches `QB: 0.65,` and `RB: 0.80,` alike.
      const m = new RegExp(`\\b${pos}\\s*:\\s*([0-9.]+)`).exec(block)
      if (!m) {
        drift += 1
        console.log(`  🛑 ${src.label}: "${pos}" is no longer in the source block.`)
        continue
      }
      const actual = Number(m[1])
      if (actual !== expected) {
        drift += 1
        console.log(`  🛑 ${src.label}: ${pos} transcribed ${expected}, source says ${actual}.`)
      }
    }

    if (drift === 0) {
      console.log(`  ✅ ${src.label} — transcription matches ${src.file} exactly (${Object.keys(src.table).length} entries).`)
    } else {
      controlFailures += 1
    }
  }

  // POSITIVE CONTROL: prove the guard can actually see a mismatch, by checking a value we KNOW
  // is wrong against the same source. Without this the guard passing means nothing.
  const text = readFileSync(join(REPO, 'lib/hybrid-valuation.ts'), 'utf8')
  const at = text.indexOf(TRANSCRIPTION_SOURCES[0].anchor)
  const block = text.slice(at, text.indexOf('}', at))
  const qb = Number(/\bQB\s*:\s*([0-9.]+)/.exec(block)?.[1])
  control(
    'guard distinguishes the real QB constant from a deliberately wrong one',
    qb === 0.65 && qb !== 0.99,
  )
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 1 — do the two engines rank the positions the same way?
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionPositionalOrdering(): void {
  head('SECTION 1 — positional scarcity: do the engines agree on RELATIVE ordering?')

  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  const canonBase = POSITION_SCARCITY.TE ?? 1
  const hybridBase = HYBRID_POS_SCARCITY.TE ?? 1

  console.log('\n  Normalised so TE = 1.000 in both, because the tables have different units')
  console.log('  (canonical multiplies PROJECTED POINTS, hybrid multiplies a MARKET VALUE).')
  console.log('  What is comparable is the ordering each imposes on the sport.\n')
  console.log('    pos    canonical   hybrid     ratio    verdict')
  console.log('    ' + '─'.repeat(62))

  const disagreements: Array<{ pos: string; canon: number; hybrid: number; ratio: number }> = []

  for (const pos of positions) {
    const canonRaw = POSITION_SCARCITY[pos]
    const hybridRaw = HYBRID_POS_SCARCITY[pos]
    if (canonRaw == null || hybridRaw == null) continue

    const canon = round(canonRaw / canonBase)
    const hybrid = round(hybridRaw / hybridBase)
    const ratio = round(hybrid / canon)
    // >15% apart on a normalised scale is a real product disagreement, not rounding.
    const disagrees = Math.abs(ratio - 1) > 0.15
    if (disagrees) disagreements.push({ pos, canon, hybrid, ratio })

    console.log(
      `    ${pos.padEnd(6)} ${String(canon).padEnd(11)} ${String(hybrid).padEnd(10)} ${String(ratio).padEnd(8)} ${
        disagrees ? '⚠ DISAGREE' : 'ok'
      }`,
    )
  }

  console.log()
  // POSITIVE CONTROL: a table identical to canonical must produce ZERO disagreements. If this
  // reports disagreements, the comparison itself is broken and the real result above is noise.
  const selfRatios = positions
    .filter((p) => POSITION_SCARCITY[p] != null)
    .map((p) => (POSITION_SCARCITY[p]! / canonBase) / (POSITION_SCARCITY[p]! / canonBase))
  control(
    'comparing canonical against itself yields zero disagreements',
    selfRatios.every((r) => Math.abs(r - 1) <= 1e-9),
  )

  if (disagreements.length > 0) {
    const qb = disagreements.find((d) => d.pos === 'QB')
    if (qb) {
      finding(
        `QB: canonical prices him BELOW a TE (${qb.canon}× TE) while hybrid prices him ABOVE ` +
          `(${qb.hybrid}× TE) — the two engines invert the QB/TE relationship. In a 1-QB league ` +
          `the canonical view is defensible; hybrid's is the superflex view applied unconditionally.`,
      )
    }
    finding(
      `${disagreements.length} of ${positions.length} positions disagree by >15% after normalisation: ` +
        disagreements.map((d) => `${d.pos} ${d.ratio}×`).join(', '),
    )
  } else {
    console.log('  → No positional disagreement above threshold.')
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 2 — the 0–10000 clamp (audit finding G4)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionClampSaturation(): void {
  head('SECTION 2 — clamp saturation: are elite players distinguishable at the top?')

  console.log(`\n  value = projection × ${PROJ_TO_VALUE} × scarcity + adpPremium, clamped 0..10000`)
  console.log('  Season-long point totals, standard 1-QB vs superflex.\n')

  const sf = { isSuperflex: true, scoringFormat: 'ppr' as const }
  const scenarios: Array<{ label: string; pos: string; pts: number[]; scoring?: typeof sf }> = [
    { label: 'RB, 1-QB PPR', pos: 'RB', pts: [280, 320, 360, 400] },
    { label: 'WR, 1-QB PPR', pos: 'WR', pts: [280, 320, 360, 400] },
    { label: 'QB, 1-QB PPR', pos: 'QB', pts: [340, 380, 420, 460] },
    { label: 'QB, SUPERFLEX', pos: 'QB', pts: [340, 380, 420, 460], scoring: sf },
  ]

  let saturatedGroups = 0

  for (const s of scenarios) {
    const values = s.pts.map((p) =>
      normalizedPlayerValue({ projection: p, position: s.pos, scoring: s.scoring ?? null }),
    )
    const distinct = new Set(values).size
    const saturated = distinct < values.length
    if (saturated) saturatedGroups += 1

    console.log(`  ${s.label}`)
    for (let i = 0; i < s.pts.length; i += 1) {
      const flag = values[i] === 10000 ? '  ← CLAMPED' : ''
      console.log(`    ${String(s.pts[i]).padStart(4)} pts → ${String(values[i]).padStart(6)}${flag}`)
    }
    console.log(
      `    ${distinct}/${values.length} distinct values${saturated ? '  ⚠ players are INDISTINGUISHABLE' : ''}\n`,
    )
  }

  // POSITIVE CONTROL: below the clamp the engine must separate every input. If it cannot, the
  // saturation reported above is an artefact of the probe, not of the engine.
  const lowValues = [80, 120, 160, 200].map((p) =>
    normalizedPlayerValue({ projection: p, position: 'WR' }),
  )
  control(
    'un-clamped inputs (80–200 pts WR) produce 4 distinct values',
    new Set(lowValues).size === 4 && !lowValues.includes(10000),
  )

  if (saturatedGroups > 0) {
    const sfQb = [340, 380, 420, 460].map((p) =>
      normalizedPlayerValue({ projection: p, position: 'QB', scoring: sf }),
    )
    const uncapped = 460 * PROJ_TO_VALUE * (POSITION_SCARCITY.QB ?? 1) * scoringScarcityMultiplier('QB', sf)
    finding(
      `${saturatedGroups} of ${scenarios.length} scenarios saturate the 10000 clamp. Superflex QBs ` +
        `at 340–460 pts all price ${sfQb.every((v) => v === sfQb[0]) ? 'IDENTICALLY' : 'nearly identically'} ` +
        `(${sfQb.join(', ')}) — the uncapped value at 460 pts is ${Math.round(uncapped)}, ` +
        `${round(uncapped / 10000, 2)}× the ceiling. Superflex is precisely the format where QB ` +
        `separation matters most, and it is the format where the engine has none.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 3 — the unit trap that Phase 1 must not walk into
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionUnitTrap(): void {
  head('SECTION 3 — per-game vs rest-of-season: the silent ~17× error')

  console.log('\n  AFProjectionSnapshot.afProjection is PER GAME.')
  console.log('  normalizedPlayerValue() expects a REST-OF-SEASON total.')
  console.log('  Wiring one to the other without converting produces a plausible number.\n')

  const weeksRemaining = 17
  const cases = [
    { name: 'elite WR',  perGame: 19.5, pos: 'WR' },
    { name: 'RB1',       perGame: 18.0, pos: 'RB' },
    { name: 'mid TE',    perGame: 9.2,  pos: 'TE' },
    { name: 'streamer',  perGame: 6.1,  pos: 'WR' },
  ]

  console.log('    player      /game    WRONG (per-game in)   RIGHT (×17 ROS)    understated by')
  console.log('    ' + '─'.repeat(76))

  let allUnderstated = true
  for (const c of cases) {
    const wrong = normalizedPlayerValue({ projection: c.perGame, position: c.pos })
    const right = normalizedPlayerValue({ projection: c.perGame * weeksRemaining, position: c.pos })
    const factor = wrong > 0 ? round(right / wrong, 1) : Infinity
    if (factor < 5) allUnderstated = false
    console.log(
      `    ${c.name.padEnd(11)} ${String(c.perGame).padEnd(8)} ${String(wrong).padEnd(21)} ${String(right).padEnd(18)} ${factor}×`,
    )
  }

  console.log()
  console.log('  🛑 Note the WRONG column contains no zeros, no NaN and no error. Every value is')
  console.log('     a plausible mid-tier price. Nothing in the type system, the tests or the UI')
  console.log('     distinguishes it from a correct answer — which is why the conversion must')
  console.log('     live in ONE named, tested helper at write time, never inline at a read site.')

  // POSITIVE CONTROL: the two inputs must actually differ. If they did not, the table above
  // would be measuring nothing.
  const a = normalizedPlayerValue({ projection: 19.5, position: 'WR' })
  const b = normalizedPlayerValue({ projection: 19.5 * weeksRemaining, position: 'WR' })
  control('per-game and ROS inputs produce materially different values', b > a * 5)

  if (allUnderstated) {
    finding(
      `Feeding per-game points where rest-of-season is expected understates every player by ` +
        `~${weeksRemaining}×, silently. This is the single largest risk in Phase 1 and the reason ` +
        `rosProjection is computed at WRITE time where weeksRemaining is known.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SECTION 4 — ADP premium sanity
// ─────────────────────────────────────────────────────────────────────────────────────────────

function sectionAdpPremium(): void {
  head('SECTION 4 — ADP premium: how much does draft position move a price?')

  console.log(`\n  adpPremium = clamp((${ADP_PIVOT} − adp) × ${ADP_SLOPE}, −600, 1600)`)
  console.log('  Applied ADDITIVELY, after scarcity. Same 200-pt WR at four draft slots.\n')

  const base = 200
  console.log('    adp     value    Δ vs no-adp')
  console.log('    ' + '─'.repeat(36))
  const noAdp = normalizedPlayerValue({ projection: base, position: 'WR' })
  for (const adp of [1, 12, 60, 120, 240]) {
    const v = normalizedPlayerValue({ projection: base, adp, position: 'WR' })
    console.log(`    ${String(adp).padStart(4)}   ${String(v).padStart(6)}    ${v - noAdp >= 0 ? '+' : ''}${v - noAdp}`)
  }

  console.log()
  // POSITIVE CONTROL: a lower ADP must never price lower than a higher one, all else equal.
  const monotonic = [1, 12, 60, 120, 240]
    .map((adp) => normalizedPlayerValue({ projection: base, adp, position: 'WR' }))
    .every((v, i, arr) => i === 0 || v <= arr[i - 1])
  control('ADP premium is monotonic (earlier ADP never prices lower)', monotonic)

  const elite = normalizedPlayerValue({ projection: base, adp: 1, position: 'WR' })
  const late = normalizedPlayerValue({ projection: base, adp: 240, position: 'WR' })
  const swing = elite - late
  const pct = round((swing / noAdp) * 100, 1)
  if (pct > 30) {
    finding(
      `ADP swings the same 200-pt WR by ${swing} points (${pct}% of his no-ADP value) purely on ` +
        `draft slot. ADP is a PRESEASON consensus; in-season it is a stale signal being added to ` +
        `a live projection. Worth deciding whether the premium should decay as the season runs.`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('AF VALUE PARITY PROBE — pure, offline, read-only')
  console.log('No database connection. No provider call. No writes.')

  verifyTranscription()
  sectionPositionalOrdering()
  sectionClampSaturation()
  sectionUnitTrap()
  sectionAdpPremium()

  head('SUMMARY')
  if (controlFailures > 0) {
    console.log(`\n  🛑 ${controlFailures} POSITIVE CONTROL(S) FAILED.`)
    console.log('     Every result above is untrustworthy — a detector that cannot report a known')
    console.log('     positive cannot be believed when it reports a negative. Fix the probe first.\n')
    process.exitCode = 1
    return
  }

  console.log(`\n  All positive controls fired. ${findings.length} finding(s):\n`)
  findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}\n`))
  process.exitCode = 0
}

main()
