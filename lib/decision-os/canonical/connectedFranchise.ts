/**
 * Connected-franchise FORWARD COMPATIBILITY (Phase 3A). PURE types only — NO resolution, NO service, NO
 * inference, NO provider calls, NO connection records.
 *
 * A "connected franchise" is a future user/commissioner-AUTHORIZED relationship linking teams across leagues,
 * sports, and platforms into one portfolio context — e.g. a Sleeper NFL team + a Fantrax NCAAF devy team owned by
 * the same person. Phase 3A only reserves the typed identifiers + references so the canonical contract + schema
 * can carry a `connectedFranchiseId`. AllFantasy MUST NEVER decide on its own that two leagues are connected —
 * the relationship is created only by an explicit user/commissioner action in a later phase.
 */
export type ConnectedFranchiseRole = 'primary' | 'linked'

/** One league/team's membership in a connected-franchise group. Reserved for a later phase's persisted model. */
export type ConnectedFranchiseMemberRef = {
  connectedFranchiseId: string
  leagueId: string
  sourcePlatform: string
  sport: string
  role: ConnectedFranchiseRole
}

/** The only permitted origin of a connection. AF never auto-links; a connection is user-authorized only. */
export const CONNECTED_FRANCHISE_AUTHORITY = 'user_authorized_only' as const
