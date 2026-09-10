/**
 * Whether a canonical `LeagueTeam` is a franchise a competitive window may describe.
 *
 * ── WHY THIS IS PURE, AND WHY IT MIRRORS AN ENUM RATHER THAN IMPORTING ONE ────────────────────
 * The four state axes this reads land with Platform Import Batch A (`integration/import-batch-a`,
 * PR #697). At the time of writing that branch is NOT on `origin/main` —
 * `merge-base --is-ancestor d5bd1395d origin/main` returns rc=1, and
 * `LeagueTeamLifecycleState` has 0 occurrences in `origin/main`'s schema.
 *
 * 🛑 SO THIS FILE DELIBERATELY IMPORTS NOTHING. This repo has already paid for a module that
 * referenced symbols existing on no branch: the value-v2 foundation sat unpublished while code
 * referenced it, and `git rev-list --all` returned 0 commits for every one of its files. Importing
 * `@prisma/client`'s enum here would make this module uncompilable on `main` until #697 lands, and
 * would couple a pure decision to a schema that is still moving. The unions below MIRROR that
 * enum; the adapter maps Prisma's values onto them at the seam, in one place, after landing.
 *
 * ── THE AXES ARE ORTHOGONAL, WHICH IS THE WHOLE POINT ─────────────────────────────────────────
 * From the schema that defines them: *"Who runs the franchise. Orthogonal to lifecycle: a VACANT
 * seat is still CURRENT, and an ARCHIVED team can still record who used to run it."* Collapsing
 * them is what `isOrphan` did — thirteen write sites, seven meanings, and both Sleeper importers
 * setting `isOrphan = !ownerId` for a LIVE franchise the provider lists with no manager, which is
 * the opposite lifecycle from the one the name implies.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────────────────────────
 * One consumer: the redraft window seam, which has already established by `claimedByUserId` that
 * this row is the AUTHENTICATED CALLER'S team. So every question below is "is this franchise one a
 * window can describe", never "does this user own it" — ownership is settled before this runs.
 */

/** Mirrors `LeagueTeamLifecycleState`. Current/history axis. */
export type TeamLifecycleState = 'UNKNOWN' | 'CURRENT' | 'ARCHIVED'

/** Mirrors `LeagueTeamManagerKind`. Manager axis. */
export type TeamManagerKind = 'UNKNOWN' | 'HUMAN' | 'VACANT' | 'AI'

/**
 * The mirrored member lists, exported so a test can assert they still match the Prisma enums once
 * those land. A mirror nobody checks is a copy that drifts.
 */
export const KNOWN_LIFECYCLE_STATES: readonly TeamLifecycleState[] = ['UNKNOWN', 'CURRENT', 'ARCHIVED']
export const KNOWN_MANAGER_KINDS: readonly TeamManagerKind[] = ['UNKNOWN', 'HUMAN', 'VACANT', 'AI']

export const TEAM_GAP_LIFECYCLE_UNKNOWN = 'window_team_lifecycle_unknown'
export const TEAM_GAP_ARCHIVED = 'window_team_archived'
export const TEAM_GAP_MANAGER_UNKNOWN = 'window_team_manager_kind_unknown'
export const TEAM_GAP_SEAT_VACANT = 'window_team_seat_vacant_but_claimed'
export const TEAM_GAP_STATE_UNRECOGNISED = 'window_team_state_unrecognised'

export interface TeamStateFacts {
  lifecycleState: TeamLifecycleState | string | null | undefined
  managerKind: TeamManagerKind | string | null | undefined
  /** Competition axis. Present means knocked out; it does NOT mean archived. */
  eliminatedAt?: Date | string | null
  /** Metadata for an ARCHIVED transition. Never the discriminator. */
  archivedAt?: Date | string | null
}

export type TeamStateVerdict =
  | { resolvable: true; eliminated: boolean }
  | { resolvable: false; gap: string }

/**
 * ⚠ FAIL CLOSED ON ANYTHING UNRECOGNISED. If either enum gains a member, this refuses rather than
 * falling through to a resolvable default. A new state that silently reads as "fine" is how a
 * window gets computed for a franchise nobody has decided about yet — and it would ship green,
 * because no existing test names a value that does not exist yet.
 */
function known<T extends string>(value: unknown, members: readonly T[]): T | null {
  return typeof value === 'string' && (members as readonly string[]).includes(value) ? (value as T) : null
}

/**
 * Can a competitive window describe this franchise?
 *
 * The caller has already proved the row belongs to the authenticated user.
 */
export function resolveTeamState(facts: TeamStateFacts): TeamStateVerdict {
  const lifecycle = known(facts.lifecycleState, KNOWN_LIFECYCLE_STATES)
  const manager = known(facts.managerKind, KNOWN_MANAGER_KINDS)

  if (lifecycle === null || manager === null) return { resolvable: false, gap: TEAM_GAP_STATE_UNRECOGNISED }

  /*
   * 🛑 `UNKNOWN` REFUSES, AND IT IS THE MOST IMPORTANT LINE HERE. The column defaults to UNKNOWN
   * precisely so an unclassified row is not mistaken for a live one — its own schema comment says
   * calling it CURRENT "would be a guess that hides a departed team". Reading UNKNOWN as current
   * would compute a window for a franchise that may have left the league, and it would do it for
   * every pre-existing row on the day the migration runs, before any backfill classifies them.
   */
  if (lifecycle === 'UNKNOWN') return { resolvable: false, gap: TEAM_GAP_LIFECYCLE_UNKNOWN }
  if (lifecycle === 'ARCHIVED') return { resolvable: false, gap: TEAM_GAP_ARCHIVED }

  // lifecycle === 'CURRENT' from here.

  /*
   * Same reasoning one axis over: an unclassified manager must never silently read as HUMAN.
   */
  if (manager === 'UNKNOWN') return { resolvable: false, gap: TEAM_GAP_MANAGER_UNKNOWN }

  /*
   * ⚠ A CLAIMED SEAT RECORDED AS VACANT IS DATA CONTRADICTING ITSELF. The caller holds the claim;
   * the row says nobody is in the seat. Neither reading is safe to pick, so it refuses by name —
   * the same judgement the previous `isOrphan` stopgap made, now on a column that means one thing.
   */
  if (manager === 'VACANT') return { resolvable: false, gap: TEAM_GAP_SEAT_VACANT }

  /*
   * ⚠ `AI` RESOLVES, AND THAT IS A STATED ASSUMPTION RATHER THAN AN OBVIOUS READING.
   * The window describes a ROSTER and a RECORD, not an operator, and `claimedByUserId` has already
   * settled ownership — so an owner who has put their team on autopilot still has a real franchise
   * a window can describe. Refusing would deny them a window they are entitled to.
   *
   * It flips if `AI` turns out to mean "abandoned seat the platform is auto-piloting" rather than
   * "owner enabled autopilot", because that is a departed manager wearing a claim. That question
   * belongs to the import session and has been put to them. Pinned by its own test so the change is
   * one line and cannot happen by accident.
   */

  /*
   * ⚠ ELIMINATION IS NOT ARCHIVAL, AND IT DOES NOT BLOCK RESOLUTION. A guillotine or survivor team
   * that is out of the competition is still one of the league's current franchises, with a real
   * record and a real roster — which is exactly the evidence a 'rebuilding' verdict is made of.
   * It is reported so a consumer can label it, never used to refuse.
   */
  return { resolvable: true, eliminated: facts.eliminatedAt != null }
}
