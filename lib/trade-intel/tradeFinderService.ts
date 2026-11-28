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
 * A proposal is only GENERATED when the needs are COMPLEMENTARY (my surplus hits
 * their gap and their surplus hits mine) and the ADP gap is inside a stated
 * band. Every rationale line is a checkable fact; the payload carries the method
 * so the UI can show its work.
 *
 * 🛑 THE VERDICT IS THE ONE GRADER'S (2026-11-26). Fairness used to be judged
 * here on `marketValueService`'s FantasyCalc chart — a second engine's number
 * next to the letter every other trade screen shows. Now each generated
 * candidate is graded by `createLeagueTradeGrader` + `gradeDeal` (injected by
 * the route as `grade`), and the fairness band, the ranking, the values shown
 * and the "% apart" all come from that grade. A candidate the grader withholds
 * on is SHOWN as withheld — with the grader's reason — after every graded one.
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
import { liveLeagueRosters, liveLeagueUsers } from '@/lib/sleeper/liveLeagueFeed'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { gradeAllWithinBudget, gradeGapPct, type FinderGrade } from '@/lib/trade-finder/finderGrade'

const FAIRNESS_BAND = 30 // generation: max ADP gap for a candidate 1-for-1
const VALUE_FAIRNESS_PCT = 20 // verdict: max % gap on THE league trade grade
/** Candidates graded per request — generation-ranked first, so the cheap pass decides only who is graded. */
const GRADE_POOL = 24
const GRADE_BUDGET_MS = 8_000
const NO_GRADER = 'This league’s trade grade is not available here.'
const SURPLUS_ADP_CEILING = 200 // bench players ranked worse than this aren't trade bait


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
    /** This player's value on THE league trade grade (null = not graded). */
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
  /** % apart on THE league trade grade (absolute); null when the grade was withheld. */
  valueGapPct: number | null
  /** THE grade, from your side. A withheld grade carries the grader's reason. */
  leagueGrade: FinderGrade
  /** Checkable facts only (the last line states the grade). */
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
  opts: {
    /** THE grade (`gradeDeal` on one `createLeagueTradeGrader`), from the viewer's side. Absent = withheld. */
    grade?: ((give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>) | null
    gradeBudgetMs?: number
  } = {},
): Promise<TradeFinderPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null

  // Completed-trade COUNTS only (manager activity) — no letter from this ledger reaches a proposal.
  const [rosters, users, board, grades] = await Promise.all([
    // Through the allowlisted, short-cached Sleeper adapter — never a raw vendor call on a request path (DB-first guard).
    liveLeagueRosters(sleeperLeagueId) as Promise<WireRoster[] | null>,
    // The wire payload carries `avatar`; the adapter's type just does not declare it.
    liveLeagueUsers(sleeperLeagueId) as Promise<WireUser[] | null>,
    getSeasonBoard(context.season),
    getTradeGrades(sleeperLeagueId).catch(() => null),
  ])
  if (!rosters) return null
  if (!users) missing.push('managers')
  if (!board) missing.push('market ADP board')
  if (!grades) missing.push('trade-activity history')
  if (!opts.grade) missing.push('league trade grade')

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

  type Candidate = Omit<TradeProposal, 'leagueGrade' | 'valueGapPct'> & { fillsOpenSlot: boolean }
  const candidates: Candidate[] = []
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
          // GENERATION only: a cheap ADP band decides what is worth grading. The verdict is the grade's.
          if (gap > FAIRNESS_BAND) continue

          const completedTrades = them.ownerId ? tradeCountByOwner.get(them.ownerId) ?? 0 : 0
          const rationale = [
            `${getP.name} fills your ${myFilled} ${me.openSlots.includes(myFilled) ? '(open starter slot)' : '(weakest starter by ADP)'}`,
            `${giveP.name} fills ${them.name}'s ${theirFilled} ${them.openSlots.includes(theirFilled) ? '(open starter slot)' : '(weakest starter by ADP)'}`,
            `ADP gap ${gap.toFixed(1)} in ${context.adpKeyLabel} — inside the ±${FAIRNESS_BAND} band`,
          ]
          if (completedTrades > 0) {
            rationale.push(`${them.name} has completed ${completedTrades} trade${completedTrades === 1 ? '' : 's'} in league history`)
          }
          candidates.push({
            fillsOpenSlot: me.openSlots.includes(myFilled),
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
              marketValue: null,
            },
            get: {
              playerId: getP.playerId,
              name: getP.name,
              position: getP.position,
              team: getP.team,
              adp: Math.round(getAdp * 10) / 10,
              marketValue: null,
            },
            adpGap: Math.round(gap * 10) / 10,
            rationale,
          })
        }
      }
    }
  }

  /*
   * Generation order decides only WHICH candidates are graded (open-slot fixes, active partners, tight
   * ADP), bounded to GRADE_POOL. Everything after is on THE grade.
   */
  candidates.sort(
    (a, b) =>
      Number(b.fillsOpenSlot) - Number(a.fillsOpenSlot) ||
      b.partner.completedTrades - a.partner.completedTrades ||
      a.adpGap - b.adpGap,
  )
  const pool = candidates.slice(0, GRADE_POOL)
  const gradeFn = opts.grade
  const sleeperSide = (side: { playerId: string; name: string }): GradeInputs => ({
    assets: [{ kind: 'player', name: side.name, providerIdentity: { provider: 'sleeper', id: side.playerId } }],
    unpriceable: [],
  })
  const leagueGrades: FinderGrade[] = gradeFn
    ? await gradeAllWithinBudget(pool, (c) => gradeFn(sleeperSide(c.give), sleeperSide(c.get)), opts.gradeBudgetMs ?? GRADE_BUDGET_MS)
    : pool.map(() => ({ graded: false as const, reason: NO_GRADER }))

  const proposals: Array<TradeProposal & { fillsOpenSlot: boolean }> = []
  pool.forEach((c, i) => {
    const leagueGrade = leagueGrades[i]!
    const gap = gradeGapPct(leagueGrade)
    // The fairness band, on THE grade. A withheld grade is not filtered — it is shown as withheld.
    if (gap != null && Math.abs(gap) > VALUE_FAIRNESS_PCT) return
    const valueGapPct = gap == null ? null : Math.round(Math.abs(gap) * 10) / 10
    proposals.push({
      ...c,
      give: { ...c.give, marketValue: leagueGrade.graded ? leagueGrade.giveValue : null },
      get: { ...c.get, marketValue: leagueGrade.graded ? leagueGrade.getValue : null },
      valueGapPct,
      leagueGrade,
      rationale: [
        ...c.rationale,
        leagueGrade.graded
          ? `League grade ${leagueGrade.letter} for you, ${leagueGrade.partnerLetter} for ${c.partner.name} — ${leagueGrade.giveValue.toLocaleString()} vs ${leagueGrade.getValue.toLocaleString()} on this league's chart (${(valueGapPct ?? 0).toFixed(1)}% apart, inside the ±${VALUE_FAIRNESS_PCT}% band)`
          : `Not graded: ${leagueGrade.reason}`,
      ],
    })
  })

  // Rank: open-slot fixes first, graded before withheld, most-active partners, then THE grade's gap.
  proposals.sort(
    (a, b) =>
      Number(b.fillsOpenSlot) - Number(a.fillsOpenSlot) ||
      Number(b.leagueGrade.graded) - Number(a.leagueGrade.graded) ||
      b.partner.completedTrades - a.partner.completedTrades ||
      (a.valueGapPct ?? Number.POSITIVE_INFINITY) - (b.valueGapPct ?? Number.POSITIVE_INFINITY),
  )
  // One best proposal per partner+get-player, cap at 6.
  const dedup = new Map<string, TradeProposal>()
  for (const { fillsOpenSlot: _open, ...p } of proposals) {
    const key = `${p.partner.ownerId}:${p.get.playerId}`
    if (!dedup.has(key)) dedup.set(key, p)
  }
  const finalProposals = [...dedup.values()].slice(0, 6)

  const contextNotes: string[] = [
    opts.grade
      ? `Fairness is this league's AllFantasy trade grade — the same letter every trade screen shows, priced on this league's chart; ADP (${context.adpKeyLabel}) only picks which pairs are worth grading.`
      : `The league trade grade is not available here, so no suggestion is graded; ADP (${context.adpKeyLabel}) picked the pairs.`,
  ]
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
