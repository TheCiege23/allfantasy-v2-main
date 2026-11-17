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
  /* NOT 'FLEX': Sleeper's WRRB_FLEX takes no tight end, and FLEX below does — the bench check
     offered TEs for a slot they cannot fill. Same rule as slotEligibility.ts. */
  WRRB_FLEX: 'W/R',
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
  const cleaned = raw.map((v) => String(v ?? '').trim().toUpperCase()).filter((v) => v.length > 0)

  /*
   * ⚠ ESPN COMPRESSES THIS COLUMN AND THE TWO SHAPES ARE NOT INTERCHANGEABLE.
   * Sleeper writes one entry per starting slot, in lineup order. ESPN writes
   * SLOT:COUNT pairs — measured on production:
   *
   *     ["QB:1","RB:2","WR:2","TE:1","D/ST:1","K:1","BE:7","IR:1","FLEX:1"]
   *
   * Read as a Sleeper template that is nine labels for an eight-man lineup, and
   * `"BE:7"`/`"IR:1"` do not match the bench filter either — so bench and IR
   * were being handed out as STARTING slot names, index-for-index against a
   * lineup they do not describe. On a live ESPN roster that rendered Ja'Marr
   * Chase in "QB:1" and a kicker in "D/ST:1".
   *
   * ⚠ AND EXPANDING THE PAIRS DOES NOT RESCUE IT. Expanded, the template leads
   * with QB; the actual `starters` array for that same roster leads with a WR.
   * The two orderings are simply not the same fact, so there is nothing here to
   * align against and any label produced would be a guess.
   *
   * So it refuses, which is what this function's null already means and what
   * the eligibility table below already does for an unknown slot. The caller
   * falls back to its own inference — a neutral "SLOT 3" that claims nothing —
   * rather than asserting a position this league never told us.
   */
  if (cleaned.some((v) => /^[A-Z/]+:\d+$/.test(v))) return null

  const slots = cleaned
    .filter((v) => !NON_STARTING_SLOT.has(v))
    .map((v) => SLOT_ALIAS[v] ?? v)
  return slots.length > 0 ? slots : null
}

/** ESPN's slot names (`espnLookups.ts`) in this file's vocabulary. */
const PROVIDER_SLOT_ALIAS: Record<string, string> = {
  'D/ST': 'DEF',
  'RB/WR': 'W/R',
  'WR/TE': 'W/T',
  OP: 'SFLEX',
}

/**
 * The slot each starter is ACTUALLY in, as the provider recorded it at import — or null.
 *
 * ⚠ THIS IS WHAT AN ESPN LINEUP NEVER HAD. `startingSlotTemplate` refuses ESPN's SLOT:COUNT
 * template (it cannot be aligned to the stored `starters`), so every ESPN slot was named after
 * whoever stood in it: a FLEX holding Sam LaPorta read "TE", beside the real TE. The importer
 * now keeps ESPN's own `lineupSlotId` per starter as `starter_slot_by_id`, keyed by PLAYER ID
 * rather than by index, so a re-ordered `starters` list cannot mis-pair a label.
 *
 * All or nothing: if any starter has no label, or a label is a bench/unknown slot, the map is
 * ignored and the caller falls back to inference — half a lineup named by the provider and half
 * guessed would hide which half to trust. Rosters imported before this field existed carry no
 * map and fall back exactly as before until their next sync.
 */
export function storedStarterSlotLabels(byId: unknown, starterIds: readonly string[]): string[] | null {
  if (!byId || typeof byId !== 'object' || Array.isArray(byId)) return null
  const map = byId as Record<string, unknown>
  const labels: string[] = []
  for (const id of starterIds) {
    const raw = String(map[id] ?? '').trim().toUpperCase()
    if (!raw || NON_STARTING_SLOT.has(raw) || raw === 'BE' || /^SLOT[_ ]/.test(raw)) return null
    labels.push(SLOT_ALIAS[raw] ?? PROVIDER_SLOT_ALIAS[raw] ?? raw)
  }
  return labels.length > 0 ? labels : null
}

/**
 * The order a football lineup reads in: QB, RB, WR, TE, the flexes, superflex, then D/ST and K,
 * then IDP. Any label not listed (a neutral `SLOT 9`) sorts last.
 */
const LINEUP_READING_ORDER = ['QB', 'RB', 'WR', 'TE', 'W/R', 'W/T', 'FLEX', 'SFLEX', 'DEF', 'K', 'DL', 'LB', 'DB', 'IDP', 'P']

/**
 * Starting slots in reading order, stable within a label.
 *
 * ⚠ ONLY FOR A LINEUP WITH NO TEMPLATE. A Sleeper `roster_positions` template IS the league's own
 * order and must be left alone. An imported ESPN lineup is stored in whatever order the provider's
 * roster array happened to list players — Ja'Marr Chase first, the QB fifth — so without this the
 * screen read as a shuffled list rather than a lineup.
 */
export function orderStartingSlots<T extends { slotLabel: string }>(slots: readonly T[]): T[] {
  const rank = (label: string) => {
    const i = LINEUP_READING_ORDER.indexOf(label.trim().toUpperCase())
    return i === -1 ? LINEUP_READING_ORDER.length : i
  }
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => rank(a.slot.slotLabel) - rank(b.slot.slotLabel) || a.index - b.index)
    .map(({ slot }) => slot)
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
  'W/R': ['WR', 'RB'],
  IDP: ['DL', 'LB', 'DB'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
}

// Fantrax NBA's verified slot vocabulary (see fantraxProSports.ts). Keep it
// sport-scoped: `G` is a basketball guard but a hockey goalie.
const NBA_SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
  G: ['PG', 'SG'], F: ['SF', 'PF'],
  UTIL: ['PG', 'SG', 'SF', 'PF', 'C'],
  FLEX_G_F: ['PG', 'SG', 'SF', 'PF'],
  FLEX_F_C: ['SF', 'PF', 'C'],
}

/** True when `position` may start in `slotLabel`. Unknown slot ⇒ false. */
export function isEligibleForSlot(
  slotLabel: string | null | undefined,
  position: string | null | undefined,
  sport?: string | null,
): boolean {
  const slot = (slotLabel ?? '').trim().toUpperCase()
  const pos = (position ?? '').trim().toUpperCase()
  if (!slot || !pos) return false
  const allowed = sport?.toUpperCase() === 'NBA' ? NBA_SLOT_ELIGIBILITY[slot] : SLOT_ELIGIBILITY[slot]
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
