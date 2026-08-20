/**
 * One spelling for a position, whatever the source called it.
 *
 * ⚠ THIS LIVES IN ITS OWN server-only-FREE MODULE BECAUSE MORE THAN ONE PLACE
 * NEEDS IT, AND THE COST OF THEM DISAGREEING IS SILENT. Measured on production:
 * the game-day replacement finder compared a player stored as "Quarterback"
 * (TheSportsDB) against bench players stored as "QB" (Sleeper) and concluded
 * "nobody on your bench can fill a Quarterback slot" — for a roster holding two
 * quarterbacks. It did not error, it did not look wrong; it just quietly withheld
 * the right answer at the exact moment someone needed it.
 *
 * Same family as the JAX/JAC franchise split: two sources, one concept, no
 * normalisation, and a join that returns nothing while looking healthy.
 */

/*
 * Positions arrive spelled differently per source — Sleeper says "TE", the
 * TheSportsDB ingest says "Tight End". Deduplicating on the raw string listed
 * Dalton Kincaid twice in the same result set, which reads as two players rather
 * than one player from two feeds.
 */
export const POSITION_ALIASES: Record<string, string> = {
  quarterback: 'QB',
  'running back': 'RB',
  'wide receiver': 'WR',
  'tight end': 'TE',
  kicker: 'K',
  'place kicker': 'K',
  'defensive end': 'DE',
  'defensive tackle': 'DT',
  linebacker: 'LB',
  cornerback: 'CB',
  safety: 'S',
  'offensive tackle': 'OT',
  guard: 'G',
  center: 'C',
  'point guard': 'PG',
  'shooting guard': 'SG',
  'small forward': 'SF',
  'power forward': 'PF',
  goalkeeper: 'GK',
  midfielder: 'MF',
  defender: 'DF',
  forward: 'FW',
  pitcher: 'P',
  catcher: 'C',
}

export function normalizePosition(raw: string | null): string {
  if (!raw) return ''
  const t = raw.trim().toLowerCase()
  return (POSITION_ALIASES[t] ?? raw.trim()).toUpperCase()
}

