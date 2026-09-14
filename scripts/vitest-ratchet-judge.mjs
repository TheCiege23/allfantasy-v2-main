/**
 * The judging half of scripts/vitest-ratchet.mjs, kept free of I/O so it can be unit-tested
 * without spawning vitest (__tests__/vitest-ratchet-judge.test.ts).
 *
 * 🛑 WHY IT EXISTS: VITEST'S JSON REPORT CANNOT SAY "THIS FILE NEVER FINISHED". Measured against
 * vitest 4.1.5 (JsonReporter in dist/chunks/index.*.js) and by running it:
 *
 *   - a file's `status` is "failed" only when a test in it recorded a failure. A worker killed
 *     mid-file is written as "passed", with every assertion "pending";
 *   - its onTestRunEnd(testModules) never reads the unhandledErrors argument, so an unhandled
 *     rejection, or "[vitest-pool]: Worker forks emitted error", is not in the file at all.
 *
 * CI run 34855366587 (main 6fe109d15) shard 2/4 printed "Test Files 628 passed (629)" and
 * "Errors 1 error" for a worker that died in core-rail-active-league.test.tsx, and the ratchet —
 * reading only that JSON — printed "ran 629 files, 0 failed … OK". Shard 3/4 did the same.
 *
 * So vitest-ratchet-reporter.mjs records what the JSON drops (every scheduled file, each module's
 * final state, every unhandled error) and this module judges both together.
 */

/**
 * Module states that mean the file ran to completion. vitest's TestModuleState is
 * "queued" | "pending" | "skipped" | "failed" | "passed"; a killed worker leaves "pending".
 */
export const FINISHED_STATES = new Set(['passed', 'failed', 'skipped'])

function oneLine(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function stateOf(testModule) {
  try {
    return testModule.state()
  } catch {
    return 'unknown'
  }
}

/**
 * The run record, built from the reporter hook arguments. Plain shapes on purpose, so a test can
 * pass fakes: specifications `[{ moduleId }]`, modules `[{ moduleId, state() }]`, and vitest's
 * SerializedError[] for unhandled errors.
 */
export function toRunRecord(specifications, testModules, unhandledErrors, reason) {
  return {
    reason: reason ?? null,
    scheduled: (specifications || []).map((s) => s.moduleId),
    modules: (testModules || []).map((m) => ({ moduleId: m.moduleId, state: stateOf(m) })),
    unhandled: (unhandledErrors || []).map((e) => ({
      type: oneLine(e?.type || e?.name || 'Error', 80),
      message: oneLine(e?.message ?? e),
      // vitest sets these when it can attribute the error to a file (an unhandled rejection does);
      // a pool-level error such as a worker dying carries neither.
      testPath: typeof e?.VITEST_TEST_PATH === 'string' ? e.VITEST_TEST_PATH : null,
      testName: typeof e?.VITEST_TEST_NAME === 'string' ? e.VITEST_TEST_NAME : null,
    })),
  }
}

/**
 * Per-file facts from the JSON report and the run record together.
 *
 * `ran` is files that FINISHED, not files that were started: a file that never finished must not
 * be reported as fixed, and must not count as run.
 */
export function summarizeRun({ jsonReport, runRecord, toRel, collectErrors }) {
  const failed = new Set()
  const errors = {}
  for (const r of jsonReport?.testResults || []) {
    if (!r?.name || r.status !== 'failed') continue
    const rel = toRel(r.name)
    failed.add(rel)
    errors[rel] = collectErrors(r)
  }

  const scheduled = new Set((runRecord?.scheduled || []).map(toRel))
  const states = new Map()
  for (const m of runRecord?.modules || []) {
    if (m?.moduleId) states.set(toRel(m.moduleId), m.state)
  }

  const ran = new Set()
  const incomplete = {}
  for (const file of new Set([...scheduled, ...states.keys()])) {
    const state = states.get(file)
    if (state === undefined) {
      incomplete[file] = 'scheduled but reported no result — its worker died or hung before the file was collected'
      continue
    }
    if (!FINISHED_STATES.has(state)) {
      incomplete[file] =
        `did not finish (state "${state}") — its worker crashed, hung or was killed mid-file; ` +
        `vitest's JSON report lists this file as "passed"`
      continue
    }
    ran.add(file)
    if (state === 'failed' && !failed.has(file)) {
      failed.add(file)
      errors[file] = ['file-level failure recorded by vitest with no failing assertion in the JSON report']
    }
  }

  const unhandled = (runRecord?.unhandled || []).map((u) => ({
    ...u,
    file: u.testPath ? toRel(u.testPath) : null,
  }))

  return { scheduled, ran, failed, errors, incomplete, unhandled }
}

/**
 * The verdict. A baseline entry excuses a file for FAILING. It does not excuse a file for never
 * finishing, or for leaking an unhandled error: both mean the file's tests may not have run at
 * all, which is precisely what a green ratchet must not hide.
 */
export function judge({ baseline, summary }) {
  const reasons = new Map()
  const add = (file, why) => {
    if (!reasons.has(file)) reasons.set(file, [])
    reasons.get(file).push(why)
  }

  for (const file of summary.failed) {
    if (baseline.has(file)) continue
    for (const why of summary.errors[file]?.length ? summary.errors[file] : ['failed']) add(file, why)
  }
  for (const [file, why] of Object.entries(summary.incomplete)) add(file, why)

  const runErrors = []
  for (const u of summary.unhandled) {
    const why = `unhandled ${u.type}: ${u.message}`
    if (u.file) add(u.file, why)
    else runErrors.push(why)
  }

  const fixed = [...baseline]
    .filter((f) => summary.ran.has(f) && !summary.failed.has(f) && !reasons.has(f))
    .sort()
  const regressions = [...reasons.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, why]) => ({ file, reasons: why }))

  return { regressions, runErrors, fixed, ok: regressions.length === 0 && runErrors.length === 0 }
}
