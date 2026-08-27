/**
 * Which provider id -> name pairs are safe to store.
 *
 * ⚠ THE NAMES WERE NEVER MISSING — THEY WERE DISCARDED. An ESPN draft pick arrives
 * from `mDraftDetail` carrying `playerName`, resolved against the roster directory
 * the same request already returned. `DraftFact` has no name column, so it was
 * dropped and Draft HQ was left re-resolving a bare ESPN id against an identity
 * table holding zero ESPN rows. `EspnHistoricalBackfillService` now records those
 * names; this is the rule about which of them may be written.
 *
 * Pure on purpose. The capture itself lives at the call site, where the
 * read-then-insert against a nullable `leagueKey` is already documented; what
 * needed testing as behaviour is the filtering, because getting it wrong writes a
 * fake name into a table several surfaces trust.
 */

export type ProviderIdentityInput = {
  providerPlayerId: string
  displayName?: string | null
}

export type IngestableIdentity = {
  providerPlayerId: string
  displayName: string
}

/**
 * ⚠ A SYNTHESISED PLACEHOLDER MUST NEVER BE STORED AS A NAME.
 *
 * The ESPN roster parser fills an unnamed player with `Player <id>` so the screen
 * has something to print, and `resolveEspnPlayerSummary` reads that directory as
 * its fallback — so the placeholder arrives here looking exactly like a name, and
 * a plain truthiness check passes it.
 *
 * Storing it would invert the fix it belongs to: Draft HQ prints "Player 2577417"
 * TODAY as an openly unmapped pick, and would then print the identical text as a
 * RESOLVED name, with nothing on screen to tell the reader which it was. An
 * honest blank outranks a confident placeholder.
 */
export function isPlaceholderPlayerName(name: string, providerPlayerId: string): boolean {
  return name.trim() === `Player ${providerPlayerId}`
}

/**
 * The storable rows, in order of appearance.
 *
 * First occurrence of an id wins: a draft list is ordered, and the earliest
 * mention is as good as any when two disagree.
 */
export function selectIngestableIdentities(rows: ProviderIdentityInput[]): IngestableIdentity[] {
  const seen = new Set<string>()
  const out: IngestableIdentity[] = []

  for (const row of rows ?? []) {
    const providerPlayerId = String(row?.providerPlayerId ?? '').trim()
    if (!providerPlayerId) continue
    if (seen.has(providerPlayerId)) continue

    const displayName = String(row?.displayName ?? '').trim()
    if (!displayName) continue
    if (isPlaceholderPlayerName(displayName, providerPlayerId)) continue

    seen.add(providerPlayerId)
    out.push({ providerPlayerId, displayName })
  }

  return out
}

/**
 * ⚠ SPORT KEYS IN THIS TABLE ARE UPPERCASE, AND A LOWERCASE ONE SPLITS THE DATA.
 *
 * Measured on production: NFL 11,960 · NCAAF 39,671 · NCAAB 18,209 · MLB 7,295 —
 * every existing row uppercase. Writing `nfl` does not fail and does not read as
 * wrong; it simply creates a second sport key nobody queries, and the dedupe that
 * protects re-imports stops matching the rows it was meant to match.
 */
export function normalizeSportKey(sport: unknown): string {
  return String(sport ?? 'NFL').trim().toUpperCase() || 'NFL'
}
