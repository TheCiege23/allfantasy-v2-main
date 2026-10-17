/**
 * Telling apart leagues that share a name. PURE, no imports — safe from client and server alike.
 *
 * Moved here from components/core-app/league-tile/leagueTileModel.ts (which re-exports both names,
 * so its callers are unchanged) when Chimmy's cross-league tools needed the same rule: no file in
 * lib/ imports from components/, and a second copy of the rule would drift.
 *
 * ⚠ THE NAMING-COLLISION BUG, AND THE DECISION BEHIND `resolveTileName`.
 *
 * The handoff cites a real production screenshot: six leagues all truncating to
 * "Guillotine Leagu…", indistinguishable from one another. It offered two fixes
 * and recommended the first — a user-set nickname — with the second (auto-append
 * buy-in or league id) as the alternative, and flagged the choice as pending a
 * product call.
 *
 * What ships here is the recommended fix WITH the alternative as its automatic
 * fallback, because the two are not exclusive and shipping only the nickname
 * would leave the bug live for every user who has not set one — which is all of
 * them on day one. So: nickname when set; otherwise disambiguate with a short id
 * suffix, but ONLY when this name genuinely collides with another in the
 * same list. A suffix on a unique name is noise.
 *
 * The nickname field itself is still the open product decision — nothing writes
 * one yet, so `nickname` is read-only here.
 *
 * ⚠ MEASURED 2026-09-28: the `LeagueTile` that renders this is used only by
 * app/dev/handoff-preview, so users do not see the suffix on any league screen yet.
 * Chimmy's cross-league tools (via `withDistinctLeagueNames`) are its first
 * production use.
 *
 * `collidingNames` is the set of names appearing more than once in the list
 * being rendered — the caller computes it once per list, not once per item.
 */
export function resolveTileName(
  model: { id: string; name: string; nickname?: string | null },
  collidingNames?: ReadonlySet<string>,
): { text: string; disambiguated: boolean } {
  const nickname = model.nickname?.trim()
  if (nickname) return { text: nickname, disambiguated: false }
  if (collidingNames?.has(model.name)) {
    // Last four of the id. Enough to separate six leagues; short enough that it
    // does not eat the name it is attached to.
    return { text: `${model.name} · ${model.id.slice(-4)}`, disambiguated: true }
  }
  return { text: model.name, disambiguated: false }
}

/** Names appearing more than once — the input to `resolveTileName`. */
export function findCollidingNames(
  models: ReadonlyArray<{ name: string; nickname?: string | null }>,
): Set<string> {
  const seen = new Map<string, number>()
  for (const m of models) {
    if (m.nickname?.trim()) continue
    seen.set(m.name, (seen.get(m.name) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const [name, count] of seen) if (count > 1) out.add(name)
  return out
}

/**
 * The rule above applied to a whole picker at once: league id → the label that picker shows.
 *
 * For a list rendered as a flat set of names — the comms drawer's scope `<select>`, the /core
 * rail and its header switcher, the scope switcher, the Player Finder's league pick. Collisions
 * are computed ONCE over exactly the `leagues` passed in, which must be the list the picker
 * shows, so a name that collides elsewhere but not here stays clean.
 *
 * ⚠ MEASURED 2026-09-28 on a real account: six picker entries read identically — two
 * "…'s 8-Team NFL Redraft League (manual)" and four "…'s 12-Team NFL Redraft League (manual)".
 * No second rule: this only calls `findCollidingNames` and `resolveTileName`.
 */
export function distinctLeagueLabels(
  leagues: ReadonlyArray<{ id: string; name: string; nickname?: string | null }>,
): Map<string, string> {
  const colliding = findCollidingNames(leagues)
  const out = new Map<string, string>()
  for (const l of leagues) out.set(l.id, resolveTileName(l, colliding).text)
  return out
}
