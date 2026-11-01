/**
 * Tells apart leagues that would otherwise show under one name.
 *
 * A manager who owns two teams in one Fantrax league imports each team as its own copy of the league
 * (one `League` row per team — the import is keyed per team, see `importFantraxLeague`). Both copies
 * carry the league's name, so the rail and the league switcher would show the same name twice with
 * nothing to say which is which. Where that happens, the viewer's team name is appended.
 *
 * Display only: `League.name` is untouched, so a sync that rewrites the name from the provider cannot
 * strip the label, and a league shown once keeps its name exactly as it was.
 */
type Row = { name?: unknown; platform?: unknown; season?: unknown; viewerTeamName?: unknown }

const keyOf = (r: Row) =>
  `${String(r.platform ?? '').toLowerCase()}|${String(r.name ?? '').trim().toLowerCase()}|${String(r.season ?? '')}`

export function labelSameNamedLeagues<T extends Row>(rows: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    if (typeof r.name !== 'string' || !r.name.trim()) continue
    const k = keyOf(r)
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const relabel = new Map<T, string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const teams = group.map((r) => (typeof r.viewerTeamName === 'string' ? r.viewerTeamName.trim() : ''))
    // Only when the team names actually tell the copies apart; otherwise a suffix is noise.
    if (new Set(teams.filter(Boolean).map((t) => t.toLowerCase())).size < 2) continue
    group.forEach((r, i) => {
      if (teams[i]) relabel.set(r, `${String(r.name).trim()} · ${teams[i]}`)
    })
  }
  return rows.map((r) => (relabel.has(r) ? { ...r, name: relabel.get(r)! } : r))
}
