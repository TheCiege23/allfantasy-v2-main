/**
 * The keys a keeper's history is counted under: the player id when there is one, and always the
 * normalized name + position (records and picks written before ids were reliable carry only a name).
 * One rule, shared by the eligibility engine's max-years count and the draft room's "Yr N" — two
 * copies of a normalizer drift, and a key one side writes the other can never find.
 */
export function keeperNameKey(name: string | null | undefined, position: string | null | undefined): string {
  return `${String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(position ?? '').trim().toUpperCase()}`
}

export function keeperPlayerKeys(player: { playerId?: string | null; playerName?: string | null; position?: string | null }): string[] {
  const id = player.playerId?.trim()
  return id ? [id, keeperNameKey(player.playerName, player.position)] : [keeperNameKey(player.playerName, player.position)]
}

/**
 * How many seasons each player has been a LOCKED keeper in this league, by every key it can be found
 * under. Counted from the records, never read from `KeeperRecord.yearsKept`: that column is written
 * as a constant 1 (`selectionEngine`), so it says "first year" for everyone.
 */
export function countKeeperYears(
  locked: ReadonlyArray<{ playerId?: string | null; playerName?: string | null; position?: string | null }>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const keep of locked) {
    for (const key of keeperPlayerKeys(keep)) out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}
