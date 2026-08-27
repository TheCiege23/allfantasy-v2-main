/**
 * One franchise across two platforms, and whether a deal that spans both
 * actually landed on both.
 *
 * A manager running his NFL side on Sleeper and his college side on Fantrax has
 * one team in his head and two leagues in ours. `FranchiseLink` is the row that
 * says so; this is the logic that reads it.
 *
 * ── What this can and cannot do, and why the distinction is the whole design ──
 *
 * ⚠ WE CANNOT EXECUTE EITHER HALF OF A CROSS-PLATFORM TRADE. Sleeper's API is
 * read-only — there is no write endpoint at all — and Fantrax reaches us as a
 * periodic CSV upload rather than an integration. So AllFantasy can evaluate a
 * two-sided deal and watch for it, and can never perform it.
 *
 * ⚠ WHICH MEANS THE DANGEROUS STATE IS "PARTIAL", NOT "PENDING". A deal agreed
 * in good faith that lands on Sleeper and never on Fantrax leaves the two
 * franchises permanently unbalanced — one manager has both halves of what he
 * wanted and the other has half — and NEITHER PLATFORM CAN SEE IT, because each
 * one only ever saw a legal, complete trade of its own. We are the only party
 * holding both sides. Reporting that is the product.
 *
 * ⚠ AND THE TWO SIDES ARE NOT GRADED ON ONE SCALE. The pro leg prices off a real
 * market; the college leg has no market at all — see
 * lib/trade-intel/devyOutlook.ts. Each leg is evaluated in its own units and
 * reported separately. Summing them would be the exact fabrication the devy work
 * exists to prevent, and being one franchise does not create an exchange rate.
 */

/** Which half of the franchise a league is. */
export type FranchiseRole = 'pro' | 'college'

export type FranchiseMember = {
  role: FranchiseRole
  platform: string
  /** League.id for the pro side, FantraxLeague.id for the college side. */
  leagueId: string
  /** Null when the owner has not been matched to a team in that league yet. */
  teamExternalId: string | null
  /**
   * Whether the referenced league row still exists.
   *
   * ⚠ THERE IS NO FOREIGN KEY — the two sides live in different tables, so the
   * reference is loose and a league can vanish underneath a link. Absent is a
   * state the resolver must carry, not a crash.
   */
  leaguePresent: boolean
}

export type FranchiseView = {
  linkId: string
  name: string
  members: FranchiseMember[]
  /** True only when both halves resolve to a live league AND a known team. */
  complete: boolean
  /** Everything the combined view cannot currently show. */
  gaps: string[]
  basis: string
}

export const FRANCHISE_GAPS = {
  missingRole: (role: FranchiseRole) =>
    `no ${role} league is linked to this franchise, so the combined view is one-sided`,
  missingLeague: (role: FranchiseRole, platform: string) =>
    `the linked ${role} league on ${platform} no longer exists, so its half of the franchise cannot be read`,
  unmatchedTeam: (role: FranchiseRole) =>
    `we have not matched you to a team in the ${role} league, so we cannot tell which roster is yours — it is not assumed`,
  noExecution:
    'AllFantasy cannot execute either half of a cross-platform trade: Sleeper is read-only and Fantrax arrives as a periodic upload, so a deal is tracked here and carried out on each platform by hand',
} as const

/**
 * Assemble the combined view of a franchise.
 *
 * ⚠ REFUSES TO GUESS AT AN UNMATCHED TEAM. A franchise whose owner has not been
 * matched to a team in one of its leagues is reported incomplete rather than
 * defaulted to the first roster, which would attribute a stranger's players to
 * him and then grade trades against them.
 */
export function buildFranchiseView(args: {
  linkId: string
  name: string
  members: FranchiseMember[]
}): FranchiseView {
  const { members } = args
  const gaps: string[] = []

  for (const role of ['pro', 'college'] as const) {
    const member = members.find((m) => m.role === role)
    if (!member) {
      gaps.push(FRANCHISE_GAPS.missingRole(role))
      continue
    }
    if (!member.leaguePresent) gaps.push(FRANCHISE_GAPS.missingLeague(role, member.platform))
    else if (!member.teamExternalId) gaps.push(FRANCHISE_GAPS.unmatchedTeam(role))
  }

  const complete = gaps.length === 0
  const sides = members
    .map((m) => `${m.role} on ${m.platform}`)
    .sort()
    .join(' and ')

  return {
    linkId: args.linkId,
    name: args.name,
    members,
    complete,
    gaps,
    basis: complete
      ? `${args.name} is one franchise across ${sides}. Trades spanning both are tracked here, and carried out on each platform by hand.`
      : `${args.name} is not yet a complete franchise view — ${gaps.length} thing${gaps.length === 1 ? '' : 's'} still missing, listed below.`,
  }
}

/** What one platform's half of a deal does, as agreed by the managers. */
export type TradeLeg = {
  role: FranchiseRole
  platform: string
  sends: string[]
  receives: string[]
  /**
   * Whether a later sync or upload actually showed the move.
   *
   * ⚠ `contradicted` IS NOT `pending`. Pending means we have not looked or the
   * platform has not updated; contradicted means we looked and the players did
   * not move. Collapsing them would let a deal one side quietly abandoned sit
   * forever as "still waiting".
   */
  status: 'pending' | 'observed' | 'contradicted'
  observedAt?: Date | null
  basis?: string | null
}

export type SettlementStatus = 'pending' | 'settled' | 'partial' | 'contradicted'

export type Settlement = {
  status: SettlementStatus
  /** True when one side has landed and another has not — the unbalanced state. */
  unbalanced: boolean
  observed: FranchiseRole[]
  outstanding: FranchiseRole[]
  /** Plain-language statement for the manager. Always present. */
  basis: string
  gaps: string[]
}

/**
 * Derive whether a cross-platform deal has actually happened.
 *
 * ⚠ THE POINT IS `partial`. Every other state is either fine or obviously bad;
 * partial is the one that looks fine on both platforms and is not.
 */
export function settleCrossPlatformTrade(legs: TradeLeg[]): Settlement {
  const gaps = [FRANCHISE_GAPS.noExecution]

  if (legs.length === 0) {
    return {
      status: 'pending',
      unbalanced: false,
      observed: [],
      outstanding: [],
      basis: 'This deal has no legs recorded, so there is nothing to settle.',
      gaps,
    }
  }

  const observed = legs.filter((l) => l.status === 'observed').map((l) => l.role)
  const contradicted = legs.filter((l) => l.status === 'contradicted')
  const outstanding = legs.filter((l) => l.status !== 'observed').map((l) => l.role)

  /*
   * A contradicted leg is decided: we looked and it did not happen. If another
   * leg HAS landed, the franchises are already unbalanced and saying so is
   * urgent — that is not a deal still in progress.
   */
  if (contradicted.length > 0) {
    const anyLanded = observed.length > 0
    return {
      status: 'contradicted',
      unbalanced: anyLanded,
      observed,
      outstanding,
      gaps,
      basis: anyLanded
        ? `The ${observed.join(' and ')} side of this deal went through, but the ${contradicted
            .map((l) => l.role)
            .join(' and ')} side did not. The two franchises are now unbalanced, and neither platform can see it because each only ever saw a complete trade of its own.`
        : `The ${contradicted.map((l) => l.role).join(' and ')} side of this deal did not go through. Nothing has moved.`,
    }
  }

  if (observed.length === legs.length) {
    return {
      status: 'settled',
      unbalanced: false,
      observed,
      outstanding: [],
      gaps,
      basis: `Both halves of this deal have been seen on their platforms. Nothing is outstanding.`,
    }
  }

  if (observed.length === 0) {
    return {
      status: 'pending',
      unbalanced: false,
      observed: [],
      outstanding,
      gaps,
      basis: `Neither half of this deal has been seen yet. Each side has to be carried out on its own platform — we cannot do it for you.`,
    }
  }

  return {
    status: 'partial',
    unbalanced: true,
    observed,
    outstanding,
    gaps,
    basis: `⚠ The ${observed.join(' and ')} half of this deal has gone through and the ${outstanding.join(
      ' and ',
    )} half has not. Until it does, the franchises are unbalanced — and neither platform will flag it, because each one only ever saw a legal trade of its own.`,
  }
}

/**
 * How a cross-platform deal should be reported, given the two halves cannot
 * share a scale.
 *
 * ⚠ RETURNS THE LEGS SEPARATELY AND REFUSES A COMBINED NUMBER. Belonging to one
 * franchise does not create an exchange rate between a market-priced NFL asset
 * and a college player nobody prices. See refuseMixedScaleGrade in
 * lib/trade-intel/devyOutlook.ts — this is the same rule at franchise scope.
 */
export function describeCrossPlatformTrade(legs: TradeLeg[]): {
  perLeg: Array<{ role: FranchiseRole; platform: string; summary: string }>
  combinedVerdict: null
  basis: string
} {
  const perLeg = legs.map((l) => ({
    role: l.role,
    platform: l.platform,
    summary: `${l.platform} (${l.role}): sends ${l.sends.join(', ') || 'nothing'}; receives ${
      l.receives.join(', ') || 'nothing'
    }`,
  }))

  return {
    perLeg,
    combinedVerdict: null,
    basis:
      'Each half of this deal is graded in its own units and reported on its own. There is no single number for the whole trade: the pro side prices off a real market and the college side has no market at all, so a combined verdict would rest on an exchange rate nobody has measured.',
  }
}
