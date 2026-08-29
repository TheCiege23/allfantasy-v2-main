/**
 * Roster ids that describe their own player.
 *
 * Some importers mint a descriptive id when the source platform gave them no
 * stable player id. The shape is `name:<full name>:<POS>:<CLUB>` — the name, the
 * position and the club, carried inside the id itself.
 *
 * ⚠ IT IS THE ONLY FOREIGN ID SPACE THIS APP CAN READ WITHOUT A MAPPING TABLE,
 * because the mapping is inside the string. Every other foreign id — ESPN's
 * numeric ids, ESPN's negative D/ST ids — needs a bridge we do not have, and
 * name-matching to build one is explicitly the wrong move here (`PlayerIdentityMap`
 * carries 178 NFL duplicate groups that no key separates).
 *
 * ⚠ A PURE MODULE ON PURPOSE. It lived in `myTeam.ts`, which imports prisma at
 * module scope — so a unit test for it could not load without mocking the whole
 * data layer, and in this repo that failure surfaces as a 60-second worker
 * timeout rather than an error anyone can read.
 */

export type DescribedPlayer = {
  name: string
  position: string | null
  team: string | null
}

/**
 * Parse a descriptive id, or return null.
 *
 * ⚠ STRICT ON PURPOSE. A name is the one field a bad parse would put in front of
 * a manager as fact, so anything that is not exactly four colon-separated parts
 * with a non-empty name returns null and falls through to the honest
 * "we could not identify this player" row. Blank position/club segments become
 * null rather than empty strings, because "" renders as a gap that looks like
 * data we hold.
 */
export function parseDescriptiveId(id: string): DescribedPlayer | null {
  if (!id.startsWith('name:')) return null
  const parts = id.split(':')
  if (parts.length !== 4) return null
  const name = parts[1]?.trim()
  if (!name) return null
  return {
    name,
    position: parts[2]?.trim() || null,
    team: parts[3]?.trim() || null,
  }
}
