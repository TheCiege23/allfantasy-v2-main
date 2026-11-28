/**
 * A roster id that SAYS it is a Sleeper id: `sleeper:<id>`.
 *
 * 🛑 WHY A PREFIX AND NOT THE BARE ID. A league on a foreign platform (Yahoo, Fleaflicker, MFL,
 * Fantrax) is stripped by every Sleeper-id reader (`rosterIdSpace.ts`), because its bare ids are
 * numbers in Sleeper's range and a collision is a HIT that names a stranger. A Yahoo league the
 * commissioner PASTED has no Yahoo ids at all: the import resolves each player to our own id
 * (`lib/league-import/yahoo/snapshot/yahooSnapshotPlayerIds.ts`). Stored bare, that id is
 * indistinguishable from a foreign one and is stripped with the rest; stored as `sleeper:<id>`, it
 * carries its own namespace — the same spelling `SportsPlayer.externalId` uses for Sleeper rows — so
 * the readers can honour it without trusting the platform, and no other platform ever writes it.
 *
 * Pure (no prisma) so the readers and the importer share one definition and it can be unit-tested.
 */
const DECLARED_SLEEPER_PREFIX = 'sleeper:'

/** `sleeper:4984` → `4984`; anything else → null. */
export function declaredSleeperId(rosterId: unknown): string | null {
  if (typeof rosterId !== 'string' || !rosterId.startsWith(DECLARED_SLEEPER_PREFIX)) return null
  const id = rosterId.slice(DECLARED_SLEEPER_PREFIX.length).trim()
  return id ? id : null
}

/** The stored form of a resolved Sleeper id (a player id, or a team code for a defence). */
export function toDeclaredSleeperId(sleeperId: string): string {
  return `${DECLARED_SLEEPER_PREFIX}${sleeperId.trim()}`
}

/**
 * A FOREIGN league's lineup (its starters, in slot order) as a Sleeper-id reader may price it: a
 * declared id becomes its bare Sleeper id, an empty slot (`'0'`, `''`) stays empty, and every other id
 * stays IN ITS SLOT as `unbridged:<id>` — the placeholder `bridgedRosterIds.ts` uses — which no
 * Sleeper-id read can match. So a pasted player nobody resolved is counted as unpriced, never dropped
 * (a smaller total) or read raw (a stranger: a bare Yahoo number is in Sleeper's range).
 *
 * A lineup with NO declared id returns `[]`, exactly as a foreign lineup always read: only the
 * pasted-Yahoo import writes declared ids, so every other foreign lineup is unchanged.
 */
export function declaredLineupIds(starters: readonly unknown[]): string[] {
  if (!starters.some((x) => declaredSleeperId(x) !== null)) return []
  return starters.map((x) => {
    const raw = x == null ? '' : String(x)
    if (raw === '' || raw === '0') return raw
    return declaredSleeperId(raw) ?? `unbridged:${raw}`
  })
}
