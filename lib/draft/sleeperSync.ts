import { prisma } from '@/lib/prisma'
import {
  buildSleeperTeamNumberToRosterIdMap,
  rosterImportedName,
  slotOrderHasMissingRosters,
  type MirrorRosterRow,
} from '@/lib/draft/sleeperMirrorRosterIds'

/**
 * This draft's league rosters, read before the transaction so the order can be seated by `Roster.id`.
 * Never a reason for the mirror to fail: on any error the order is built exactly as it was before.
 */
async function loadLeagueRostersForSession(internalDraftId: string): Promise<MirrorRosterRow[]> {
  try {
    const session = await prisma.draftSession.findUnique({ where: { id: internalDraftId }, select: { leagueId: true } })
    if (!session?.leagueId) return []
    const rows = await prisma.roster.findMany({
      where: { leagueId: session.leagueId },
      select: { id: true, platformUserId: true, playerData: true },
    })
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

type SleeperDraft = {
  draft_id?: string
  league_id?: string
  status?: string
  /** `snake` | `linear` | `auction`. */
  type?: string
  /**
   * The draft ORDER, and the reason a pre-draft board was empty.
   *
   * 🛑 BOTH OF THESE WERE IN THE RESPONSE THIS FILE ALREADY FETCHES AND NEITHER WAS READ.
   * `mirrorActiveSleeperDrafts` includes `pre_draft` in its pollable statuses on purpose,
   * and says why: "that is when the draft ORDER appears, and a board that only wakes up
   * once picks start misses the thing managers check most in the days before." But the
   * order arrives in these two fields, the mirror never looked at them, and in `pre_draft`
   * there are zero picks — so the board it polls for was blank until the first pick landed.
   *
   *   draft_order        { user_id: slot }   who drafts in which slot
   *   slot_to_roster_id  { slot: roster_id } which roster that slot belongs to
   *
   * Sleeper leaves `draft_order` null until the commissioner sets it, which is handled
   * below rather than assumed away.
   */
  draft_order?: Record<string, number> | null
  slot_to_roster_id?: Record<string, number> | null
  settings?: {
    rounds?: number
    teams?: number
    pick_timer?: number
    /** Round at which a snake reverses a second time. 3 is third-round reversal. */
    reversal_round?: number
  }
}

/** One row of `DraftSession.slotOrder`, whose documented shape this must match exactly. */
type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }

/**
 * Map Sleeper's draft type onto ours.
 *
 * Unknown values fall back to `snake` rather than being written through: `draftType` drives
 * board rendering and pick-order maths, and an unrecognised string there would render nothing
 * rather than render wrongly — but it would do it silently, on a live draft.
 */
function mapSleeperDraftType(raw: string | undefined): string {
  const t = (raw ?? '').toLowerCase().trim()
  if (t === 'auction') return 'auction'
  if (t === 'linear') return 'linear'
  return 'snake'
}

/**
 * Build the draft order from the two Sleeper maps plus the users this file already fetched.
 *
 * ⚠ COSTS NO EXTRA PROVIDER CALL. `usersById` is already built above for pick attribution,
 * and both order maps ride on the `/draft/{id}` response that has already been read. The
 * whole of this was available for free and was being thrown away.
 *
 * Returns an empty array when Sleeper has not published an order yet, which the caller
 * treats as "leave what is there" rather than "the order is empty" — see its note.
 */
function buildSlotOrder(
  draft: SleeperDraft,
  usersById: Record<string, { display_name?: string }>,
  /** Sleeper roster number -> our `Roster.id`, from the import. Unmapped numbers are written as-is. */
  rosterIdForTeamNumber: Map<string, string> = new Map(),
  /** Manager name the import stored per `Roster.id`, for slots Sleeper has not named yet. */
  importedNameByRosterId: Map<string, string> = new Map(),
): SlotOrderEntry[] {
  const slotToRoster = draft.slot_to_roster_id
  if (!slotToRoster || typeof slotToRoster !== 'object') return []

  /* `draft_order` is keyed BY USER, so it has to be inverted to answer "who is in slot N".
     It is also null until the commissioner sets the order, in which case slots still have
     rosters and simply have no name attached yet. */
  const userBySlot = new Map<number, string>()
  const order = draft.draft_order
  if (order && typeof order === 'object') {
    for (const [userId, slot] of Object.entries(order)) {
      const n = Number(slot)
      if (Number.isInteger(n) && n > 0) userBySlot.set(n, String(userId))
    }
  }

  const entries: SlotOrderEntry[] = []
  for (const [slotKey, rosterId] of Object.entries(slotToRoster)) {
    const slot = Number(slotKey)
    if (!Number.isInteger(slot) || slot < 1) continue
    if (rosterId == null) continue
    const userId = userBySlot.get(slot)
    /* 🛑 A slot's rosterId must be a `Roster.id`: the board, "my team" and the pick authority all
       compare against it. Sleeper's `roster_id` is its own 1..N number, which matches no roster
       here, so it is translated through the import's `sourceTeamId` and only written raw when the
       league has no such roster. */
    const ourRosterId = rosterIdForTeamNumber.get(String(rosterId)) ?? String(rosterId)
    entries.push({
      slot,
      rosterId: ourRosterId,
      /* Empty rather than a placeholder like "Team 4": the board can render a real absence,
         and a fabricated name is indistinguishable from a manager who chose that name. */
      displayName:
        (userId ? usersById[userId]?.display_name : undefined) ?? importedNameByRosterId.get(ourRosterId) ?? '',
    })
  }
  return entries.sort((a, b) => a.slot - b.slot)
}

type SleeperPick = {
  pick_no?: number
  round?: number
  draft_slot?: number
  player_id?: string
  picked_by?: string
  metadata?: {
    first_name?: string
    last_name?: string
    position?: string
    team?: string
  }
}

function mapSleeperStatus(s: string | undefined): string {
  const u = (s ?? '').toLowerCase()
  if (u === 'complete' || u === 'completed') return 'completed'
  if (u === 'drafting' || u === 'in_progress') return 'in_progress'
  if (u === 'paused') return 'paused'
  return 'pre_draft'
}

/**
 * Pull latest draft + picks from Sleeper and mirror into `DraftSession` / `DraftPick`.
 * Does not replace `draftRoomStateRow` (mock/live UI engine) — use for AF analytics + draft room v2.
 */
export async function syncDraftFromSleeper(sleeperDraftId: string, internalDraftId: string): Promise<void> {
  const base = `https://api.sleeper.app/v1/draft/${encodeURIComponent(sleeperDraftId)}`
  const [dRes, pRes] = await Promise.all([
    fetch(base, { cache: 'no-store' }),
    fetch(`${base}/picks`, { cache: 'no-store' }),
  ])

  if (!dRes.ok) {
    throw new Error(`Sleeper draft fetch failed: ${dRes.status}`)
  }

  /*
   * ⚠ FAIL CLOSED ON THE PICKS FETCH. This used to read
   * `pRes.ok ? await pRes.json() : []`, so a 500 on /picks while /draft returned 200
   * produced an EMPTY pick list -- which then flowed into the deleteMany below and wiped
   * every mirrored pick off the board. On a one-minute mirror during a live draft that is
   * not a hypothetical: one upstream blip blanks the board mid-draft.
   *
   * Throwing instead means the mirror skips this tick and the last good board stands.
   * Stale by a minute beats empty.
   */
  if (!pRes.ok) {
    throw new Error(`Sleeper draft picks fetch failed: ${pRes.status}`)
  }

  const draft = (await dRes.json()) as SleeperDraft
  const picksRaw = (await pRes.json()) as SleeperPick[]
  if (!Array.isArray(picksRaw)) {
    throw new Error('Sleeper draft picks payload was not an array')
  }
  const picks = picksRaw

  const leagueIdSleeper = draft.league_id != null ? String(draft.league_id) : null
  let usersById: Record<string, { display_name?: string }> = {}
  if (leagueIdSleeper) {
    const uRes = await fetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(leagueIdSleeper)}/users`, {
      cache: 'no-store',
    })
    if (uRes.ok) {
      const arr = (await uRes.json()) as { user_id?: string; display_name?: string }[]
      if (Array.isArray(arr)) {
        for (const u of arr) {
          if (u.user_id) usersById[String(u.user_id)] = { display_name: u.display_name }
        }
      }
    }
  }

  const settings = draft.settings ?? {}
  const rounds = typeof settings.rounds === 'number' ? settings.rounds : 15
  const teams = typeof settings.teams === 'number' ? settings.teams : 12
  const timer = typeof settings.pick_timer === 'number' ? settings.pick_timer : 120

  const leagueRosters = await loadLeagueRostersForSession(internalDraftId)
  const rosterIdSet = new Set(leagueRosters.map((r) => r.id))
  const importedNameByRosterId = new Map<string, string>()
  for (const r of leagueRosters) {
    const n = rosterImportedName(r)
    if (n) importedNameByRosterId.set(r.id, n)
  }
  const slotOrder = buildSlotOrder(
    draft,
    usersById,
    buildSleeperTeamNumberToRosterIdMap(leagueRosters),
    importedNameByRosterId,
  )
  const slotOrderFullyResolved = slotOrder.length > 0 && slotOrder.every((e) => rosterIdSet.has(e.rosterId))
  /* 3 is Sleeper's third-round reversal. Absent/0 means a plain snake. */
  const thirdRoundReversal = settings.reversal_round === 3

  const synced = await prisma.$transaction(async (tx) => {
    /*
     * 🛑 THE MIRROR SEEDS THE ORDER. IT NEVER FIGHTS A HUMAN FOR IT.
     *
     * Two other writers put an order on this same row, and both key on `leagueId`, which is
     * `@unique` — so they are the row this function updates by `id`:
     *   /api/leagues/[id]/draft/lottery/run   (finalize) — a weighted lottery result
     *   /api/leagues/[id]/draft/order         (POST)     — a commissioner setting it by hand
     * BOTH refuse unless `status === 'pre_draft'`, which is exactly the window this mirror
     * polls once a minute. Writing unconditionally would replace a commissioner's lottery
     * result within 60 seconds, with no error, no marker and nothing in any log.
     *
     * So: write only into an empty order. `slotOrder` is `Json @default("[]")`, so "nobody has
     * set one" is a genuinely empty array rather than null.
     *
     * ⚠ THE COST, STATED RATHER THAN HIDDEN: if Sleeper's order changes after we have seeded
     * it, we keep the first one. Closing that needs provenance — a column recording who wrote
     * the order — and a column is a migration, which is not this change. Comparing roster-id
     * sets was considered as a cheap substitute and rejected: it tracks a Sleeper re-randomise
     * correctly but still clobbers the hand-set order, which is the most deliberate act of the
     * three.
     *
     * ⚠ AND AN EMPTY ORDER NEVER OVERWRITES A GOOD ONE EITHER, for the reason the picks fetch
     * above fails closed rather than writing `[]`: Sleeper leaves `draft_order` null until the
     * commissioner sets it and can answer without `slot_to_roster_id`. Both guards are in the
     * one condition — write only a non-empty order, and only over an empty one.
     */
    const existing = await tx.draftSession.findUnique({
      where: { id: internalDraftId },
      select: { slotOrder: true },
    })
    const existingOrder = existing?.slotOrder
    const hasLocalOrder = Array.isArray(existingOrder) && existingOrder.length > 0
    /*
     * ⚠ ONE EXCEPTION: AN ORDER THAT SEATS ROSTERS THIS LEAGUE NO LONGER HAS IS NOT A HUMAN'S
     * CHOICE, IT IS DEBRIS. A re-import deletes and recreates every roster, and an order saved
     * before it keeps the dead ids forever — measured 2026-11-17 on every mirrored KBI draft:
     * 16 of 16 ids gone, every header "Unknown". No commissioner or lottery result survives a
     * re-import either (their ids died too), so replacing it protects nothing. It is replaced
     * only by an order whose every seat is a live roster here, never by another broken one.
     */
    const staleLocalOrder = hasLocalOrder && slotOrderHasMissingRosters(existingOrder, rosterIdSet)
    const slotOrderPatch =
      slotOrder.length > 0 && (!hasLocalOrder || (staleLocalOrder && slotOrderFullyResolved)) ? { slotOrder } : {}

    const session = await tx.draftSession.update({
      where: { id: internalDraftId },
      data: {
        sleeperDraftId,
        status: mapSleeperStatus(draft.status),
        /*
         * ⚠ THESE TWO DO OVERWRITE A LOCAL SETTING, DELIBERATELY, UNLIKE slotOrder ABOVE.
         * `/draft/settings` lets a commissioner toggle `thirdRoundReversal` here — but this
         * draft is happening on Sleeper, so a local toggle cannot change how it actually runs;
         * it only makes our pick-order maths (the trade builder's pick inventory, autopick's
         * owner resolution) disagree with the real board. An upstream FACT wins over a local
         * preference about that fact. A lottery result is not a fact about Sleeper's draft —
         * it is an independent artifact a human made here, which is why it is protected and
         * these are not. This is also what the function has always done with `rounds`,
         * `teamCount`, `timerSeconds` and `status`, every one of which is equally a "setting".
         */
        draftType: mapSleeperDraftType(draft.type),
        thirdRoundReversal,
        ...slotOrderPatch,
        rounds,
        teamCount: teams,
        timerSeconds: timer,
        nextOverallPick: picks.length > 0 ? Math.max(...picks.map((p) => Number(p.pick_no) || 0)) + 1 : 1,
        currentRoundNum:
          picks.length > 0
            ? Math.max(...picks.map((p) => (typeof p.round === 'number' ? p.round : 0)))
            : 1,
      },
    })

    // Read what was on the board BEFORE the rewrite, so the picks that are new this sync can be announced.
    const before = await tx.draftPick.findMany({ where: { sessionId: session.id }, select: { overall: true, playerId: true } })

    await tx.draftPick.deleteMany({ where: { sessionId: session.id } })

    const rows = picks
      .map((p) => {
        const overall = typeof p.pick_no === 'number' ? p.pick_no : 0
        if (overall < 1) return null
        const meta = p.metadata ?? {}
        const first = meta.first_name ?? ''
        const last = meta.last_name ?? ''
        const playerName = `${first} ${last}`.trim() || (p.player_id ? `Player ${p.player_id}` : 'Unknown')
        const slot = typeof p.draft_slot === 'number' ? p.draft_slot : 1
        const pickedBy = p.picked_by != null ? String(p.picked_by) : null
        return {
          sessionId: session.id,
          overall,
          round: typeof p.round === 'number' ? p.round : 1,
          slot,
          roundPick: ((overall - 1) % teams) + 1,
          /*
           * ⚠ THIS IS A SLEEPER USER ID, IN A COLUMN NAMED rosterId. `picked_by` identifies
           * the USER who made the pick, not the roster. The column and its
           * [sessionId, rosterId] index are named for a roster, so anything grouping by it
           * is grouping by user. Left as-is because changing the id space here would
           * silently break every existing consumer -- flagged so the next reader does not
           * assume the name.
           */
          rosterId: pickedBy ?? `slot-${slot}`,
          displayName: pickedBy ? usersById[pickedBy]?.display_name ?? pickedBy : null,
          playerName,
          position: typeof meta.position === 'string' ? meta.position : '—',
          team: typeof meta.team === 'string' ? meta.team : null,
          playerId: p.player_id != null ? String(p.player_id) : null,
          /** Mirrored from an external draft — we did not make this pick. */
          source: 'sleeper-mirror',
          /*
           * ⚠ NULL, NOT `new Date()`. Sleeper's pick payload carries no timestamp, so the
           * previous code stamped every pick with the sync time and REWROTE it on each
           * poll. "When was this pick made" then answered "just now" forever, and any
           * pick-duration reading was fiction. An unknown time is recorded as unknown.
           */
          pickedAt: null,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // One statement instead of N sequential inserts inside the transaction: a 15x12 draft
    // was 180 round-trips holding the transaction open.
    if (rows.length > 0) {
      await tx.draftPick.createMany({ data: rows, skipDuplicates: true })
    }
    return { leagueId: session.leagueId, sessionId: session.id, status: session.status, teams, before, rows }
  })

  await announceNewMirroredPicks(synced).catch((err) => {
    console.warn('[sleeperSync] pick chat announce failed (non-fatal)', err instanceof Error ? err.message : String(err))
  })
}

type MirroredPickRow = {
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string | null
  playerName: string
  position: string
  team: string | null
  playerId: string | null
}

/**
 * Which mirrored picks get a chat card this sync: the ones whose seat was empty (or held a different
 * player) before the rewrite. Returns [] when the gap is bigger than one round — that is a first mirror
 * of a draft already under way, or a long outage catching up, and a wall of 100 cards helps nobody.
 */
export function selectNewMirroredPicks<R extends { overall: number; playerId: string | null }>(input: {
  status: string
  teams: number
  before: Array<{ overall: number; playerId: string | null }>
  rows: R[]
}): R[] {
  if (input.status !== 'in_progress') return []
  const prior = new Map(input.before.map((p) => [p.overall, p.playerId ?? null]))
  const fresh = input.rows.filter((r) => !prior.has(r.overall) || prior.get(r.overall) !== (r.playerId ?? null))
  if (fresh.length > Math.max(1, input.teams)) return []
  return fresh.sort((a, b) => a.overall - b.overall)
}

/**
 * Picks made on Sleeper never pass through `submitPick`, so they never posted the draft-chat pick card
 * every other pick gets. Post it here for the picks that are new this sync. The card is keyed on the
 * session + seat + player, so a re-sync — this runs every minute and rewrites every row — cannot post
 * the same pick twice.
 */
async function announceNewMirroredPicks(synced: {
  leagueId: string
  sessionId: string
  status: string
  teams: number
  before: Array<{ overall: number; playerId: string | null }>
  rows: MirroredPickRow[]
}): Promise<void> {
  const fresh = selectNewMirroredPicks(synced)
  if (fresh.length === 0) return
  const [{ postDraftPickChatEvent }, { buildSleeperUserToRosterIdMap }, league, rosters] = await Promise.all([
    import('@/lib/draft-room/postDraftPickChatEvent'),
    import('@/lib/draft/sleeperMirrorRosterIds'),
    prisma.league.findUnique({ where: { id: synced.leagueId }, select: { sport: true } }),
    prisma.roster.findMany({ where: { leagueId: synced.leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
  ])
  const toRosterId = buildSleeperUserToRosterIdMap(rosters)
  const nfl = String(league?.sport ?? '').toUpperCase() === 'NFL'
  for (const p of fresh) {
    const rosterId = toRosterId.get(p.rosterId) ?? p.rosterId
    const roundSlot = ((p.overall - 1) % Math.max(1, synced.teams)) + 1
    await postDraftPickChatEvent({
      leagueId: synced.leagueId,
      rosterId,
      madeByUserId: null,
      playerName: p.playerName,
      position: p.position,
      rosterDisplayName: p.displayName?.trim() || 'Team',
      overall: p.overall,
      pickLabel: `${p.round}.${String(roundSlot).padStart(2, '0')}`,
      round: p.round,
      roundSlot,
      playerId: p.playerId,
      nflTeam: p.team,
      headshotUrl: nfl && p.playerId ? `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(p.playerId)}.jpg` : null,
      idempotencyKey: `draft-pick-mirror:${synced.sessionId}:${p.overall}:${p.playerId ?? p.playerName}`,
    }).catch(() => {})
  }
}
