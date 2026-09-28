/**
 * WHAT A STORED LINEUP CAN AND CANNOT PROVE — one sentence set, shared by every tool that shows
 * starters, so two tools cannot drift into two different promises.
 *
 * ⚠ A GENERAL CAVEAT WAS NOT ENOUGH. `get_my_injuries` already said "does not verify kickoff locks,
 * provider transaction rules or AutoSubs eligibility", and a KBFL answer (2026-09-28) still told the
 * user, in the same breath as that disclaimer, that an Out starter means "you take the zero" and
 * that the lineup optimizer would show "which can still legally be replaced". Both are claims the
 * evidence cannot carry: the platform may auto-substitute, the slot may already be locked, and
 * `optimize_my_lineup` screens OUR kickoff schedule and stored lineup — it never reads the
 * provider's locks, AutoSubs or transaction rules. So the rule names the two forms outright.
 *
 * Pure, so tools and tests share one text.
 */

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  fantasypros: 'FantasyPros',
  allfantasy: 'AllFantasy',
  af: 'AllFantasy',
}

export function platformLabel(platform: string | null | undefined): string {
  const key = (platform ?? '').trim().toLowerCase()
  return PLATFORM_LABEL[key] ?? 'the league\'s host platform'
}

/** The two sentences the answer must not write, as conditioned alternatives. */
export const LINEUP_ACTION_RULES =
  'Never say categorically that an Out/IR starter "scores zero" or "you take the zero": say he scores nothing ' +
  'UNLESS the platform auto-substitutes him or he is moved before his slot locks — both unverified here. ' +
  'Never say optimize_my_lineup or any AllFantasy tool shows which moves are LEGAL or "can still be replaced": ' +
  'it identifies candidate swaps from the stored lineup, injuries, projections and the AllFantasy kickoff schedule; ' +
  'legality must be confirmed on the platform.'

export function lineupActionEvidence(args: {
  platform: string | null | undefined
  bestBallMode: boolean
  lastSyncedAt?: Date | string | null
}): string {
  const where = platformLabel(args.platform)
  if (args.bestBallMode) {
    return (
      'LINEUP ACTION EVIDENCE: Best Ball — the scoring lineup is chosen automatically, so there is no start/sit move to recommend. ' +
      'An Out player contributes no points; whether a slot goes empty depends on depth at that position. Do not tell the user to bench, start or swap anyone.'
    )
  }
  const synced = args.lastSyncedAt ? ` (league last synced ${new Date(args.lastSyncedAt).toISOString()})` : ''
  return [
    `LINEUP ACTION EVIDENCE: the STARTERS above are AllFantasy's stored copy of the lineup${synced}, not a live read from ${where}.`,
    `NOT verified: whether each starter's game has kicked off or his slot is locked, whether ${where} auto-substitutes inactive starters, and whether any swap, IR move, waiver or trade is allowed right now.`,
    LINEUP_ACTION_RULES,
    `Tell the user to confirm on ${where} before acting.`,
  ].join(' ')
}
