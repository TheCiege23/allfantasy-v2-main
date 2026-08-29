/**
 * Global setup for the agent tester.
 *
 * Runs the safety preflight ONCE, before any archetype starts. This ordering is
 * the whole point: a misconfigured target fails here, having created at most the
 * single reserved-domain probe account, rather than failing on step 40 of run 3
 * with dozens of rows already written.
 */

import { preflight, PreflightError } from "./preflight"

export default async function globalSetup(): Promise<void> {
  try {
    const result = await preflight()

    // eslint-disable-next-line no-console
    console.log("\n──── AGENT TESTER PREFLIGHT ────")
    for (const note of result.notes) {
      // eslint-disable-next-line no-console
      console.log(`  · ${note}`)
    }
    // eslint-disable-next-line no-console
    console.log(
      `  · writes: ${result.writesAllowed ? "ALLOWED (e2e bypass live)" : "DISABLED (read-only)"}`
    )
    // eslint-disable-next-line no-console
    console.log("────────────────────────────────\n")

    // Hand the resolved values to the specs.
    process.env.AGENT_TESTER_RESOLVED_BASE_URL = result.baseURL
    process.env.AGENT_TESTER_WRITES_ALLOWED = result.writesAllowed ? "1" : "0"
  } catch (error) {
    if (error instanceof PreflightError) {
      // eslint-disable-next-line no-console
      console.error(`\n${error.message}\n`)
      // Exit rather than throw: a stack trace here buries the safety message
      // that the operator actually needs to read.
      process.exit(1)
    }
    throw error
  }
}
