/**
 * A league's own starting-slot vocabulary, and who is eligible to fill each one.
 *
 * ⚠ NO 'server-only', NO PRISMA, NO IMPORTS — DELIBERATELY. `MyTeam.tsx` is a
 * client component and needs the bench-check threshold to explain its own
 * verdict to the reader. Importing that constant from a `server-only` loader
 * typechecks perfectly and then fails at BUILD time with "You're importing a
 * component that needs server-only" — taking down the whole `/core` catch-all,
 * because every screen behind that route shares one bundle. Same trap, same
 * remedy, as `lib/core-app/weekBoardRules.ts`; read its header before adding
 * anything to this file.
 */

/** Roster template entries that are not starting slots. */
const NON_STARTING_SLOT = new Set(['BN', 'BENCH', 'IR', 'TAXI'])

/** Long template names that will not fit a slot column. */
const SLOT_ALIAS: Record<string, string> = {
  SUPER_FLEX: 'SFLEX',
  REC_FLEX: 'W/T',
  IDP_FLEX: 'IDP',
  WRRB_FLEX: 'FLEX',
  DST: 'DEF',
}

/**
 * The league's OWN starting-slot template, in lineup order.
 *
 * ⚠ THIS IS THE ONLY HONEST SOURCE FOR A SLOT NAME. Inferring one from the
 * player standing in it names a FLEX after whoever happens to be in it — so a
 * FLEX holding a tight end reads "TE", and a bench check run against that label
 * would then refuse every running back who is in fact eligible for the slot.
 * The label and the eligibility rule have to come from the same place.
 *
 * `roster_positions` is present on 70 of 70 Sleeper leagues in production and
 * reads `["QB","RB","RB","WR","WR","TE","FLEX","FLEX","SUPER_FLEX","DEF","BN",…]`.
 * Bench entries are dropped; what is left aligns index-for-index with
 * `Roster.playerData.starters`.
 *
 * Null when a league carries no template — which is when a caller's own
 * inference is the fallback, rather than the default.
 */
export function startingSlotTemplate(settings: unknown): string[] | null {
  if (!settings || typeof settings !== 'object') return null
  const s = settings as Record<string, unknown>
  const raw =
    (Array.isArray(s.roster_positions) && s.roster_positions) ||
    (Array.isArray(s.rosterPositions) && s.rosterPositions) ||
    null
  if (!raw) return null
  const slots = raw
    .map((v) => String(v ?? '').trim().toUpperCase())
    .filter((v) => v.length > 0 && !NON_STARTING_SLOT.has(v))
    .map((v) => SLOT_ALIAS[v] ?? v)
  return slots.length > 0 ? slots : null
}

/**
 * Which positions may legally fill each slot.
 *
 * ⚠ THIS GATE IS THE DIFFERENCE BETWEEN ADVICE AND NOISE. A bench check without
 * it will tell a manager their kicker outprojects their quarterback, which is
 * true, useless, and impossible to act on. A slot this table does not know
 * returns null and the check REFUSES rather than guessing at eligibility —
 * suggesting an illegal swap is worse than suggesting none.
 */
const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  SFLEX: ['QB', 'RB', 'WR', 'TE'],
  'W/T': ['WR', 'TE'],
  IDP: ['DL', 'LB', 'DB'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
}

/** True when `position` may start in `slotLabel`. Unknown slot ⇒ false. */
export function isEligibleForSlot(
  slotLabel: string | null | undefined,
  position: string | null | undefined,
): boolean {
  const slot = (slotLabel ?? '').trim().toUpperCase()
  const pos = (position ?? '').trim().toUpperCase()
  if (!slot || !pos) return false
  const allowed = SLOT_ELIGIBILITY[slot]
  if (!allowed) return false
  return allowed.includes(pos === 'DST' ? 'DEF' : pos)
}

/**
 * How far ahead a bench player must project before swapping him in is advice
 * rather than noise.
 *
 * ⚠ NOT A ROUND NUMBER PICKED FOR LOOKS, AND NOT `COIN_FLIP_POINTS`. That
 * constant is 12 and describes two whole TEAMS being level; applied to one
 * player it would suppress every real recommendation. A single weekly player
 * projection carries several points of standard error, so a sub-2-point gap is
 * inside the model's own noise: the number cannot support "start him instead",
 * and a strip that says so anyway is a coin flip dressed as a decision.
 *
 * Below this the strip still renders — the check always runs — but the verdict
 * is that the starter is fine. That is the handoff's own rule.
 */
export const BENCH_SWAP_POINTS = 2
