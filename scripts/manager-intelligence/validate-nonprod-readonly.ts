/**
 * Decision OS Manager Intelligence Platform — Phase 6.
 *
 * Safe, READ-ONLY non-prod validation helper for the Manager Intelligence Hub.
 *
 *   npx tsx scripts/manager-intelligence/validate-nonprod-readonly.ts
 *
 * Behaviour (safe by default):
 *   1. Always PRINTS the plan (what it would validate) + the required-flag
 *      checklist + a transparent safety assessment BEFORE any query.
 *   2. REFUSES to query unless the safety gate passes: NONPROD_VALIDATION_ACK=true,
 *      a non-production runtime, and a DATABASE_URL confirmed non-prod.
 *   3. Even when safe, it only runs read-only COUNT/findFirst reads to report
 *      per-module readiness for MANAGER_VALIDATION_LEAGUE_ID. It never writes and
 *      never calls a recommendation endpoint. Without a league id it stays a
 *      plan-only dry run.
 *
 * This script PREPARES the proof pass. It does not, by itself, constitute
 * "validated live Sleeper data" — that requires actually running it in an
 * approved non-prod environment and recording the results in the runbook.
 */
/* eslint-disable no-console */

import {
  assessNonprodSafety,
  checkRequiredFlags,
  probeModuleReadiness,
  VALIDATION_TARGETS,
  type ReadinessReader,
} from './nonprodValidationGuard'

async function main(): Promise<void> {
  const env = process.env

  console.log('Manager Intelligence — non-prod READ-ONLY validation (safe by default)\n')

  console.log('PLAN — would validate (read-only; no writes; no recommendation calls):')
  for (const t of VALIDATION_TARGETS) {
    console.log(`  • ${t.module.padEnd(22)} ${t.route}  (${t.contract})`)
  }

  console.log('\nRequired non-prod feature flags:')
  for (const { flag, enabled } of checkRequiredFlags(env)) {
    console.log(`  [${enabled ? 'x' : ' '}] ${flag}`)
  }

  const safety = assessNonprodSafety(env)
  console.log('\nSafety assessment:')
  for (const ack of safety.acknowledgements) console.log(`  ok   ${ack}`)
  for (const blocker of safety.blockers) console.log(`  STOP ${blocker}`)

  if (!safety.ok) {
    console.log('\nRefusing to query: this environment is not a confirmed, acknowledged non-prod target.')
    console.log('See docs/MANAGER_INTELLIGENCE_NONPROD_VALIDATION_RUNBOOK.md for how to run this safely.')
    process.exitCode = 2
    return
  }

  const leagueId = (env.MANAGER_VALIDATION_LEAGUE_ID ?? '').trim()
  if (!leagueId) {
    console.log('\nSafe to proceed. Set MANAGER_VALIDATION_LEAGUE_ID=<imported non-prod league> to probe readiness.')
    console.log('(Plan-only dry run — no queries were made.)')
    return
  }

  // Only NOW pull in prisma — keeps the guard + its tests database-free.
  const { createPrismaReadinessReader } = await import('./prismaReadinessReader')
  const reader: ReadinessReader = createPrismaReadinessReader()

  console.log(`\nProbing read-only readiness for league ${leagueId} ...`)
  const readiness = await probeModuleReadiness(reader, leagueId)
  for (const r of readiness) {
    console.log(`  [${r.ready ? 'READY' : ' --- '}] ${r.module.padEnd(22)} ${r.note}`)
  }
  const readyCount = readiness.filter((r) => r.ready).length
  console.log(`\n${readyCount}/${readiness.length} modules have data present. Record results in the runbook to complete the proof pass.`)
}

main().catch((err) => {
  console.error('Validation helper failed:', err)
  process.exitCode = 1
})
