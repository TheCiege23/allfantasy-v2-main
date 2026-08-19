import 'server-only'

/**
 * sleeperDraftIntelService — slice 4: live draft intelligence over Sleeper's
 * public read-only draft feed.
 *
 * Deterministic pipeline per refresh: board state → viewer needs → run
 * detection → room psychology → structural focus verdict. Everything returned
 * is computed from the feed or the draft's own settings — nothing invented:
 *  - Needs come from the draft's real slot settings (incl. IDP + superflex).
 *  - Runs are counted (a position taken ≥ RUN_THRESHOLD times in the last
 *    RUN_WINDOW picks), never vibes.
 *  - Psychology is counted behavior: per-manager position mix + pick-trade
 *    accumulation from traded_picks.
 *  - The focus verdict is STRUCTURAL (which slot to attack and why). It names
 *    no players and emits no probabilities — player-level valuation requires
 *    the LeagueContext envelope (slice 5) and the payload says so.
 */

import {
  getLeagueContext,
  type LeagueContextEnvelope,
} from '@/lib/league-context/leagueContextService'
import {
  adpFor,
  getSeasonBoard,
  isIdp,
  isRookie,
} from '@/lib/sports-data/sleeperMarketService'
import { getMarketValues, playerValue } from '@/lib/trade-intel/marketValueService'

const SLEEPER = 'https://api.sleeper.app/v1'
const RUN_WINDOW = 12
const RUN_THRESHOLD = 4

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ── Wire types (consumed subset) ─────────────────────────────────────────────
type SleeperDraft = {
  draft_id: string
  league_id: string | null
  status: string
  type: string
  season: string
  start_time: number | null
  metadata?: { name?: string | null } | null
  settings?: Record<string, number | undefined> | null
  draft_order?: Record<string, number> | null
}
type SleeperPick = {
  round: number
  pick_no: number
  draft_slot: number
  picked_by: string | null
  player_id?: string | null
  metadata?: {
    first_name?: string | null
    last_name?: string | null
    position?: string | null
    team?: string | null
  } | null
}
type SleeperTradedPick = {
  round: number
  roster_id: number
  owner_id: number
  previous_owner_id: number
}
type SleeperUser = {
  user_id: string
  display_name: string
  avatar: string | null
}

// ── Payload types ────────────────────────────────────────────────────────────
export type DraftListItem = {
  draftId: string
  leagueId: string | null
  name: string
  status: string
  season: string
  startTime: string | null
  teams: number
  rounds: number
}
export type DraftNeedRow = { slot: string; required: number; filled: number }
export type DraftRunRow = { position: string; lastWindow: number; total: number; active: boolean }
export type DraftManagerRead = {
  userId: string
  name: string
  avatar: string | null
  picksMade: number
  positionMix: Record<string, number>
  extraPicksAcquired: number
  picksTradedAway: number
}
export type DraftRecentPick = {
  pickNo: number
  round: number
  label: string
  playerId: string | null
  playerName: string
  position: string | null
  byName: string
  byUserId: string | null
}
export type DraftFocusItem = { slot: string; reason: string }
export type DraftBestAvailable = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  /** Market ADP in the league's own format column — real RotoWire number. */
  adp: number
  /** FantasyCalc market value in this league's format (dynasty/redraft/SF aware). */
  marketValue: number | null
  rookie: boolean
  idp: boolean
  /** Viewer's open starter slots this player can fill (empty = depth pick). */
  fillsSlots: string[]
}
export type DraftContextSummary = {
  leagueName: string
  idp: boolean
  superflex: boolean
  dynasty: boolean
  bestBall: boolean
  scoringFormat: 'ppr' | 'half_ppr' | 'std'
  idpEmphasis: 'tackle-heavy' | 'big-play' | 'balanced' | null
  adpKeyLabel: string
  pirate: { active: boolean; source: 'declared' | 'detected'; lines: string[] } | null
}
export type DraftIntelPayload = {
  version: 1
  fetchedAt: string
  draft: DraftListItem
  picksMade: number
  totalPicks: number
  currentOverall: number | null
  currentRoundLabel: string | null
  viewer: {
    inDraft: boolean
    slot: number | null
    picksMade: number
    nextPickOverall: number | null
    nextPickLabel: string | null
    picksUntilNext: number | null
    needs: DraftNeedRow[]
  }
  runs: DraftRunRow[]
  managers: DraftManagerRead[]
  recentPicks: DraftRecentPick[]
  /** Slice 5: the league's real settings + house rules, when resolvable. */
  context: DraftContextSummary | null
  /** Slice 5: best available by MARKET ADP in the league's own format. */
  bestAvailable: { players: DraftBestAvailable[]; source: string } | null
  focus: {
    items: DraftFocusItem[]
    /** True when best-available is grounded in market ADP for this format. */
    playerLevel: boolean
    note: string
  }
  missing: string[]
}

// ── Draft list ───────────────────────────────────────────────────────────────
function toListItem(d: SleeperDraft): DraftListItem {
  return {
    draftId: d.draft_id,
    leagueId: d.league_id ?? null,
    name: d.metadata?.name?.trim() || `${d.season} draft`,
    status: d.status,
    season: d.season,
    startTime: d.start_time ? new Date(d.start_time).toISOString() : null,
    teams: d.settings?.teams ?? 0,
    rounds: d.settings?.rounds ?? 0,
  }
}

const rankDraftStatus = (s: string) =>
  s === 'drafting' ? 0 : s === 'paused' ? 1 : s === 'pre_draft' ? 2 : 3

export async function listUserDrafts(
  sleeperUserId: string,
  season: string,
): Promise<DraftListItem[] | null> {
  const drafts = await j<SleeperDraft[]>(`/user/${sleeperUserId}/drafts/nfl/${season}`)
  if (!drafts) return null
  return drafts
    .map(toListItem)
    .sort(
      (a, b) =>
        rankDraftStatus(a.status) - rankDraftStatus(b.status) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    )
}

/**
 * Drafts belonging to ONE league (league pages must never mix in the viewer's
 * drafts from other leagues — that's the dashboard's cross-league view).
 */
export async function listLeagueDrafts(sleeperLeagueId: string): Promise<DraftListItem[] | null> {
  const drafts = await j<SleeperDraft[]>(`/league/${sleeperLeagueId}/drafts`)
  if (!drafts) return null
  return drafts
    .map(toListItem)
    .sort(
      (a, b) =>
        rankDraftStatus(a.status) - rankDraftStatus(b.status) ||
        (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    )
}

// ── Snake math ───────────────────────────────────────────────────────────────
function overallForSlot(round: number, slot: number, teams: number): number {
  return round % 2 === 1 ? (round - 1) * teams + slot : (round - 1) * teams + (teams - slot + 1)
}
function labelForOverall(overall: number, teams: number): string {
  const round = Math.ceil(overall / teams)
  const within = overall - (round - 1) * teams
  const slot = round % 2 === 1 ? within : teams - within + 1
  return `${round}.${String(slot).padStart(2, '0')}`
}

// ── Needs ────────────────────────────────────────────────────────────────────
const SLOT_KEYS: { key: string; label: string; accepts: string[] }[] = [
  { key: 'slots_qb', label: 'QB', accepts: ['QB'] },
  { key: 'slots_rb', label: 'RB', accepts: ['RB'] },
  { key: 'slots_wr', label: 'WR', accepts: ['WR'] },
  { key: 'slots_te', label: 'TE', accepts: ['TE'] },
  { key: 'slots_k', label: 'K', accepts: ['K'] },
  { key: 'slots_def', label: 'DEF', accepts: ['DEF'] },
  { key: 'slots_dl', label: 'DL', accepts: ['DL', 'DE', 'DT'] },
  { key: 'slots_lb', label: 'LB', accepts: ['LB', 'ILB', 'OLB'] },
  { key: 'slots_db', label: 'DB', accepts: ['DB', 'CB', 'S', 'FS', 'SS'] },
  { key: 'slots_flex', label: 'FLEX', accepts: ['RB', 'WR', 'TE'] },
  { key: 'slots_super_flex', label: 'SFLX', accepts: ['QB', 'RB', 'WR', 'TE'] },
  { key: 'slots_idp_flex', label: 'IDP-F', accepts: ['DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'] },
]

function computeNeeds(
  settings: Record<string, number | undefined> | null | undefined,
  viewerPositions: string[],
): DraftNeedRow[] {
  const remaining = [...viewerPositions]
  const rows: DraftNeedRow[] = []
  for (const slot of SLOT_KEYS) {
    const required = settings?.[slot.key] ?? 0
    if (required <= 0) continue
    let filled = 0
    for (let i = 0; i < required; i += 1) {
      const idx = remaining.findIndex((p) => slot.accepts.includes(p))
      if (idx >= 0) {
        remaining.splice(idx, 1)
        filled += 1
      }
    }
    rows.push({ slot: slot.label, required, filled })
  }
  return rows
}

// ── Intel build ──────────────────────────────────────────────────────────────
export async function getDraftIntel(
  draftId: string,
  viewerSleeperUserId: string | null,
): Promise<DraftIntelPayload | null> {
  const missing: string[] = []
  const draft = await j<SleeperDraft>(`/draft/${draftId}`)
  if (!draft) return null

  const [picks, tradedPicks, leagueUsers, context, marketBoard] = await Promise.all([
    j<SleeperPick[]>(`/draft/${draftId}/picks`),
    j<SleeperTradedPick[]>(`/draft/${draftId}/traded_picks`),
    draft.league_id ? j<SleeperUser[]>(`/league/${draft.league_id}/users`) : Promise.resolve(null),
    draft.league_id ? getLeagueContext(draft.league_id) : Promise.resolve(null),
    getSeasonBoard(draft.season),
  ])
  if (!picks) missing.push('picks')
  if (!tradedPicks) missing.push('pick trades')
  if (draft.league_id && !leagueUsers) missing.push('managers')
  if (draft.league_id && !context) missing.push('league context (scoring/roster settings)')
  if (!marketBoard) missing.push('market ADP board')

  const teams = draft.settings?.teams ?? 0
  const rounds = draft.settings?.rounds ?? 0
  const totalPicks = teams * rounds
  const made = picks?.length ?? 0
  const usersById = new Map((leagueUsers ?? []).map((u) => [u.user_id, u]))
  const nameOf = (uid: string | null): string =>
    (uid ? usersById.get(uid)?.display_name : null) ?? (uid ? 'Manager' : '—')

  const isLive = draft.status === 'drafting' || draft.status === 'paused'
  const currentOverall = isLive && made < totalPicks ? made + 1 : null
  const currentRoundLabel =
    currentOverall != null && teams > 0 ? labelForOverall(currentOverall, teams) : null

  // Viewer
  const viewerSlot =
    viewerSleeperUserId && draft.draft_order ? draft.draft_order[viewerSleeperUserId] ?? null : null
  const viewerPicks = (picks ?? []).filter((p) => p.picked_by === viewerSleeperUserId)
  let nextPickOverall: number | null = null
  if (viewerSlot != null && teams > 0 && currentOverall != null) {
    for (let r = 1; r <= rounds; r += 1) {
      const overall = overallForSlot(r, viewerSlot, teams)
      if (overall >= currentOverall) {
        nextPickOverall = overall
        break
      }
    }
  }
  const viewerPositions = viewerPicks
    .map((p) => p.metadata?.position?.toUpperCase() ?? '')
    .filter(Boolean)
  const needs = computeNeeds(draft.settings, viewerPositions)

  // Runs
  const positionOf = (p: SleeperPick) => p.metadata?.position?.toUpperCase() || 'UNK'
  const lastWindow = (picks ?? []).slice(-RUN_WINDOW)
  const windowCounts = new Map<string, number>()
  for (const p of lastWindow) windowCounts.set(positionOf(p), (windowCounts.get(positionOf(p)) ?? 0) + 1)
  const totalCounts = new Map<string, number>()
  for (const p of picks ?? []) totalCounts.set(positionOf(p), (totalCounts.get(positionOf(p)) ?? 0) + 1)
  const runs: DraftRunRow[] = [...totalCounts.entries()]
    .map(([position, total]) => ({
      position,
      total,
      lastWindow: windowCounts.get(position) ?? 0,
      active: (windowCounts.get(position) ?? 0) >= RUN_THRESHOLD,
    }))
    .sort((a, b) => b.lastWindow - a.lastWindow || b.total - a.total)

  // Psychology: counted behavior per manager
  const byManager = new Map<string, SleeperPick[]>()
  for (const p of picks ?? []) {
    if (!p.picked_by) continue
    const list = byManager.get(p.picked_by)
    if (list) list.push(p)
    else byManager.set(p.picked_by, [p])
  }
  const acquired = new Map<number, number>()
  const shipped = new Map<number, number>()
  for (const t of tradedPicks ?? []) {
    acquired.set(t.owner_id, (acquired.get(t.owner_id) ?? 0) + 1)
    shipped.set(t.previous_owner_id, (shipped.get(t.previous_owner_id) ?? 0) + 1)
  }
  // roster_id ↔ user mapping isn't in the draft object for trades; report trade
  // volume per manager only when the draft_order slot maps 1:1 (best effort by
  // slot index); otherwise trade counts stay roster-level in recent-picks copy.
  const managers: DraftManagerRead[] = [...byManager.entries()]
    .map(([userId, list]) => {
      const mix: Record<string, number> = {}
      for (const p of list) mix[positionOf(p)] = (mix[positionOf(p)] ?? 0) + 1
      const slot = draft.draft_order?.[userId]
      return {
        userId,
        name: nameOf(userId),
        avatar: usersById.get(userId)?.avatar ?? null,
        picksMade: list.length,
        positionMix: mix,
        extraPicksAcquired: slot != null ? acquired.get(slot) ?? 0 : 0,
        picksTradedAway: slot != null ? shipped.get(slot) ?? 0 : 0,
      }
    })
    .sort((a, b) => b.picksMade - a.picksMade)

  const recentPicks: DraftRecentPick[] = (picks ?? [])
    .slice(-8)
    .reverse()
    .map((p) => ({
      pickNo: p.pick_no,
      round: p.round,
      label: teams > 0 ? labelForOverall(p.pick_no, teams) : `${p.round}.${p.pick_no}`,
      playerId: p.player_id ?? null,
      playerName:
        [p.metadata?.first_name, p.metadata?.last_name].filter(Boolean).join(' ').trim() || 'Player',
      position: p.metadata?.position?.toUpperCase() ?? null,
      byName: nameOf(p.picked_by),
      byUserId: p.picked_by,
    }))

  // Structural focus: open starter slots ranked by (deficit, run pressure).
  const runPressure = (accepts: string[]) =>
    Math.max(0, ...runs.filter((r) => r.active && accepts.includes(r.position)).map((r) => r.lastWindow))
  const focusItems: DraftFocusItem[] = needs
    .filter((n) => n.filled < n.required)
    .map((n) => {
      const def = SLOT_KEYS.find((s) => s.label === n.slot)
      const pressure = def ? runPressure(def.accepts) : 0
      const deficit = n.required - n.filled
      return { row: n, pressure, deficit }
    })
    .sort((a, b) => b.pressure - a.pressure || b.deficit - a.deficit)
    .slice(0, 4)
    .map(({ row, pressure, deficit }) => ({
      slot: row.slot,
      reason:
        pressure > 0
          ? `${deficit} open · a run is draining eligible players (${pressure} in the last ${RUN_WINDOW} picks)`
          : `${deficit} open starter slot${deficit === 1 ? '' : 's'}`,
    }))

  // ── Slice 5: context summary + best available by the league's own ADP ──────
  const contextSummary: DraftContextSummary | null = context
    ? {
        leagueName: context.name,
        idp: context.variant.idp,
        superflex: context.variant.superflex,
        dynasty: context.variant.dynasty,
        bestBall: context.variant.bestBall,
        scoringFormat: context.scoring.format,
        idpEmphasis: context.scoring.idp.emphasis,
        adpKeyLabel: context.adpKeyLabel,
        pirate: context.houseRules.pirate
          ? {
              active: context.houseRules.pirate.active,
              source: context.houseRules.pirate.source,
              lines: context.houseRules.pirate.lines,
            }
          : null,
      }
    : null

  const openSlots = needs.filter((n) => n.filled < n.required)
  const slotDefFor = (label: string) => SLOT_KEYS.find((s) => s.label === label)
  let bestAvailable: DraftIntelPayload['bestAvailable'] = null
  if (marketBoard && context) {
    const values = await getMarketValues(context).catch(() => null)
    const pickedIds = new Set((picks ?? []).map((p) => p.player_id).filter(Boolean) as string[])
    const ranked = Object.values(marketBoard.players)
      .filter((pl) => !pickedIds.has(pl.playerId))
      .map((pl) => ({ pl, adp: adpFor(pl, context) }))
      .filter((x): x is { pl: (typeof x)['pl']; adp: number } => x.adp != null)
      .sort((a, b) => a.adp - b.adp)
      .slice(0, 12)
      .map(({ pl, adp }) => ({
        playerId: pl.playerId,
        name: pl.name,
        position: pl.position,
        team: pl.team,
        adp,
        marketValue: values ? playerValue(values, pl.playerId) : null,
        rookie: isRookie(pl),
        idp: isIdp(pl),
        fillsSlots: openSlots
          .filter((n) => {
            const def = slotDefFor(n.slot)
            return def && pl.position ? def.accepts.includes(pl.position) : false
          })
          .map((n) => n.slot),
      }))
    if (ranked.length > 0) {
      bestAvailable = {
        players: ranked,
        source: values
          ? `${context.adpKeyLabel} + ${values.mode} market values (FantasyCalc)`
          : `${context.adpKeyLabel} · RotoWire market data via the Sleeper feed`,
      }
    }
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    draft: toListItem(draft),
    picksMade: made,
    totalPicks,
    currentOverall,
    currentRoundLabel,
    viewer: {
      inDraft: viewerSlot != null,
      slot: viewerSlot,
      picksMade: viewerPicks.length,
      nextPickOverall,
      nextPickLabel: nextPickOverall != null && teams > 0 ? labelForOverall(nextPickOverall, teams) : null,
      picksUntilNext:
        nextPickOverall != null && currentOverall != null ? Math.max(0, nextPickOverall - currentOverall) : null,
      needs,
    },
    runs,
    managers,
    recentPicks,
    context: contextSummary,
    bestAvailable,
    focus: {
      items: focusItems,
      playerLevel: bestAvailable != null,
      note: bestAvailable
        ? `Structural focus from your open slots, run pressure, and this draft's real settings. Best-available names are ranked by ${bestAvailable.source} — market consensus, not yet a full AF valuation.`
        : 'Structural focus from your open slots, run pressure, and this draft’s real settings. Player-level names need the market ADP board, which didn’t sync this refresh.',
    },
    missing,
  }
}
