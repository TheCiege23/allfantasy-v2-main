/**
 * Which Fantrax (college) team belongs to which Sleeper (pro) team, so combined scoring can be head to
 * head: your NFL + college points against your opponent's NFL + college points.
 *
 * The two platforms name teams differently. Measured on Peach Bowl / Cream Bowl (2026-11-21):
 * "Scoresscotty" / "Scorescotty", "loganhall17" / "loganhall", "KingGustov" / "king gustov",
 * "JMasc" / "Team JMasc", "TheCiege24" / "Ciege82".
 *
 * ⚠ AUTOMATIC WHEN UNAMBIGUOUS, THE COMMISSIONER STILL DECIDES. Owner direction 2026-11-22: a paired
 * league must feel like one league with no setup step. So `confidentTeamMatches` applies a pair on its
 * own only when it is each side's single best candidate and nothing else competes for either side —
 * a wrong guess would put one manager's college points on another manager's score. Anything weaker
 * stays a suggestion, and whatever the commissioner saved always wins (`effectiveTeamMap`).
 *
 * Pure.
 */

export type SleeperTeam = { rosterId: string; teamName: string | null; ownerName: string | null }
export type FantraxTeam = { teamId: string; name: string }

/** Lowercase letters and digits only, with a leading "team" and trailing digits dropped. */
export function teamKey(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
    .replace(/^team/, '')
    .replace(/\d+$/, '')
}

/** Edit distance, bounded: anything over `max` returns max + 1. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j]!)
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]!
}

/** 0 (no match) to 3 (same key). The best of the team name and the manager name. */
function score(s: SleeperTeam, f: FantraxTeam): number {
  const fk = teamKey(f.name)
  if (fk.length < 3) return 0
  let best = 0
  for (const name of [s.teamName, s.ownerName]) {
    const k = teamKey(name)
    if (k.length < 3) continue
    if (k === fk) best = Math.max(best, 3)
    else if (distance(k, fk, 2) <= 2) best = Math.max(best, 2)
    else if (k.length >= 5 && fk.length >= 5 && (k.includes(fk) || fk.includes(k))) best = Math.max(best, 1)
  }
  return best
}

/**
 * Suggested Sleeper roster id -> Fantrax team id, one to one. Strongest matches are taken first, and
 * a Fantrax team is never suggested twice. `known` pairs (the viewer's own two teams, from the
 * franchise link) are fixed before any name is compared.
 */
export function suggestTeamMatches(
  sleeper: readonly SleeperTeam[],
  fantrax: readonly FantraxTeam[],
  known: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  const usedF = new Set<string>()
  for (const [rosterId, teamId] of Object.entries(known)) {
    if (sleeper.some((s) => s.rosterId === rosterId) && fantrax.some((f) => f.teamId === teamId)) {
      out[rosterId] = teamId
      usedF.add(teamId)
    }
  }
  const candidates: Array<{ rosterId: string; teamId: string; score: number }> = []
  for (const s of sleeper) {
    if (out[s.rosterId]) continue
    for (const f of fantrax) {
      if (usedF.has(f.teamId)) continue
      const sc = score(s, f)
      if (sc > 0) candidates.push({ rosterId: s.rosterId, teamId: f.teamId, score: sc })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  for (const c of candidates) {
    if (out[c.rosterId] || usedF.has(c.teamId)) continue
    out[c.rosterId] = c.teamId
    usedF.add(c.teamId)
  }
  return out
}

/**
 * The suggestions that are safe to apply without anyone confirming them: each pair is the single best
 * candidate for BOTH of its teams, and no other team ties it from either side. `known` pairs (the
 * linker's own two teams) are fixed first, exactly as in `suggestTeamMatches`.
 */
export function confidentTeamMatches(
  sleeper: readonly SleeperTeam[],
  fantrax: readonly FantraxTeam[],
  known: Record<string, string> = {},
): Record<string, string> {
  const suggested = suggestTeamMatches(sleeper, fantrax, known)
  const out: Record<string, string> = {}
  for (const [rosterId, teamId] of Object.entries(known)) if (suggested[rosterId] === teamId) out[rosterId] = teamId
  const knownF = new Set(Object.values(out))
  const free = (s: SleeperTeam) => !(s.rosterId in out)
  for (const [rosterId, teamId] of Object.entries(suggested)) {
    if (rosterId in out) continue
    const s = sleeper.find((x) => x.rosterId === rosterId)
    const f = fantrax.find((x) => x.teamId === teamId)
    if (!s || !f) continue
    const mine = score(s, f)
    if (mine === 0) continue
    // No other Fantrax team scores as well for this Sleeper team...
    const rivalsForS = fantrax.filter((o) => o.teamId !== teamId && !knownF.has(o.teamId) && score(s, o) >= mine)
    // ...and no other Sleeper team scores as well for this Fantrax team.
    const rivalsForF = sleeper.filter((o) => o.rosterId !== rosterId && free(o) && score(o, f) >= mine)
    if (rivalsForS.length === 0 && rivalsForF.length === 0) out[rosterId] = teamId
  }
  return out
}

/**
 * The map that is actually used: the commissioner's saved choices, then every confident automatic
 * match that does not collide with one. A saved choice always wins, for either team in the pair.
 */
export function effectiveTeamMap(saved: Record<string, string>, confident: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...saved }
  const usedF = new Set(Object.values(saved))
  for (const [rosterId, teamId] of Object.entries(confident)) {
    if (rosterId in out || usedF.has(teamId)) continue
    out[rosterId] = teamId
    usedF.add(teamId)
  }
  return out
}

/** A saved map, cleaned: string keys and values only, one Fantrax team per Sleeper team, no duplicates. */
export function readTeamMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  const used = new Set<string>()
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v.trim() || used.has(v)) continue
    out[k] = v
    used.add(v)
  }
  return out
}

/**
 * The Fantrax scoring period that belongs to an NFL week window: the one whose middle falls inside it.
 * Cream Bowl's periods run Tuesday noon to Tuesday noon Eastern, aligned with the NFL week.
 */
export function fantraxPeriodForWindow(
  periods: ReadonlyArray<{ number: number; startDate?: string | null; endDate?: string | null }>,
  window: { start: number; end: number },
): number | null {
  for (const p of periods) {
    const s = Date.parse(String(p.startDate ?? ''))
    const e = Date.parse(String(p.endDate ?? ''))
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue
    const mid = (s + e) / 2
    if (mid >= window.start && mid < window.end) return p.number
  }
  return null
}
