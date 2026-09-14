/**
 * A vitest reporter used only by scripts/vitest-ratchet.mjs.
 *
 * It writes the facts vitest's JSON reporter drops — every file the run scheduled, each module's
 * final state, and every unhandled error — to the path in VITEST_RATCHET_RUN_RECORD. Why the JSON
 * report alone is blind to a crashed worker is measured and written down in
 * vitest-ratchet-judge.mjs.
 */
import { writeFileSync } from 'node:fs'
import { toRunRecord } from './vitest-ratchet-judge.mjs'

export default class VitestRatchetReporter {
  vitest = null
  specifications = []

  onInit(vitest) {
    this.vitest = vitest
  }

  /**
   * 🛑 onTestRunStart RECEIVES THE WHOLE FILTERED SUITE, NOT THIS SHARD. vitest 4.1.5 shards inside
   * the pool's executeTests, after reporting the run start. Used as-is, every file in the OTHER
   * shards read as "scheduled but reported no result" — measured, both shards red, on a 2-file run.
   *
   * So apply the same sharding the pool does, with vitest's own sequencer (the pool builds it as
   * `new config.sequence.sequencer(ctx)`), rather than reimplementing its hash-and-slice.
   */
  async onTestRunStart(specifications) {
    let scheduled = [...specifications]
    const config = this.vitest?.config
    if (config?.shard) {
      const Sequencer = config.sequence.sequencer
      scheduled = await new Sequencer(this.vitest).shard(scheduled)
    }
    this.specifications = scheduled
  }

  onTestRunEnd(testModules, unhandledErrors, reason) {
    const out = process.env.VITEST_RATCHET_RUN_RECORD
    if (!out) return
    const record = toRunRecord(this.specifications, testModules, unhandledErrors, reason)
    writeFileSync(out, JSON.stringify(record, null, 2) + '\n', 'utf8')
  }
}
