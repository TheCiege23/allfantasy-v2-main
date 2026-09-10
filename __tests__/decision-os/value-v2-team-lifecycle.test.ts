import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KNOWN_LIFECYCLE_STATES, KNOWN_MANAGER_KINDS, resolveTeamState,
  TEAM_GAP_ARCHIVED, TEAM_GAP_LIFECYCLE_UNKNOWN, TEAM_GAP_MANAGER_UNKNOWN,
  TEAM_GAP_SEAT_VACANT, TEAM_GAP_STATE_UNRECOGNISED,
  type TeamLifecycleState, type TeamManagerKind,
} from '@/lib/decision-os/value-v2/teamLifecycle'

/**
 * The four team states the redraft window seam has to tell apart, resolved from the axes Platform
 * Import Batch A introduces. Pure: no database, no Prisma, no import of an enum that is not on
 * `origin/main` yet.
 */

const facts = (
  lifecycleState: TeamLifecycleState | string,
  managerKind: TeamManagerKind | string,
  over: { eliminatedAt?: Date | null; archivedAt?: Date | null } = {},
) => ({ lifecycleState, managerKind, ...over })

describe('the four states, told apart at last', () => {
  it('ACTIVE, HUMAN-MANAGED resolves', () => {
    expect(resolveTeamState(facts('CURRENT', 'HUMAN'))).toEqual({ resolvable: true, eliminated: false })
  })

  /*
   * The seat is claimed by this caller and simultaneously recorded as having nobody in it. That is
   * data disagreeing with itself, and picking a reading is how a window gets attributed wrongly.
   */
  it('ACTIVE but VACANT refuses, because a claimed empty seat is a contradiction', () => {
    expect(resolveTeamState(facts('CURRENT', 'VACANT')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_SEAT_VACANT })
  })

  /*
   * 🛑 THE ONE THE WHOLE CORRECTION EXISTS FOR. Before Batch A this was INDISTINGUISHABLE from an
   * active team — `LeagueTeam` had no archival column at all, so "this team is archived" was not a
   * fact the schema could express and the shadow flag stayed off because of it.
   */
  it('TRULY ARCHIVED refuses, by name', () => {
    expect(resolveTeamState(facts('ARCHIVED', 'HUMAN')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_ARCHIVED })
  })

  /*
   * ⚠ ELIMINATION IS A STANDING, NOT A DEPARTURE. A knocked-out guillotine or survivor team is
   * still a current franchise with a real record and roster — which is the evidence a 'rebuilding'
   * verdict is made of. If this ever starts refusing, the seam silently stops answering for real
   * teams in exactly the leagues where the window matters most.
   */
  it('ELIMINATED still resolves, and is reported rather than refused', () => {
    expect(resolveTeamState(facts('CURRENT', 'HUMAN', { eliminatedAt: new Date('2026-12-01T00:00:00Z') })))
      .toEqual({ resolvable: true, eliminated: true })
  })

  it('an archived team that is ALSO eliminated is still refused on the archival axis', () => {
    expect(resolveTeamState(facts('ARCHIVED', 'HUMAN', { eliminatedAt: new Date() })))
      .toEqual({ resolvable: false, gap: TEAM_GAP_ARCHIVED })
  })
})

describe('UNKNOWN never reads as fine', () => {
  /*
   * 🛑 THIS IS THE LINE THAT PROTECTS THE MIGRATION DAY. Both columns default to UNKNOWN, so on the
   * day the migration runs EVERY pre-existing row is UNKNOWN until a backfill classifies it. If
   * UNKNOWN read as current, the seam would start computing windows for every team in the database
   * — including departed ones — and it would look like the feature simply started working.
   */
  it('an unclassified lifecycle refuses rather than assuming the team is live', () => {
    expect(resolveTeamState(facts('UNKNOWN', 'HUMAN')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_LIFECYCLE_UNKNOWN })
  })

  it('an unclassified manager refuses rather than assuming a human', () => {
    expect(resolveTeamState(facts('CURRENT', 'UNKNOWN')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_MANAGER_UNKNOWN })
  })

  it('lifecycle is judged BEFORE manager, so an archived row does not report a manager gap', () => {
    expect(resolveTeamState(facts('ARCHIVED', 'UNKNOWN')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_ARCHIVED })
  })
})

describe('AI is a stated assumption, pinned so it cannot change by accident', () => {
  /*
   * The window describes a roster and a record, not an operator, and ownership is already settled
   * by `claimedByUserId` before this runs — so an owner on autopilot keeps their window.
   *
   * ⚠ IF `AI` TURNS OUT TO MEAN "ABANDONED SEAT THE PLATFORM IS AUTO-PILOTING", this must flip to
   * a refusal: that is a departed manager wearing a claim. The question is with the import session.
   * This test exists so that flip is deliberate and one line, rather than a silent reinterpretation.
   */
  it('an AI-managed team that a user has claimed still resolves', () => {
    expect(resolveTeamState(facts('CURRENT', 'AI'))).toEqual({ resolvable: true, eliminated: false })
  })
})

describe('unrecognised input fails closed', () => {
  /*
   * ⚠ A NEW ENUM MEMBER MUST NOT READ AS RESOLVABLE. No existing test can name a value that does
   * not exist yet, so an enum that grows would otherwise ship green with the new state silently
   * treated as fine — the failure being that nothing fails.
   */
  it.each([
    ['SUSPENDED', 'HUMAN'],
    ['CURRENT', 'CO_OWNED'],
    ['', 'HUMAN'],
    ['CURRENT', ''],
  ])('lifecycle=%j manager=%j refuses', (lifecycle, manager) => {
    expect(resolveTeamState(facts(lifecycle, manager)))
      .toEqual({ resolvable: false, gap: TEAM_GAP_STATE_UNRECOGNISED })
  })

  it.each([[null], [undefined], [42], [{}]])('a non-string lifecycle (%j) refuses', (bad) => {
    expect(resolveTeamState({ lifecycleState: bad as never, managerKind: 'HUMAN' }))
      .toEqual({ resolvable: false, gap: TEAM_GAP_STATE_UNRECOGNISED })
  })

  it('lower-case does not pass — the enum is upper-case and a near-miss is still a miss', () => {
    expect(resolveTeamState(facts('current', 'human')))
      .toEqual({ resolvable: false, gap: TEAM_GAP_STATE_UNRECOGNISED })
  })
})

/**
 * 🛑 THE MIRROR-DRIFT GUARD, AND IT IS WRITTEN TO GO RED WHEN #697 LANDS.
 *
 * `teamLifecycle.ts` mirrors two Prisma enums rather than importing them, because the enum is not
 * on `origin/main` yet and importing it would make the module uncompilable there. A mirror nobody
 * checks is a copy that drifts, so this asserts the CURRENT state of the schema explicitly: the
 * enums are absent.
 *
 * When Platform Import Batch A lands, this test FAILS. That is the design. Its failure is the
 * signal to (a) enable the real comparison below and (b) wire the seam — not a regression. The
 * alternative, a test that quietly skips until the enum appears, is a check that cannot fail, and
 * it would let the mirror drift for exactly as long as nobody thought to look.
 */
describe('the enum mirror, and the signal that it is time to wire the seam', () => {
  const schema = readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  const hasLifecycle = /enum\s+LeagueTeamLifecycleState\s*\{/.test(schema)
  const hasManagerKind = /enum\s+LeagueTeamManagerKind\s*\{/.test(schema)

  const membersOf = (name: string): string[] => {
    const m = schema.match(new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`))
    if (!m) return []
    return m[1].split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(l => /^[A-Z_]+$/.test(l))
  }

  it('records that the enums are NOT in this checkout yet — flip this when #697 lands', () => {
    /*
     * If this line fails, Batch A has landed. Change the two expectations to `true`, and the two
     * tests below stop being no-ops and start guarding the mirror for real.
     */
    expect({ hasLifecycle, hasManagerKind }).toEqual({ hasLifecycle: false, hasManagerKind: false })
  })

  it.runIf(hasLifecycle)('lifecycle mirror matches the schema exactly', () => {
    expect(membersOf('LeagueTeamLifecycleState').sort()).toEqual([...KNOWN_LIFECYCLE_STATES].sort())
  })

  it.runIf(hasManagerKind)('manager-kind mirror matches the schema exactly', () => {
    expect(membersOf('LeagueTeamManagerKind').sort()).toEqual([...KNOWN_MANAGER_KINDS].sort())
  })
})
