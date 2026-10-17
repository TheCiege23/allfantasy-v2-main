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

/**
 * The sentences the answer must not write, as conditioned alternatives.
 *
 * ⚠ THE KICKOFF CLAUSE IS WHAT THE FIRST VERSION LACKED. With only the two conditions above it, a
 * 2026-09-28 KBFL baseline still listed "swap a healthy TE into Johnson's slot" as a move "still
 * open" — five and a half hours after that game kicked off, in a league whose own rules said
 * "lock is game_time". Conditioning a claim is not enough when the fact that settles it is on file.
 */
export const LINEUP_ACTION_RULES =
  'Never say categorically that an Out/IR starter "scores zero" or "you take the zero": say he scores nothing ' +
  'UNLESS the platform auto-substitutes him or he is moved before his slot locks — both unverified here. ' +
  'Never say optimize_my_lineup or any AllFantasy tool shows which moves are LEGAL or "can still be replaced": ' +
  'it identifies candidate swaps from the stored lineup, injuries, projections and the AllFantasy kickoff schedule; ' +
  'legality must be confirmed on the platform. ' +
  'When a tool marks a starter GAME STARTED, treat his slot as locked for this week unless the league\'s own rules say ' +
  'otherwise: never list benching, swapping or replacing him as a move still open this week, and never call his slot ' +
  'fixable — say the decision point has passed for this week. Only a starter marked NOT STARTED can be offered as a ' +
  'possible swap, and still subject to the platform.'

export type KickoffState = 'started' | 'not_started' | 'unverified'

/** The shape `checkStartedGames` returns, restated so this module stays pure (no server-only import). */
export type KickoffCheck = { started: Map<string, string>; unverified: string[] }

export function kickoffStateOf(playerId: string, check: KickoffCheck | null): KickoffState {
  if (!check) return 'unverified'
  if (check.started.has(playerId)) return 'started'
  if (check.unverified.includes(playerId)) return 'unverified'
  return 'not_started'
}

/** Short per-player label for an inline annotation. */
export function kickoffLabel(playerId: string, check: KickoffCheck | null): string {
  const state = kickoffStateOf(playerId, check)
  if (state === 'started') return 'GAME STARTED'
  if (state === 'not_started') return 'NOT STARTED'
  return 'KICKOFF UNVERIFIED'
}

/**
 * One line covering every starter, or null when there is nobody to report.
 *
 * ⚠ "COULD NOT CHECK" IS ITS OWN BUCKET. A failed schedule read must not turn every starter into
 * "not started" — that is the direction that would reopen the exact defect this exists to close.
 */
export function kickoffStatusLine(
  starters: Array<{ playerId: string; name: string }>,
  check: KickoffCheck | null,
  now: Date,
): string | null {
  if (starters.length === 0) return null
  const started: string[] = []
  const open: string[] = []
  const unknown: string[] = []
  for (const p of starters) {
    const state = kickoffStateOf(p.playerId, check)
    if (state === 'started') started.push(check?.started.get(p.playerId) ?? `${p.name}'s game has already started`)
    else if (state === 'not_started') open.push(p.name)
    else unknown.push(p.name)
  }
  const parts = [
    started.length ? `GAME STARTED (${started.length}): ${started.join('; ')}.` : null,
    open.length ? `NOT STARTED (${open.length}): ${open.join(', ')}.` : null,
    unknown.length ? `KICKOFF UNVERIFIED (${unknown.length}): ${unknown.join(', ')} — could not be checked either way, never read as not started.` : null,
  ].filter(Boolean)
  return `KICKOFF STATUS of STARTERS (AllFantasy game schedule, checked ${now.toISOString()}; the schedule, not the platform's lock): ${parts.join(' ')}`
}

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
    `Kickoff comes only from the KICKOFF STATUS line, when present — the AllFantasy schedule, not ${where}. NOT verified: when ${where} locks each slot, whether ${where} auto-substitutes inactive starters, and whether any swap, IR move, waiver or trade is allowed right now.`,
    LINEUP_ACTION_RULES,
    `Tell the user to confirm on ${where} before acting.`,
  ].join(' ')
}
