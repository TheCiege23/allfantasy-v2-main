import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * The Decision OS lineup engine is RETIRED. This file pins that.
 *
 * Owner decision 2026-09-29: /core My Team is the ONE start/sit answer. Its optimizer,
 * `lib/decision-os/lineup/bestLineup.ts` (`optimizeLineup`), is what My Team renders and what
 * Chimmy reads through `lib/chimmy/myTeamLineupGrounding.ts`.
 *
 * The second engine (world → DCO → rules → decision) went in two steps:
 *   - 2026-09-29: its shadow runner, ten-minute sweep, parity gate and the two routes that
 *     surfaced it.
 *   - 2026-11-17: the rest of it, with the grounding packet's `lineupDecision` slice. No intent had
 *     requested that slice since 2026-09-07 (37s against a 3s ceiling), so the engine ran only
 *     when an admin forced it on the proof surface.
 *
 * A revert or a copy-paste cannot quietly bring a second start/sit engine back past this file.
 */
const exists = (rel: string) => existsSync(resolve(process.cwd(), rel))
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const RETIRED = [
  // 2026-09-29
  'app/api/today/lineup-actions/route.ts',
  'app/api/dashboard/today-actions/route.ts',
  'lib/today-actions-engine/runTodayActions.ts',
  'lib/decision-os/lineup/shadow.ts',
  'lib/decision-os/lineup/shadowSweep.ts',
  'lib/decision-os/lineup/canonicalPersist.ts',
  'lib/decision-os/lineup/todayCardAdapter.ts',
  'lib/decision-os/lineup-os/index.ts',
  // 2026-11-17
  'lib/decision-os/lineup/index.ts',
  'lib/decision-os/lineup/loader.ts',
  'lib/decision-os/lineup/deps.ts',
  'lib/decision-os/lineup/world.ts',
  'lib/decision-os/lineup/dco.ts',
  'lib/decision-os/lineup/decision.ts',
  'lib/decision-os/lineup/rules.ts',
  'lib/decision-os/lineup/outcome.ts',
  'lib/decision-os/lineup/signalFacts.ts',
  'lib/decision-os/lineup/warehouseFacts.ts',
  'lib/decision-os/world/matchupEnrichedWorld.ts',
  'lib/decision-os/world/performanceEnrichedWorld.ts',
]

describe('retired: the duplicate lineup engine stays retired', () => {
  it('none of its files exist', () => {
    expect(RETIRED.filter(exists)).toEqual([])
  })

  it('the one start/sit optimizer is still here', () => {
    expect(exists('lib/decision-os/lineup/bestLineup.ts')).toBe(true)
    expect(read('lib/decision-os/lineup/bestLineup.ts')).toMatch(/export function optimizeLineup\(/)
    expect(read('lib/core-app/myTeam.ts')).toContain("from '@/lib/decision-os/lineup/bestLineup'")
  })

  /*
   * The slice, not just the engine. Each of these is a wiring point the slice had: the packet
   * type + producer, the "WHAT IS AVAILABLE" list, the intent router, the kill-switch list, and
   * the bridge. Anchored to code shapes, not the bare word, because these files legitimately keep
   * the name in prose and `lineupDecision` is still a freshness PROFILE name in `conclusive.ts`.
   */
  it('no grounding module wires a lineupDecision slice', () => {
    const packet = read('lib/decision-os/grounding/packet.ts')
    expect(packet).not.toMatch(/^\s*lineupDecision\??:/m)
    expect(packet).not.toMatch(/killed\('lineupDecision'\)/)
    expect(packet).not.toContain('loadLineupDecisionSlice')
    expect(read('lib/decision-os/grounding/serialize.ts')).not.toMatch(/packet\.lineupDecision/)
    expect(read('lib/decision-os/grounding/intentToWant.ts')).not.toMatch(/^\s*lineupDecision:/m)
    expect(read('lib/decision-os/flags.ts')).not.toMatch(/^\s*'lineupDecision',?$/m)
    expect(read('lib/decision-os/grounding/decisionBridge.ts')).not.toMatch(/from ['"]\.\.\/lineup/)
  })

  it('the maintenance cron runs no lineup work', () => {
    const cron = read('app/api/cron/decision-os-intelligence-maintenance/route.ts')
    expect(cron).not.toMatch(/from ['"][^'"]*decision-os\/lineup/)
    expect(cron).not.toMatch(/runLineupShadow/)
  })
})

/*
 * Kept from the engine's architecture suite (Ticket #10): the shared parity/shadow core must stay
 * domain-blind. It never depended on the engine's files, so it outlives them.
 */
describe('architecture: core parity/shadow infrastructure is DOMAIN-BLIND (Ticket #10)', () => {
  const CORE_PARITY = [
    'lib/decision-os/core/parity/validatorParity.ts',
    'lib/decision-os/core/parity/shadowParity.ts',
    'lib/decision-os/core/parity/telemetry.ts',
    'lib/decision-os/core/shadow/flag.ts',
  ].map((p) => [p, read(p)] as const)

  it('core/parity + core/shadow import no lineup/domain modules and no prisma', () => {
    for (const [path, src] of CORE_PARITY) {
      expect(`${path}: ${src.includes('@/lib/lineup-actions')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('decision-os/lineup')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('@/lib/roster-lineup-engine')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('@/lib/prisma')}`).toBe(`${path}: false`)
    }
  })
})
