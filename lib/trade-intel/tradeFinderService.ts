import 'server-only'

/**
 * tradeFinderService — suggests trades likely to make sense for BOTH sides,
 * built entirely from counted inputs:
 *  - real rosters (Sleeper /rosters) mapped against the league's real starter
 *    shape from the LeagueContext envelope (IDP + superflex aware),
 *  - market value = the ADP column that matches this league's exact format
 *    (never a home-brewed number),
 *  - manager behavior = completed-trade counts from the graded ledger,
 *  - pirate house rule → floor/spread guidance lines when declared.
 *
 * A proposal is only emitted when the needs are COMPLEMENTARY (my surplus hits
 * their gap and their surplus hits mine) and the ADP gap is inside a stated
 * fairness band. Every rationale line is a checkable fact; the payload carries
 * the method so the UI can show its work. This is a starting point for a
 * conversation, not a valuation verdict — and it says so.
 */

import {
  getLeagueContext,
  type LeagueContextEnvelope,
} from '@/lib/league-context/leagueContextService'
import {
  getSeasonBoard,
  type MarketPlayer,
} from '@/lib/sports-data/sleeperMarketService'
import { getTradeGrades } from '@/lib/trade-intel/sleeperTradeGradeService'
import {
  getMarketValues,
  playerValue,
  type MarketValuesPayload,
} from '@/lib/trade-intel/marketValueService'

const SLEEPER = 'https://api.sleeper.app/v1'
const FAIRNESS_BAND = 30 // ADP fallback: max ADP gap for a suggested 1-for-1
const VALUE_FAIRNESS_PCT = 20 // preferred: max % gap in market value
const SURPLUS_ADP_CEILING = 200 // bench players ranked worse than this aren't trade bait

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireRoster = { roster_id: number; owner_id: string | null; players?: string[] | null }
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}

// Slot labels as they appear in Sleeper roster_positions.
const SLOT_ACCEPTS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'],
}

type RosterRead = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  /** Dedicated (non-flex) starter slots with no eligible player left. */
  openSlots: string[]
  /** Dedicated slots filled by a player ranked worse than ADP 120 — soft need. */
  weakSlots: { slot: string; adp: number }[]
  /** Bench players good enough to trade, best ADP first. */
  surplus: MarketPlayer[]
}

function readRoster(
  roster: WireRoster,
  user: WireUser | undefined,
  context: LeagueContextEnvelope,
  marketById: Map<string, MarketPlayer>,
  adpOf: (p: MarketPlayer) => number | null,
): RosterRead {
  const players = (roster.players ?? [])
    .map((id) => marketById.get(id))
    .filter((p): p is MarketPlayer => Boolean(p?.position))
    .map((p) => ({ p, adp: adpOf(p) ?? 999 }))
    .sort((a, b) => a.adp - b.adp)

  // Greedy fill: best players claim dedicated slots first, then flex slots.
  const slotEntries = Object.entries(context.roster.starters)
  const dedicated = slotEntries.filter(([label]) => (SLOT_ACCEPTS[label] ?? []).length <= 5)
  const flexes = slotEntries.filter(([label]) => (SLOT_ACCEPTS[label] ?? []).length > 5 || label.includes('FLEX'))
  const remainingBySlot = new Map<string, number>([...dedicated, ...flexes])
  const filledAdpBySlot = new Map<string, number[]>()
  const bench: { p: MarketPlayer; adp: number }[] = []

  for (const entry of players) {
    let placed = false
    for (const [label] of dedicated) {
      const left = remainingBySlot.get(label) ?? 0
      if (left <= 0) continue
      if ((SLOT_ACCEPTS[label] ?? []).includes(entry.p.position ?? '')) {
        remainingBySlot.set(label, left - 1)
        const list = filledAdpBySlot.get(label) ?? []
        list.push(entry.adp)
        filledAdpBySlot.set(label, list)
        placed = true
        break
      }
    }
    if (!placed) {
      for (const [label] of flexes) {
        const left = remainingBySlot.get(label) ?? 0
        if (left <= 0) continue
        if ((SLOT_ACCEPTS[label] ?? []).includes(entry.p.position ?? '')) {
          remainingBySlot.set(label, left - 1)
          placed = true
          break
        }
      }
    }
    if (!placed) bench.push(entry)
  }

  const openSlots: string[] = []
  for (const [label] of dedicated) {
    const left = remainingBySlot.get(label) ?? 0
    for (let i = 0; i < left; i += 1) openSlots.push(label)
  }
  const weakSlots = [...filledAdpBySlot.entries()]
    .map(([slot, adps]) => ({ slot, adp: Math.max(...adps) }))
    .filter((w) => w.adp > 120 && w.adp < 999)
    .sort((a, b) => b.adp - a.adp)

  const surplus = bench
    .filter((e) => e.adp <= SURPLUS_ADP_CEILING)
    .map((e) => e.p)

  return {
    rosterId: roster.roster_id,
    ownerId: roster.owner_id,
    name: user?.display_name ?? 'Manager',
    teamName: user?.metadata?.team_name?.trim() || null,
    avatar: user?.avatar ?? null,
    openSlots,
    weakSlots,
    surplus,
  }
}

export type TradeProposal = {
  partner: {
    ownerId: string | null
    name: string
    teamName: string | null
    avatar: string | null
    completedTrades: number
  }
  give: {
    playerId: string
    name: string
    position: string | null
    team: string | null
    adp: number
    /** FantasyCalc market value in this league's format (null = unranked). */
    marketValue: number | null
  }
  get: {
    playerId: string
    name: string
    position: string | null
    team: string | null
    adp: number
    marketValue: number | null
  }
  adpGap: number
  /** % gap in market value when both sides are ranked; null = ADP fallback used. */
  valueGapPct: number | null
  /** Checkable facts only. */
  rationale: string[]
}

export type TradeFinderPayload = {
  version: 1
  fetchedAt: string
  sleeperLeagueId: string
  viewer: { inLeague: boolean; openSlots: string[]; weakSlots: { slot: string; adp: number }[] }
  proposals: TradeProposal[]
  method: string
  contextNotes: string[]
  missing: string[]
}

export async function getTradeFinder(
  sleeperLeagueId: string,
  viewerSleeperUserId: string | null,
): Promise<TradeFinderPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null

  const [rosters, users, board, grades, values] = await Promise.all([
    j<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<WireUser[]>(`/league/${sleeperLeagueId}/users`),
    getSeasonBoard(context.season),
    getTradeGrades(sleeperLeagueId).catch(() => null),
    getMarketValues(context).catch(() => null as MarketValuesPayload | null),
  ])
  if (!rosters) return null
  if (!users) missing.push('managers')
  if (!board) missing.push('market ADP board')
  if (!grades) missing.push('trade-activity history')
  if (!values) missing.push('market value chart (falling back to ADP fairness)')

  const usersById = new Map((users ?? []).map((u) => [u.user_id, u]))
  const marketById = new Map(Object.entries(board?.players ?? {}))
  const adpOf = (p: MarketPlayer): number | null => p.adp[context.adpKey] ?? null

  const tradeCountByOwner = new Map<string, number>()
  for (const t of grades?.trades ?? []) {
    for (const s of t.sides) {
      if (s.ownerId) tradeCountByOwner.set(s.ownerId, (tradeCountByOwner.get(s.ownerId) ?? 0) + 1)
    }
  }

  const reads = rosters.map((r) =>
    readRoster(r, r.owner_id ? usersById.get(r.owner_id) : undefined, context, marketById, adpOf),
  )
  const me = viewerSleeperUserId ? reads.find((r) => r.ownerId === viewerSleeperUserId) ?? null : null

  const proposals: TradeProposal[] = []
  if (me && board) {
    const myNeedSlots = [...me.openSlots, ...me.weakSlots.map((w) => w.slot)]
    for (const them of reads) {
      if (them.rosterId === me.rosterId) continue
      const theirNeedSlots = [...them.openSlots, ...them.weakSlots.map((w) => w.slot)]

      // Their surplus that fills one of MY need slots.
      for (const getP of them.surplus) {
        const myFilled = myNeedSlots.find((slot) =>
          (SLOT_ACCEPTS[slot] ?? []).includes(getP.position ?? ''),
        )
        if (!myFilled) continue
        const getAdp = adpOf(getP)
        if (getAdp == null) continue

        // My surplus that fills one of THEIR need slots, inside the fairness band.
        for (const giveP of me.surplus) {
          if (giveP.playerId === getP.playerId) continue
          const theirFilled = theirNeedSlots.find((slot) =>
            (SLOT_ACCEPTS[slot] ?? []).includes(giveP.position ?? ''),
          )
          if (!theirFilled) continue
          const giveAdp = adpOf(giveP)
          if (giveAdp == null) continue
          const gap = Math.abs(giveAdp - getAdp)

          // Fairness: MARKET VALUE first (FantasyCalc, format-matched); ADP fallback.
          const giveVal = values ? playerValue(values, giveP.playerId) : null
          const getVal = values ? playerValue(values, getP.playerId) : null
          let valueGapPct: number | null = null
          if (giveVal != null && getVal != null && Math.max(giveVal, getVal) > 0) {
            valueGapPct =
              Math.round((Math.abs(giveVal - getVal) / Math.max(giveVal, getVal)) * 1000) / 10
            if (valueGapPct > VALUE_FAIRNESS_PCT) continue
          } else if (gap > FAIRNESS_BAND) {
            continue
          }

          const completedTrades = them.ownerId ? tradeCountByOwner.get(them.ownerId) ?? 0 : 0
          const rationale = [
            `${getP.name} fills your ${myFilled} ${me.openSlots.includes(myFilled) ? '(open starter slot)' : '(weakest starter by ADP)'}`,
            `${giveP.name} fills ${them.name}'s ${theirFilled} ${them.openSlots.includes(theirFilled) ? '(open starter slot)' : '(weakest starter by ADP)'}`,
            valueGapPct != null
              ? `market value ${giveVal?.toLocaleString()} vs ${getVal?.toLocaleString()} (${values?.mode} chart) — ${valueGapPct.toFixed(1)}% gap, inside the ±${VALUE_FAIRNESS_PCT}% band`
              : `ADP gap ${gap.toFixed(1)} in ${context.adpKeyLabel} — inside the ±${FAIRNESS_BAND} fallback band (no market value for one side)`,
          ]
          if (completedTrades > 0) {
            rationale.push(`${them.name} has completed ${completedTrades} trade${completedTrades === 1 ? '' : 's'} in league history`)
          }
          proposals.push({
            partner: {
              ownerId: them.ownerId,
              name: them.name,
              teamName: them.teamName,
              avatar: them.avatar,
              completedTrades,
            },
            give: {
              playerId: giveP.playerId,
              name: giveP.name,
              position: giveP.position,
              team: giveP.team,
              adp: Math.round(giveAdp * 10) / 10,
              marketValue: giveVal,
            },
            get: {
              playerId: getP.playerId,
              name: getP.name,
              position: getP.position,
              team: getP.team,
              adp: Math.round(getAdp * 10) / 10,
              marketValue: getVal,
            },
            adpGap: Math.round(gap * 10) / 10,
            valueGapPct,
            rationale,
          })
        }
      }
    }
  }

  // Rank: open-slot fixes first, then most-active partners, then tightest gap
  // (value gap when known, ADP gap otherwise).
  proposals.sort((a, b) => {
    const aOpen = a.rationale[0].includes('(open starter slot)') ? 0 : 1
    const bOpen = b.rationale[0].includes('(open starter slot)') ? 0 : 1
    const aGap = a.valueGapPct ?? a.adpGap
    const bGap = b.valueGapPct ?? b.adpGap
    return (
      aOpen - bOpen ||
      b.partner.completedTrades - a.partner.completedTrades ||
      aGap - bGap
    )
  })
  // One best proposal per partner+get-player, cap at 6.
  const dedup = new Map<string, TradeProposal>()
  for (const p of proposals) {
    const key = `${p.partner.ownerId}:${p.get.playerId}`
    if (!dedup.has(key)) dedup.set(key, p)
  }
  const finalProposals = [...dedup.values()].slice(0, 6)

  const contextNotes: string[] = [
    values
      ? `Fairness is judged by ${values.source} in ${values.mode} mode (${values.numQbs}QB, ${values.numTeams}-team, ${values.ppr} PPR); ADP (${context.adpKeyLabel}) is the fallback when a player is unranked.`
      : `Player value = ${context.adpKeyLabel} (RotoWire market data) — the market value chart didn't sync this refresh.`,
  ]
  if (values?.bestBallNote) contextNotes.push(values.bestBallNote)
  if (values) contextNotes.push(values.faab.formula)
  if (context.houseRules.pirate?.active) {
    contextNotes.push(
      'Pirate rules declared: favor consistent-floor targets and spreading value — a stolen stud hurts twice.',
    )
  }

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    sleeperLeagueId,
    viewer: {
      inLeague: Boolean(me),
      openSlots: me?.openSlots ?? [],
      weakSlots: me?.weakSlots ?? [],
    },
    proposals: finalProposals,
    method:
      `Both-sides matching: your tradeable depth vs their starter gaps and vice versa, 1-for-1s within an ADP gap of ${FAIRNESS_BAND}. ` +
      'Starter gaps come from this league’s real roster slots (IDP included); depth = bench players inside the top 200 of your format’s ADP.',
    contextNotes,
    missing,
  }
}
