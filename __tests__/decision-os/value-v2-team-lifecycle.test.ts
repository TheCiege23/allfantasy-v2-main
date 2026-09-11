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
 * 🛑 THE MIRROR-DRIFT GUARD. IT WAS WRITTEN TO GO RED WHEN THE ENUMS LANDED, AND IT DID.
 *
 * `teamLifecycle.ts` mirrors two Prisma enums rather than importing them, because when this file
 * was written the enums were not on `origin/main` and importing one would have made the module
 * uncompilable there. A mirror nobody checks is a copy that drifts, so this asserts the state of
 * the schema explicitly rather than skipping until the enums appear.
 *
 * ⚠ THE TRIPWIRE FIRED ON RECONCILIATION, EXACTLY AS DESIGNED. `LeagueTeamLifecycleState` and
 * `LeagueTeamManagerKind` are absent at this branch's original base (`1a43ebbd8`) and present on
 * `origin/main` at `72796c248`, so rebasing turned this red with the test file byte-identical —
 * an environmental signal, not a regression and not an edit. Per its own instruction the two
 * expectations are now `true`, which is what ARMS the two comparisons below: they were `runIf`
 * no-ops for as long as the enums were missing, and from here they guard the mirror for real.
 * Both were confirmed green against the schema rather than assumed — members match exactly
 * (UNKNOWN/CURRENT/ARCHIVED and UNKNOWN/HUMAN/VACANT/AI).
 *
 * Flipping these back to `false` would silently disarm both guards, so treat a failure here as
 * "the schema moved", never as "relax the expectation".
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

  it('records that BOTH enums are now in this checkout — the two guards below are armed', () => {
    /*
     * If this line fails, the schema moved: an enum was renamed or removed. Find out which before
     * touching this expectation — setting it back to `false` disarms the two comparisons below
     * (they are `runIf`-gated on exactly these booleans) and lets the mirror drift unwatched.
     */
    expect({ hasLifecycle, hasManagerKind }).toEqual({ hasLifecycle: true, hasManagerKind: true })
  })

  it.runIf(hasLifecycle)('lifecycle mirror matches the schema exactly', () => {
    expect(membersOf('LeagueTeamLifecycleState').sort()).toEqual([...KNOWN_LIFECYCLE_STATES].sort())
  })

  it.runIf(hasManagerKind)('manager-kind mirror matches the schema exactly', () => {
    expect(membersOf('LeagueTeamManagerKind').sort()).toEqual([...KNOWN_MANAGER_KINDS].sort())
  })
})

/**
 * The eliminated-team shape AS THE GUILLOTINE ACTUALLY WRITES IT, confirmed against the committed
 * Batch A tree by the session that owns that writer.
 *
 * 🛑 THE FIRST VERSION OF THIS FILE COULD NOT HAVE CAUGHT THIS. Every elimination case it tested
 * used `managerKind: 'HUMAN'`, so the VACANT rule never met an eliminated team and the rule-order
 * bug was invisible. The writer sets THREE fields together — `lifecycleState: 'CURRENT'`,
 * `eliminatedAt: <now>`, `managerKind: 'VACANT'` — because elimination legitimately vacates the
 * seat. Testing a state one field at a time cannot see a defect that needs two of them.
 */
describe('an eliminated team, in the exact shape the guillotine writes', () => {
  const guillotined = {
    lifecycleState: 'CURRENT' as const,
    managerKind: 'VACANT' as const,
    eliminatedAt: new Date('2026-11-15T00:00:00Z'),
  }

  /*
   * ⚠ ELIMINATION IS CHECKED BEFORE THE MANAGER AXIS, AND THE ORDER IS THE WHOLE FIX. A vacant
   * seat is normally a contradiction against a claim — but for an eliminated team it is the
   * EXPECTED consequence, written by the same statement that set `eliminatedAt`. Judging the
   * manager axis first turned a coherent state into a refusal.
   */
  it('resolves, rather than refusing on the vacated seat', () => {
    expect(resolveTeamState(guillotined)).toEqual({ resolvable: true, eliminated: true })
  })

  it('a vacant seat WITHOUT elimination still refuses — the contradiction rule is intact', () => {
    expect(resolveTeamState({ ...guillotined, eliminatedAt: null }))
      .toEqual({ resolvable: false, gap: TEAM_GAP_SEAT_VACANT })
  })

  it('an UNKNOWN manager on an eliminated team also resolves', () => {
    expect(resolveTeamState({ ...guillotined, managerKind: 'UNKNOWN' }))
      .toEqual({ resolvable: true, eliminated: true })
  })

  it('but an ARCHIVED eliminated team still refuses — lifecycle outranks elimination', () => {
    expect(resolveTeamState({ ...guillotined, lifecycleState: 'ARCHIVED' }))
      .toEqual({ resolvable: false, gap: TEAM_GAP_ARCHIVED })
  })

  it('and an unrecognised lifecycle still fails closed, elimination notwithstanding', () => {
    expect(resolveTeamState({ ...guillotined, lifecycleState: 'SUSPENDED' }))
      .toEqual({ resolvable: false, gap: TEAM_GAP_STATE_UNRECOGNISED })
  })
})

/**
 * 🛑 A LIMITATION THIS RESOLVER CANNOT FIX, PINNED SO IT IS NOT MISTAKEN FOR WORKING.
 *
 * The adapter reaches a team by `claimedByUserId = <caller>`. The guillotine writer sets
 * `claimedByUserId: null` and `platformUserId: null` when it eliminates. So once elimination
 * actually fires, THERE IS NO CLAIM LEFT and the adapter can never reach that row — the
 * "eliminated resolves" path above is correct and, through the current lookup, unreachable.
 *
 * ⚠ IT IS MASKED TODAY, WHICH IS WHY IT NEEDS PINNING RATHER THAN FIXING BY GUESS. That writer's
 * `where` keys on `externalId`, which matches ZERO rows in production — measured across 3,419
 * `league_teams` rows by the session that owns it, and reported as a separate id-space blocker
 * (`externalId` holds a `Roster.id` uuid for canonically-created leagues and a slot number for
 * provider-imported ones). When that key is fixed, elimination begins firing and this seam loses
 * those users SILENTLY: no error, no gap, just a team the adapter stops finding.
 *
 * Two ways out, and the choice is not this module's to make: give the adapter a fallback identity
 * path that does not depend on a live claim, or have the elimination writer stop nulling it.
 * Recorded here so whoever wires the seam meets the decision rather than the symptom.
 */
describe('what the resolver decides is not the same as what the adapter can reach', () => {
  it('resolves an eliminated team that the current lookup could never hand it', () => {
    // The resolver is correct in isolation...
    expect(resolveTeamState({
      lifecycleState: 'CURRENT', managerKind: 'VACANT', eliminatedAt: new Date(),
    })).toEqual({ resolvable: true, eliminated: true })

    // ...and the row it describes has no claim, which is the only key the adapter looks up by.
    // Pinned as a documented gap, not asserted as working behaviour.
    const rowAsWritten = { claimedByUserId: null, platformUserId: null }
    expect(rowAsWritten.claimedByUserId).toBeNull()
  })
})
