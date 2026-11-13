/**
 * Draft HQ as a dynasty draft room — the pure half (data in, room out). The reads live in
 * `draftHqRookieRoomLoad.ts`; the drawing in `components/core-app/screens/DraftHqRookieRoom.tsx`.
 *
 * WHY. A dynasty league's draft is the annual ROOKIE draft — three to five rounds of incoming
 * rookies, picks that were traded a year ahead, and a taxi squad waiting to stash whoever lands. Draft
 * HQ drew it exactly like a redraft startup draft, so nothing on the screen said which draft this is.
 *
 * ⚠ NOTHING HERE IS ESTIMATED. Every block is passed stored facts and is null when they are missing,
 * and the screen draws nothing for a null block:
 *   - season / rounds / teams / status — `League.season` and the `DraftSession` row;
 *   - the board and your picks — `DraftSession.slotOrder` + `tradedPicks`, resolved by the live draft
 *     room's own order maths (`getSlotInRoundForOverall`, `resolvePickOwner`), the same pair
 *     `computePickInventory` uses for Draft HQ's own "Your picks";
 *   - with no live session, your picks come from the future-pick inventory
 *     (`loadDynastyOutlook` → `importedFuturePicks` / `nativeFuturePicks`), round-level only;
 *   - the date is a STORED one only — `LeagueSettings.draftDateUtc`, a provider draft time in
 *     `League.settings` (`leagueCalendar`), or the commissioner's custom rookie-draft open date
 *     (`rookieDraftCalendar`). The sport's default window is a rule, not a date anyone set, so it is
 *     not shown; and a date already past is not shown either, because a stale startup date on a rookie
 *     room would be a wrong answer;
 *   - taxi — `League.taxiSlots` and the viewer's roster taxi section (`taxiIdsOf`).
 */
import { formatPickLabel, getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'
import { readRookieDraftCalendarSettings } from '@/lib/dynasty-core/rookieDraftCalendar'
import { leagueCalendar } from './leagueCalendar'

type RookieRoomSlot = { slot: number; rosterId: string; displayName: string }

/** The `DraftSession` facts the room reads, already parsed by Draft HQ's loader. */
export type RookieRoomSession = {
  status: string
  draftType: string
  rounds: number
  teamCount: number
  thirdRoundReversal: boolean
  /** `DraftSession.draftModeLabel` — `startup` / `dispersal` name drafts that are not the rookie draft. */
  modeLabel: string | null
  slotOrder: RookieRoomSlot[]
  tradedPicks: TradedPickRecord[]
  /** The viewer's roster id in `slotOrder`; null when the viewer has no team in this draft. */
  myRosterId: string | null
}

/** The future-pick inventory's shape (`DynastyOutlook['picks']`), restated so this module stays client-safe. */
type RookieRoomInventory =
  | {
      available: true
      coverage: 'complete' | 'traded_only' | 'none'
      bySeason: Array<{ season: number; picks: Array<{ round: number; label: string; fromTeamName: string | null }> }>
    }
  | { available: false; reason: string }

type RookieBoardPick = {
  overall: number
  label: string
  /** Who holds the pick now. */
  team: string
  isYou: boolean
  /** The team whose slot this was, when a trade moved it; null for a pick still with its original team. */
  via: string | null
  /** The slot was the viewer's own before a trade moved it — the board's "traded away" picks. */
  wasYours: boolean
}

export type RookieDraftRoom = {
  kind: 'rookie' | 'startup' | 'dispersal'
  /** The season this draft seeds; null only when no season is stored at all. */
  season: number | null
  /** `DraftSession.status` when the room is that session's draft; null when it is read from the pick inventory. */
  status: string | null
  rounds: number | null
  teams: number | null
  /** An upcoming stored date. `starts` is a draft start; `opens` is the commissioner's rookie-draft open date. */
  date: { at: string; kind: 'starts' | 'opens'; daysAway: number } | null
  /** Every pick of the draft, round by round, owner resolved. Only from a live session with an order. */
  board: Array<{ round: number; picks: RookieBoardPick[] }> | null
  picks: {
    list: Array<{ round: number; label: string; via: string | null }>
    firstRounders: number
    tradedAway: Array<{ label: string; to: string }>
    /** True when labels are exact slots (1.04) from the session; false for round-level inventory picks (1st). */
    exact: boolean
    /** The inventory could only rebuild picks that changed hands. */
    partial: boolean
    /** Draft HQ's own sync caveat (provider-hosted pick trades are not synced), carried with the picks it qualifies. */
    note: string | null
  } | null
  taxi: { count: number; slots: number } | null
}

const DONE = new Set(['completed', 'complete', 'post_draft'])
const ORDERED = new Set(['snake', 'linear'])
const DAY_MS = 86_400_000

/** True when the session itself is the room: not yet finished, and its order can be resolved pick by pick. */
export function sessionDrivesRoom(session: RookieRoomSession | null | undefined): session is RookieRoomSession {
  return Boolean(
    session &&
      !DONE.has(session.status.toLowerCase()) &&
      ORDERED.has(session.draftType.toLowerCase()) &&
      session.slotOrder.length > 0 &&
      session.rounds > 0 &&
      session.teamCount > 0,
  )
}

/** Every pick of the draft with its current owner — the board the live room will run. Pure. */
export function rookieDraftBoard(session: RookieRoomSession): Array<{ round: number; picks: RookieBoardPick[] }> {
  const { slotOrder, rounds, teamCount } = session
  const draftType = session.draftType.toLowerCase() === 'snake' ? 'snake' : 'linear'
  const out: Array<{ round: number; picks: RookieBoardPick[] }> = []
  for (let overall = 1; overall <= rounds * teamCount; overall += 1) {
    const round = Math.ceil(overall / teamCount)
    const slot = getSlotInRoundForOverall({ overall, teamCount, draftType, thirdRoundReversal: session.thirdRoundReversal })
    const original = slotOrder.find((e) => e.slot === slot)
    const owner = resolvePickOwner(round, slot, [...slotOrder], [...session.tradedPicks])
    if (!original || !owner) continue
    const moved = owner.rosterId !== original.rosterId
    const pick: RookieBoardPick = {
      overall,
      label: formatPickLabel(overall, teamCount),
      team: owner.displayName || original.displayName || '—',
      isYou: session.myRosterId != null && owner.rosterId === session.myRosterId,
      via: moved ? original.displayName || owner.tradedPickMeta?.previousOwnerName || null : null,
      wasYours: session.myRosterId != null && original.rosterId === session.myRosterId,
    }
    const row = out[out.length - 1]
    if (row && row.round === round) row.picks.push(pick)
    else out.push({ round, picks: [pick] })
  }
  return out
}

function kindOf(session: RookieRoomSession | null): RookieDraftRoom['kind'] {
  if (!session || DONE.has(session.status.toLowerCase())) return 'rookie'
  const label = String(session.modeLabel ?? '').trim().toLowerCase()
  return label === 'startup' ? 'startup' : label === 'dispersal' ? 'dispersal' : 'rookie'
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** The first stored, still-upcoming date: a set start time first, then the commissioner's open date. */
export function rookieRoomDate(input: {
  draftDateUtc: Date | string | null | undefined
  leagueSettings: unknown
  now: Date
}): RookieDraftRoom['date'] {
  const now = input.now.getTime()
  const providerDraft = leagueCalendar(input.leagueSettings).find((e) => e.key === 'draft')?.at ?? null
  const custom = readRookieDraftCalendarSettings(input.leagueSettings).customOpenDate
  const candidates: Array<{ ms: number | null; kind: 'starts' | 'opens' }> = [
    { ms: toMs(input.draftDateUtc), kind: 'starts' },
    { ms: toMs(providerDraft), kind: 'starts' },
    { ms: custom ? Date.parse(`${custom}T00:00:00Z`) : null, kind: 'opens' },
  ]
  for (const c of candidates) {
    if (c.ms != null && c.ms > now) {
      return { at: new Date(c.ms).toISOString(), kind: c.kind, daysAway: Math.ceil((c.ms - now) / DAY_MS) }
    }
  }
  return null
}

export function buildRookieDraftRoom(input: {
  leagueSeason: number | null
  /** The current `DraftSession`, or null when the league has none. */
  session: RookieRoomSession | null
  draftDateUtc: Date | string | null | undefined
  leagueSettings: unknown
  /** The viewer's future picks; only read when the session cannot answer. */
  inventory: RookieRoomInventory | null
  taxi: { count: number; slots: number } | null
  /** Draft HQ's "pick trades made on X are not synced" sentence, when it applies to this session. */
  syncNote?: string | null
  now: Date
}): RookieDraftRoom {
  const { session } = input
  const live = sessionDrivesRoom(session)

  let season = input.leagueSeason ?? null
  let board: RookieDraftRoom['board'] = null
  let picks: RookieDraftRoom['picks'] = null

  if (live) {
    board = rookieDraftBoard(session)
    const all = board.flatMap((r) => r.picks.map((p) => ({ ...p, round: r.round })))
    const mine = all.filter((p) => p.isYou)
    const away = all.filter((p) => p.wasYours && !p.isYou).map((p) => ({ label: p.label, to: p.team }))
    if (session.myRosterId != null) {
      picks = {
        list: mine.map((p) => ({ round: p.round, label: p.label, via: p.via })),
        firstRounders: mine.filter((p) => p.round === 1).length,
        tradedAway: away,
        exact: true,
        partial: false,
        note: input.syncNote ?? null,
      }
    }
  } else if (input.inventory?.available) {
    // The next draft the inventory holds — upcomingDraftSeasons already starts at the right one.
    const next = input.inventory.bySeason.find((s) => s.picks.length > 0) ?? null
    if (next) {
      season = next.season
      picks = {
        list: next.picks.map((p) => ({ round: p.round, label: p.label, via: p.fromTeamName })),
        firstRounders: next.picks.filter((p) => p.round === 1).length,
        tradedAway: [],
        exact: false,
        partial: input.inventory.coverage !== 'complete',
        note: null,
      }
    }
  }

  // Read from `raw`, not `session`: the type guard held in `live` narrows `session` to null wherever
  // `live` is false, which typed this as `never` (TS2339). Same result: a live session, or one not done.
  const raw: RookieRoomSession | null = input.session
  const status = raw == null ? null : live || !DONE.has(raw.status.toLowerCase()) ? raw.status : null
  const showSessionFacts = live || (session != null && status != null)
  const taxi = input.taxi && (input.taxi.slots > 0 || input.taxi.count > 0) ? input.taxi : null
  const inDraft = status != null && ['in_progress', 'paused'].includes(status.toLowerCase())

  return {
    kind: kindOf(live || status != null ? session : null),
    season,
    status,
    rounds: showSessionFacts && session ? session.rounds : null,
    teams: showSessionFacts && session ? session.teamCount : null,
    date: inDraft ? null : rookieRoomDate({ draftDateUtc: input.draftDateUtc, leagueSettings: input.leagueSettings, now: input.now }),
    board,
    picks,
    taxi,
  }
}
