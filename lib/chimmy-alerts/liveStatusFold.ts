/**
 * When a live designation was FIRST seen.
 *
 * The game-window fold in app/api/cron/alert-sweep re-writes every urgent
 * Sleeper status every five minutes. `fetchedAt` therefore always says "just
 * now", and until 2026-09-06 the row carried no `date` at all — so nothing
 * downstream could tell an Out ruled on Friday from a scratch announced ninety
 * minutes before kickoff, which is the one fact a game-day manager needs
 * (lib/core-app/pregameInactive.ts). The fold now keeps the instant it first
 * saw the current word and resets it only when the word changes: Doubtful on
 * Saturday, Out at 11:32a on Sunday is two claims, and the second one's time
 * is the inactive announcement. Pure.
 */
export function liveFirstSeen(
  existing: { status: string | null; date: Date | null } | null | undefined,
  status: string,
  now: Date,
): Date {
  if (!existing?.date) return now
  const same = (existing.status ?? '').trim().toLowerCase() === status.trim().toLowerCase()
  return same ? existing.date : now
}

/** The `SportsPlayer` columns the fold reads to name a Sleeper id. */
export type SleeperIdentityRow = {
  externalId: string
  sleeperId: string | null
  source: string
  name: string | null
  team: string | null
  position: string | null
}

export type LiveFoldRow = {
  sleeperId: string
  status: string
  name: string
  team: string | null
  position: string | null
}

/**
 * The player a Sleeper id names, or nothing.
 *
 * 🛑 A SLEEPER ID IS NEVER LOOKED UP AS A BARE `SportsPlayer.externalId`. That
 * column holds each provider's OWN id, and Rolling Insights' ids are short
 * integers in the same range as Sleeper's — RI 8394 is Rome Odunze, Sleeper 8394
 * is Percy Butler. Until 2026-10-11 the fold matched on `externalId`, so Sleeper
 * marking Butler Out wrote "Rome Odunze · Out", and every live row on file (50 of
 * 50, measured) carried somebody else's name: Lamar Jackson's Out was filed under
 * Amani Hooker. Users were told healthy starters were out while the real outs
 * went unflagged.
 *
 * A row speaks for Sleeper id S only when it says so: `sleeperId === S`, or it is
 * Sleeper's own row (`externalId === 'sleeper:S'`) — the same rule
 * `lib/decision-os/world/port.ts` reads by. Sleeper's own row wins. Without one,
 * the other providers' rows must agree on the name; if they disagree the id is
 * left unnamed, because a row the read port binds by a wrong name is worse than
 * no row. Rows are taken in the order given, so pass them newest first. Pure.
 */
export function sleeperIdentities(
  sleeperIds: Iterable<string>,
  rows: SleeperIdentityRow[],
): Map<string, Omit<LiveFoldRow, 'sleeperId' | 'status'>> {
  const wanted = new Set(sleeperIds)
  const candidates = new Map<string, SleeperIdentityRow[]>()
  for (const r of rows) {
    if (!r.name?.trim()) continue
    const own = r.externalId.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null
    for (const id of new Set([r.sleeperId, own])) {
      if (!id || !wanted.has(id)) continue
      const list = candidates.get(id) ?? []
      list.push(r)
      candidates.set(id, list)
    }
  }

  const out = new Map<string, Omit<LiveFoldRow, 'sleeperId' | 'status'>>()
  for (const [id, list] of candidates) {
    const sleeperOwn = list.find((r) => r.source === 'sleeper' || r.externalId === `sleeper:${id}`)
    let pick = sleeperOwn
    if (!pick) {
      const names = new Set(list.map((r) => r.name!.trim().toLowerCase()))
      if (names.size !== 1) continue
      pick = list[0]
    }
    out.set(id, { name: pick.name!.trim(), team: pick.team, position: pick.position })
  }
  return out
}

/**
 * Which of Sleeper's statuses the fold writes this pass.
 *
 * Out/Doubtful only, named per `sleeperIdentities`, and at most `max` rows. The
 * cap is applied AFTER naming and puts players with a team first: the blob iterates
 * in ascending id order, so capping first spent the budget on the oldest ids —
 * long-retired players still carrying a stale "Out" — ahead of anyone in a lineup
 * this week. Pure.
 */
export function planLiveFold(
  statuses: Iterable<[string, string]>,
  identities: Map<string, Omit<LiveFoldRow, 'sleeperId' | 'status'>>,
  urgentStatuses: ReadonlySet<string>,
  max: number,
): LiveFoldRow[] {
  const rows: LiveFoldRow[] = []
  for (const [sleeperId, raw] of statuses) {
    const status = raw.trim()
    if (!urgentStatuses.has(status.toLowerCase())) continue
    const who = identities.get(sleeperId)
    if (!who) continue
    rows.push({ sleeperId, status, ...who })
  }
  const withTeam = rows.filter((r) => Boolean(r.team?.trim()))
  const without = rows.filter((r) => !r.team?.trim())
  return [...withTeam, ...without].slice(0, max)
}
