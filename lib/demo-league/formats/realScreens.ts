/**
 * Data for the REAL format screens a league-type example renders (stage 3 of the demo redesign):
 * the props each app component takes, built from the example's generated sample.
 *
 * Only components that are pure — no fetch, no session, no link into a signed-in page — are used:
 * the Devy hero, the Zombie command hero, the Salary Cap dashboard and contracts table, the Survivor
 * Guilly boards and the Big Brother ceremony center (surveyed 2026-11-15). Survivor's challenge center
 * reads the signed-in profile and Guilly's home fetches scenarios, so those types keep their panels.
 *
 * Every team name is the example's alias (`teamNameOf`), every roster id `demo-<seat>`; player names
 * are real NFL players, which the demo keeps on purpose. Types only from the components, so this file
 * stays pure and serializable for the server page to hand to the client renderer.
 */
import type { SalaryCapSummary } from '@/components/salary-cap/types'
import type { BigBrotherSummary } from '@/components/big-brother/types'
import type { SGVisualInput } from '@/lib/survivor-guillotine/visual-model'

export type FormatRealScreen =
  | { kind: 'devy'; leagueName: string; season: number; dynastyYear: number }
  | {
      kind: 'zombie'
      leagueName: string
      week: number
      survivorCount: number
      hordeCount: number
      whispererCount: number
      chompinNames: string[]
    }
  | { kind: 'salary-cap'; summary: SalaryCapSummary }
  | { kind: 'big-brother'; summary: BigBrotherSummary }
  | { kind: 'survivor-guilly'; input: SGVisualInput }

export const demoRosterId = (slot: number) => `demo-${slot}`
