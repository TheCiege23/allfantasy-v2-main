import { prisma } from '@/lib/prisma'

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
    entries.push({
      slot,
      rosterId: String(rosterId),
      /* Empty rather than a placeholder like "Team 4": the board can render a real absence,
         and a fabricated name is indistinguishable from a manager who chose that name. */
      displayName: (userId ? usersById[userId]?.display_name : undefined) ?? '',
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

  const slotOrder = buildSlotOrder(draft, usersById)
  /*
   * ⚠ AN EMPTY ORDER NEVER OVERWRITES A GOOD ONE, for exactly the reason the picks fetch
   * above fails closed rather than writing `[]`. Sleeper leaves `draft_order` null until the
   * commissioner sets it, and can briefly answer without `slot_to_roster_id`; writing the
   * empty result would blank the order on a board someone is watching, once a minute, and
   * look like the mirror working. Stale beats empty here too.
   */
  const slotOrderPatch = slotOrder.length > 0 ? { slotOrder } : {}
  /* 3 is Sleeper's third-round reversal. Absent/0 means a plain snake. */
  const thirdRoundReversal = settings.reversal_round === 3

  await prisma.$transaction(async (tx) => {
    const session = await tx.draftSession.update({
      where: { id: internalDraftId },
      data: {
        sleeperDraftId,
        status: mapSleeperStatus(draft.status),
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
  })
}
