import 'server-only'

import { prisma } from '@/lib/prisma'
import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { normalizePosition } from '@/lib/core-app/positionNormalization'
import { latestProjectionWeek } from '@/lib/core-app/playerProjections'
import {
  computeRosterNeed,
  counterpartyPriceDelta,
  readSlotRequirements,
  type RosterNeed,
  type RosteredSlot,
  type SlotRequirements,
} from '@/lib/trade-intel/rosterNeed'
import { getPositionScarcity, type ScarcityBoard } from '@/lib/trade-intel/positionScarcity'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import type { LeagueValueAdjustment } from './leagueTradeValue'

/** One asset in the deal, as the need model sees it. `base` orders who fills a hole first. */
export type NeedLine = { name: string; position: string | null; base: number | null; injuryStatus?: string | null }

export type NeedFactors = {
  give: Array<LeagueValueAdjustment | null>
  get: Array<LeagueValueAdjustment | null>
  /** Why need could not be priced at all — printed under "what we couldn't see". Null when it ran. */
  gap: string | null
}

const none = (give: NeedLine[], get: NeedLine[], gap: string | null): NeedFactors => ({
  give: give.map(() => null),
  get: get.map(() => null),
  gap,
})

/**
 * What each asset in a deal is worth to the VIEWER'S roster in this league, over its market price.
 *
 * The price rule is `counterpartyPriceDelta` — a hole at a position you can fill off waivers is a
 * claim, not a need; the same hole with an empty wire can only be filled by trading, and that is
 * when a player is genuinely worth more to you than the chart says. This function decides which
 * assets the rule applies to. PURE apart from `loadViewerNeedFactors` below.
 *
 * ⚠ INCOMING IS PRICED AGAINST THE ROSTER AFTER THE OUTGOING SIDE LEAVES — sending your only tight
 * end away is how a trade creates the hole it then fills. And only as many incoming players as there
 * are open slots get the premium, best first: two receivers arriving for one empty WR slot do not
 * both fill it, and pricing both up is how a 2-for-1 gets graded as a steal.
 *
 * ⚠ OUTGOING IS PRICED AGAINST THE ROSTER AFTER THE WHOLE TRADE. Sending a starter the deal does
 * not replace leaves a slot empty, which costs more than his market price; sending surplus depth
 * costs slightly less. A like-for-like swap at one position is premium on both sides and nets out,
 * which is the point: need should not tilt a trade that does not change the need.
 */
export function allocateNeedFactors(args: {
  give: NeedLine[]
  get: NeedLine[]
  /** Need on the roster with the outgoing side removed. */
  needAfterOutgoing: RosterNeed
  /** Need on the roster after the whole deal. */
  needAfterTrade: RosterNeed
  scarcity: ScarcityBoard
}): { give: Array<LeagueValueAdjustment | null>; get: Array<LeagueValueAdjustment | null> } {
  const give: Array<LeagueValueAdjustment | null> = args.give.map(() => null)
  const get: Array<LeagueValueAdjustment | null> = args.get.map(() => null)

  const allocate = (
    lines: NeedLine[],
    out: Array<LeagueValueAdjustment | null>,
    need: RosterNeed,
    phrase: (basis: string) => string,
  ) => {
    const byPos = new Map<string, number[]>()
    lines.forEach((l, i) => {
      const pos = l.position?.toUpperCase().trim()
      if (!pos || isRuledOut(l.injuryStatus ?? null)) return
      byPos.set(pos, [...(byPos.get(pos) ?? []), i])
    })
    for (const [pos, idxs] of byPos) {
      const delta = counterpartyPriceDelta({
        position: pos,
        need,
        scarcity: args.scarcity.get(pos) ?? null,
        subject: 'you',
      })
      if (!delta || delta.factor === 1) continue
      const row = need.byPosition.find((p) => p.position === pos)
      // A premium covers at most the open slots, best asset first; a surplus discount covers every one.
      const ordered = [...idxs].sort((a, b) => (lines[b]!.base ?? -1) - (lines[a]!.base ?? -1))
      const covered = delta.factor > 1 ? ordered.slice(0, Math.max(0, row?.deficit ?? 0)) : ordered
      for (const i of covered) out[i] = { kind: 'need', factor: delta.factor, reason: phrase(delta.basis) }
    }
  }

  allocate(args.get, get, args.needAfterOutgoing, (b) => b)
  allocate(args.give, give, args.needAfterTrade, (b) => `after this trade ${b}`)
  return { give, get }
}

/**
 * Load the viewer's roster and this league's waiver wire, and price the deal's need factors.
 *
 * Never throws; every missing input comes back as a named `gap` with no factors, because a need
 * adjustment made on a roster we could not read would be a guess wearing a percentage.
 */
export async function loadViewerNeedFactors(args: {
  leagueId: string
  userId: string
  sport: string
  starters: unknown
  give: NeedLine[]
  get: NeedLine[]
}): Promise<NeedFactors> {
  const { give, get } = args
  try {
    const requirements: SlotRequirements | null = readSlotRequirements(args.starters)
    if (!requirements) return none(give, get, "this league's starting lineup, so roster need is not priced")

    const viewer = await resolveViewerLeagueRoster(args.leagueId, args.userId)
    if (!viewer.ok) return none(give, get, viewer.gap)

    const pd = (viewer.roster.playerData ?? {}) as Record<string, unknown>
    const rosterIds = Array.isArray(pd.players) ? pd.players.map(String).filter((x) => x && x !== '0') : []
    if (rosterIds.length === 0) return none(give, get, 'your roster in this league, which has no players on file')

    const rows = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { in: rosterIds } },
      select: { sleeperId: true, position: true, name: true },
    })
    /*
     * 🛑 ONE PLAYER PER ROSTER ID, NOT ONE PER ROW. `SportsPlayer` carries several rows for many
     * players — measured on production 2026-09-24: 1,420 of 11,960 NFL Sleeper ids have 2–3 rows —
     * so counting rows made a 28-man roster read as 68 bodies, every position deep, and the verdict
     * told a manager he "carries 12 more" tight ends. Found by rendering it, not by a test.
     * `buildTradeContextNotes` keys the same rows through a Map, which is why its notes never showed
     * it. Positions are normalised too: some rows spell them "TightEnd".
     */
    const byId = new Map<string, { sleeperId: string; position: string; name: string }>()
    for (const r of rows) {
      if (!r.sleeperId || byId.has(r.sleeperId)) continue
      byId.set(r.sleeperId, { sleeperId: r.sleeperId, position: normalizePosition(r.position), name: r.name })
    }
    const players = rosterIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    const injuries = await prisma.sportsInjury
      .findMany({
        where: { sport: args.sport, playerName: { in: players.map((p) => p.name) } },
        orderBy: { fetchedAt: 'desc' },
        select: { playerName: true, status: true },
      })
      .catch(() => [] as Array<{ playerName: string; status: string | null }>)
    const statusByName = new Map<string, string | null>()
    for (const i of injuries) {
      const k = i.playerName.toLowerCase()
      if (!statusByName.has(k)) statusByName.set(k, i.status)
    }

    // Outgoing matched by name against the roster — the only handle the console has, and an
    // unmatched give simply stays on the roster, which errs toward reporting LESS need.
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]))
    const outgoing = new Set(
      give.map((g) => byName.get(g.name.toLowerCase())?.sleeperId).filter((x): x is string => Boolean(x)),
    )
    const slotOf = (p: { position: string | null; name: string }): RosteredSlot => ({
      position: p.position ?? '',
      unavailable: isRuledOut(statusByName.get(p.name.toLowerCase()) ?? null),
    })
    const remaining = players.filter((p) => p.sleeperId && !outgoing.has(p.sleeperId)).map(slotOf)
    const incoming: RosteredSlot[] = get
      .filter((g) => g.position)
      .map((g) => ({ position: g.position!, unavailable: isRuledOut(g.injuryStatus ?? null) }))

    const needAfterOutgoing = computeRosterNeed({ requirements, rostered: remaining })
    const needAfterTrade = computeRosterNeed({ requirements, rostered: [...remaining, ...incoming] })

    const positions = [...new Set([...give, ...get].map((l) => l.position?.toUpperCase().trim()).filter(Boolean))] as string[]
    const scarcity = await getPositionScarcity({
      leagueId: args.leagueId,
      sport: args.sport,
      projectionWeek: await latestProjectionWeek().catch(() => null),
      positions,
    }).catch(() => new Map() as ScarcityBoard)

    return { ...allocateNeedFactors({ give, get, needAfterOutgoing, needAfterTrade, scarcity }), gap: null }
  } catch {
    return none(give, get, 'your roster in this league — it could not be read just now')
  }
}
