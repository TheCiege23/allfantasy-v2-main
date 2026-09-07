import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The last picks made in the drafts that are running right now.
 *
 * ── Why this is a separate, tiny loader ─────────────────────────────────────
 *
 * `getDraftHqAll` already answers "which drafts exist and what state are they
 * in" in three set-based queries. The cross-league War Room needs one thing it
 * does not carry: the tail of each LIVE draft's board. That is a fourth query,
 * and it is deliberately scoped to live sessions only — reading the pick tail
 * for sixty finished drafts to render two live ones is the fan-out this whole
 * family of loaders exists to avoid.
 *
 * ⚠ PICK-IN-ROUND IS DERIVED FROM `overall`, NOT FROM `DraftPick.slot`. `slot`
 * is the roster's draft slot, so using it collapses every column of a snake
 * draft onto one team. That mistake shipped in Draft HQ's made-pick labels once
 * and was caught only because a second, independently computed list disagreed;
 * `warRoom.ts` carries the same warning at the top of the per-league loader.
 *
 * ⚠ AND A PICK WITH NO PLAYER NAME IS RENDERED AS UNNAMED, NOT DROPPED. A gap in
 * our player resolution is our gap; dropping the row would silently shorten the
 * board and make the pick numbers skip.
 */

export type LivePick = {
  overall: number
  round: number
  pickInRound: number
  rosterId: string
  /** The drafting manager's display name, when the order names them. */
  managerName: string | null
  isYours: boolean
  playerName: string | null
  position: string | null
  /** The player's headshot, when we hold one. */
  imageUrl: string | null
  /** The player's real club, for the crest beside the face. */
  team: string | null
}

export type LiveDraftPicks = {
  /** Keyed by leagueId — the same key `DraftHqAllRow` uses. */
  byLeague: Record<string, LivePick[]>
  /** Your own queue for that league's draft, top few, keyed by leagueId. */
  queueByLeague: Record<string, Array<{ playerName: string; position: string | null }>>
}

const EMPTY: LiveDraftPicks = { byLeague: {}, queueByLeague: {} }

/** How much board tail is worth showing. The design draws three. */
const TAIL = 4

/** How many queue targets to name. */
const QUEUE_SHOWN = 5

export async function getLiveDraftPicks(
  userId: string,
  liveLeagueIds: string[],
): Promise<LiveDraftPicks> {
  if (liveLeagueIds.length === 0) return EMPTY

  const sessions = await prisma.draftSession
    .findMany({
      where: { leagueId: { in: liveLeagueIds } },
      select: { id: true, leagueId: true, slotOrder: true, teamCount: true },
    })
    .catch(() => [] as Array<{ id: string; leagueId: string; slotOrder: unknown; teamCount: number }>)

  if (sessions.length === 0) return EMPTY

  const sessionIds = sessions.map((s) => s.id)
  const leagueBySession = new Map(sessions.map((s) => [s.id, s.leagueId]))

  const [picks, myTeams, queueEntries, legacyQueues] = await Promise.all([
    /*
     * ⚠ ORDERED DESC AND TAKEN WHOLE, THEN SLICED PER SESSION IN MEMORY. Prisma
     * has no per-group limit, and `take: TAIL` on the whole set would return the
     * last four picks OVERALL — which on two concurrent drafts means one of them
     * renders an empty board. The cap is generous but bounded: live drafts are
     * rare and the tail is short.
     */
    prisma.draftPick
      .findMany({
        where: { sessionId: { in: sessionIds } },
        orderBy: { overall: 'desc' },
        take: TAIL * sessionIds.length * 3,
        select: {
          sessionId: true,
          overall: true,
          round: true,
          roundPick: true,
          rosterId: true,
          displayName: true,
          playerName: true,
          position: true,
          team: true,
          playerImageUrl: true,
          playerId: true,
        },
      })
      .catch(
        () =>
          [] as Array<{
            sessionId: string
            overall: number
            round: number
            roundPick: number | null
            rosterId: string
            displayName: string | null
            playerName: string
            position: string
            team: string | null
            playerImageUrl: string | null
            playerId: string | null
          }>,
      ),
    prisma.leagueTeam
      .findMany({
        where: { leagueId: { in: liveLeagueIds }, claimedByUserId: userId },
        select: { leagueId: true, externalId: true },
      })
      .catch(() => [] as Array<{ leagueId: string; externalId: string | null }>),
    prisma.draftQueueEntry
      .findMany({
        where: { draftSessionId: { in: sessionIds }, userId },
        orderBy: { priority: 'asc' },
        select: { draftSessionId: true, playerName: true, playerId: true },
      })
      .catch(
        () => [] as Array<{ draftSessionId: string; playerName: string | null; playerId: string }>,
      ),
    prisma.draftQueue
      .findMany({
        where: { sessionId: { in: sessionIds }, userId },
        select: { sessionId: true, order: true },
      })
      .catch(() => [] as Array<{ sessionId: string; order: unknown }>),
  ])

  const myRosterByLeague = new Map(
    myTeams
      .filter((t) => t.externalId != null)
      .map((t) => [t.leagueId, String(t.externalId)] as const),
  )

  /*
   * Headshots for the picks that do not already carry one.
   *
   * ⚠ `DraftPick` ALREADY STORES `playerImageUrl`, `team`, `position` AND
   * `displayName`. Re-reading `SportsPlayer` for every pick would be a query
   * this board does not need — so the fallback runs only for picks whose stored
   * image is null, and if that set is empty it does not run at all.
   *
   * ⚠ AND IT MATCHES ACROSS THREE ID SPACES WHEN IT DOES RUN. `DraftPick.playerId`
   * carries whichever id the drafting room had — ours, the provider's, or
   * Sleeper's — the same three-key match `myTeam.ts` and the waiver recommender
   * already do. A single-column join silently drops most of them.
   */
  const playerIds = [
    ...new Set(
      picks
        .filter((p) => !p.playerImageUrl)
        .map((p) => p.playerId)
        .filter((x): x is string => !!x),
    ),
  ]
  const players =
    playerIds.length > 0
      ? await prisma.sportsPlayer
          .findMany({
            where: {
              OR: [
                { id: { in: playerIds } },
                { externalId: { in: playerIds } },
                { sleeperId: { in: playerIds } },
              ],
            },
            select: {
              id: true,
              externalId: true,
              sleeperId: true,
              imageUrl: true,
              team: true,
              position: true,
            },
          })
          .catch(() => [])
      : []

  const byPlayerKey = new Map<
    string,
    { imageUrl: string | null; team: string | null; position: string | null }
  >()
  for (const p of players) {
    const v = { imageUrl: p.imageUrl ?? null, team: p.team ?? null, position: p.position ?? null }
    for (const k of [p.id, p.externalId, p.sleeperId]) {
      if (k) byPlayerKey.set(k, v)
    }
  }

  const byLeague: Record<string, LivePick[]> = {}

  for (const s of sessions) {
    const order = Array.isArray(s.slotOrder)
      ? (s.slotOrder as Array<{ slot?: number; rosterId?: string; displayName?: string }>)
      : []
    const teams = order.length > 0 ? order.length : s.teamCount || 12
    const nameByRoster = new Map(
      order
        .filter((o) => o.rosterId != null)
        .map((o) => [String(o.rosterId), (o.displayName ?? '').trim() || null] as const),
    )
    const mine = myRosterByLeague.get(s.leagueId) ?? null

    const rows = picks
      .filter((p) => p.sessionId === s.id)
      .sort((a, b) => b.overall - a.overall)
      .slice(0, TAIL)
      .reverse()
      .map((p): LivePick => {
        const meta = p.playerId ? byPlayerKey.get(p.playerId) : undefined
        return {
          overall: p.overall,
          round: p.round || Math.floor((p.overall - 1) / teams) + 1,
          /*
           * ⚠ FROM `overall`, NOT FROM `slot`. See the file header — `slot` is
           * the roster's draft slot and collapses a snake draft's columns.
           * `roundPick` is used when the writer stored it, since that is the
           * same derivation done once at write time.
           */
          pickInRound: p.roundPick ?? ((p.overall - 1) % teams) + 1,
          rosterId: String(p.rosterId),
          managerName:
            p.displayName?.trim() || nameByRoster.get(String(p.rosterId)) || null,
          isYours: mine != null && String(p.rosterId) === mine,
          playerName: p.playerName?.trim() || null,
          position: p.position?.trim() || meta?.position || null,
          imageUrl: p.playerImageUrl?.trim() || meta?.imageUrl || null,
          team: p.team?.trim() || meta?.team || null,
        }
      })

    if (rows.length > 0) byLeague[s.leagueId] = rows
  }

  /*
   * The caller's queue for each live draft. Both tables are read for the reason
   * the schema states on `DraftQueueEntry` — it "coexists" with the older JSON
   * `DraftQueue`, so reading one reports an empty queue for half the drafts.
   */
  const queueByLeague: Record<string, Array<{ playerName: string; position: string | null }>> = {}

  for (const e of queueEntries) {
    const leagueId = leagueBySession.get(e.draftSessionId)
    if (!leagueId) continue
    const name = e.playerName?.trim()
    if (!name) continue
    const list = (queueByLeague[leagueId] ??= [])
    if (list.length < QUEUE_SHOWN) list.push({ playerName: name, position: null })
  }

  for (const q of legacyQueues) {
    const leagueId = leagueBySession.get(q.sessionId)
    if (!leagueId || queueByLeague[leagueId]?.length) continue
    const arr = Array.isArray(q.order)
      ? (q.order as Array<{ playerName?: string; position?: string }>)
      : []
    const list = arr
      .map((x) => ({
        playerName: String(x?.playerName ?? '').trim(),
        position: x?.position ? String(x.position) : null,
      }))
      .filter((x) => x.playerName.length > 0)
      .slice(0, QUEUE_SHOWN)
    if (list.length > 0) queueByLeague[leagueId] = list
  }

  return { byLeague, queueByLeague }
}
