/**
 * Who can do what in a tournament.
 *
 * 🛑 TODAY A TOURNAMENT HAS EXACTLY ONE EMPOWERED PERSON —
 * `TournamentShell.commissionerId`. There is no way to let a co-commissioner
 * look at the standings without handing them the entire tournament, and no way
 * to let the person who actually runs one of the twenty leagues send a message
 * to it. The commissioner's own rule: co-commissioners have access and change
 * nothing until it is granted, and access can go to people who are not
 * commissioners of anything.
 *
 * ⚠ PURE, AND DELIBERATELY NOT WIRED TO A TABLE YET. The grants table is a
 * parked migration (`prisma/migrations-pending/20260831_tournament_grants`).
 * Reading a table production does not have raises P2021, so the rules land
 * first and the storage follows once the migration is applied. Everything here
 * is decidable from values a caller already holds.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A FIFTH COMMISSIONER PREDICATE. This repo already
 * has four that disagree about what "commissioner" means for a LEAGUE
 * (`assertCommissioner` on `League.userId`, `getLeagueRole`,
 * `resolveActiveLeagueContext`, and the never-set `LeagueTeam.isCommissioner`).
 * This answers a different question about a different object — who may act on a
 * TOURNAMENT — and must not be reached for to answer the league one.
 */

export type TournamentCapability = 'view' | 'broadcast' | 'advance' | 'editSettings' | 'grantAccess'

/** A stored grant. Shaped to match the parked table, one field per column. */
export type TournamentGrantLike = {
  userId: string
  canBroadcast: boolean
  canAdvance: boolean
  canEditSettings: boolean
}

export type ViewerContext = {
  userId: string | null
  commissionerId: string
  /** The viewer's grant, when they have one. */
  grant?: TournamentGrantLike | null
}

/**
 * The named roles the UI offers.
 *
 * ⚠ A LABEL, NOT THE ENFORCEMENT. The booleans on the row are what `can()`
 * reads, so a role renamed or redefined later cannot silently widen anybody's
 * access — the only way to gain a capability is for someone to write the
 * corresponding column.
 */
export const GRANT_ROLES: Record<string, Omit<TournamentGrantLike, 'userId'> & { label: string }> = {
  viewer: {
    label: 'Can look, nothing else',
    canBroadcast: false,
    canAdvance: false,
    canEditSettings: false,
  },
  announcer: {
    label: 'Can look and send messages',
    canBroadcast: true,
    canAdvance: false,
    canEditSettings: false,
  },
  co_commissioner: {
    label: 'Can look, message and change settings',
    canBroadcast: true,
    canAdvance: false,
    canEditSettings: true,
  },
}

/**
 * Can this viewer do this?
 *
 * 🛑 `advance` AND `grantAccess` ARE NEVER GRANTABLE, and that is the point of
 * having this function rather than a boolean check at each call site.
 *
 * Advancement is the one irreversible act in the whole feature — it ends
 * hundreds of seasons and cannot be undone — so it stays with the person whose
 * tournament it is. Granting access is excluded for the ordinary reason: a
 * delegate who can delegate can quietly widen the circle past the point the
 * commissioner ever agreed to, and every step of that looks legitimate.
 *
 * Note `co_commissioner` therefore carries no `canAdvance` column value that
 * matters — the capability check refuses it regardless of what is stored, so a
 * hand-edited row cannot buy it either.
 */
export function can(ctx: ViewerContext, capability: TournamentCapability): boolean {
  if (!ctx.userId) return false

  const isCommissioner = ctx.userId === ctx.commissionerId
  if (isCommissioner) return true

  /* Only the commissioner ever advances or delegates — not a granted role, and
     not a grant row that claims otherwise. */
  if (capability === 'advance' || capability === 'grantAccess') return false

  const grant = ctx.grant
  if (!grant || grant.userId !== ctx.userId) return false

  switch (capability) {
    case 'view':
      /* ⚠ Every grant includes read. Having a row IS the view permission — there
         is no `canView` column, because a grant that lets you do something
         without seeing it is not a thing anybody wants. */
      return true
    case 'broadcast':
      return grant.canBroadcast === true
    case 'editSettings':
      return grant.canEditSettings === true
    default:
      return false
  }
}

/** Everything this viewer can do, for rendering a screen without guessing. */
export function capabilitiesOf(ctx: ViewerContext): Record<TournamentCapability, boolean> {
  return {
    view: can(ctx, 'view'),
    broadcast: can(ctx, 'broadcast'),
    advance: can(ctx, 'advance'),
    editSettings: can(ctx, 'editSettings'),
    grantAccess: can(ctx, 'grantAccess'),
  }
}

/**
 * Turn a role name into the columns to store.
 *
 * ⚠ AN UNKNOWN ROLE RESOLVES TO THE LEAST ACCESS, NOT TO NOTHING AND NOT TO
 * MORE. A typo must not create a grant that can do more than intended, and
 * returning null instead would push each caller into inventing its own default.
 */
export function grantColumnsForRole(role: string): Omit<TournamentGrantLike, 'userId'> {
  const known = GRANT_ROLES[role]
  if (!known) return { canBroadcast: false, canAdvance: false, canEditSettings: false }
  return {
    canBroadcast: known.canBroadcast,
    canAdvance: known.canAdvance,
    canEditSettings: known.canEditSettings,
  }
}
