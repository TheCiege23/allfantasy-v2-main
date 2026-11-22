import type { WarHorizon, WarPosture } from './warRoomFront'

/**
 * The war chest — War Room phase 6, for the league on screen: the FAAB you have left against every
 * other team's, and what is left of the season to spend it in.
 *
 * ⚠ EVERY NUMBER IS THE LEAGUE'S OWN STORED STATE. `Roster.faabRemaining` per team (written by the
 * league sync) and `LeagueWaiverSettings.faabBudget`. A team whose balance was never recorded is shown
 * as unknown and ranked after every known one, never as zero — a missing number is not an empty wallet.
 *
 * ⚠ FACTS ABOUT RIVALS, NEVER LABELS (Scout's rule). A rival's balance is a number on the board; this
 * never calls anyone broke, a hoarder or a threat on the wire.
 *
 * ⚠ THE ONLY ADVICE IS ABOUT YOUR OWN WALLET, AND ONLY WHERE IT IS ARITHMETIC. In a redraft league a
 * balance left at season's end buys nothing, so with the regular season nearly done the screen says so.
 * Keeper and dynasty budgets may carry over or reset by league rule, which is not read here — so no
 * spending advice is given there at all, rather than a guess.
 *
 * Pure and client-safe.
 */

/** Within this many regular-season weeks of the end, a redraft balance is called out as use-it-or-lose-it. */
export const USE_IT_WEEKS = 3

export type WarChestRow = {
  rosterId: string
  name: string | null
  isYou: boolean
  /** Null when this team's balance was never recorded. */
  remaining: number | null
}

export type WarChest =
  | {
      kind: 'faab'
      /** The league's starting budget, when recorded. */
      budget: number | null
      /** Your balance, or null when it was never recorded. */
      you: number | null
      /** 1 = most money left, among teams with a known balance; ties share a rank. Null when yours is unknown. */
      rank: number | null
      /** Teams with a known balance. */
      known: number
      /** Most money first; unknown balances last. */
      rows: WarChestRow[]
      weeksRemaining: number | null
      /** Redraft, regular season nearly done, money left: anything unspent at season's end buys nothing. */
      useIt: boolean
    }
  | { kind: 'none'; why: 'not_faab' | 'not_read' }

export function buildWarChest(args: {
  /** `LeagueWaiverSettings.waiverType`; null when the league has no waiver settings row. */
  waiverType: string | null
  budget: number | null
  /** One row per team on the outlook board, with its stored balance. */
  teams: WarChestRow[]
  weeksRemaining: number | null
  horizon: WarHorizon
  posture: WarPosture
}): WarChest {
  if (String(args.waiverType ?? '').toLowerCase() !== 'faab') return { kind: 'none', why: 'not_faab' }
  const known = args.teams.filter((t) => t.remaining != null)
  if (known.length === 0) return { kind: 'none', why: 'not_read' }

  const rows = [...args.teams].sort(
    (a, b) =>
      (b.remaining ?? Number.NEGATIVE_INFINITY) - (a.remaining ?? Number.NEGATIVE_INFINITY) ||
      Number(b.isYou) - Number(a.isYou) ||
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  const me = args.teams.find((t) => t.isYou) ?? null
  const you = me?.remaining ?? null
  const rank = you == null ? null : 1 + known.filter((t) => (t.remaining as number) > you).length

  const useIt =
    args.horizon === 'this_season' &&
    args.posture !== 'eliminated' &&
    you != null &&
    you > 0 &&
    args.weeksRemaining != null &&
    args.weeksRemaining <= USE_IT_WEEKS

  return {
    kind: 'faab',
    budget: args.budget != null && args.budget > 0 ? args.budget : null,
    you,
    rank,
    known: known.length,
    rows,
    weeksRemaining: args.weeksRemaining,
    useIt,
  }
}
