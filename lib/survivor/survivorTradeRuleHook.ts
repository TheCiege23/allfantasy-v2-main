/**
 * The Survivor trade-rule hook. Every trade path calls this one function — the redraft Trade Center
 * create path (`validateRedraftTradeProposalAtCreation`), the trade runtime's create and accept,
 * `/api/redraft/trade-votes` at acceptance, approval and vote, and the generic league trade engine
 * (`createAfLeagueTrade`, accept, process) — so the rules are added to the existing paths rather than
 * forked into a Survivor copy of them.
 *
 * A league that is not Survivor, or a Survivor league whose commissioner has not switched the trade
 * rules on, returns `ok` after one league read. Chimmy-run seats trade through the same paths, so they
 * are held to the same rules with no special case.
 *
 * FAILS OPEN, LOUDLY — BY DEFAULT. A read error here allows the trade and logs a warning: the
 * commissioner can reverse a trade, but a database blip that refused every trade in the league could
 * not be undone. A commissioner may choose `tradeCheckFailureMode: 'hold'` instead: the check then
 * answers `ok` with `holdForCommissioner`, and the ACCEPTANCE paths send the trade to the existing
 * commissioner approval (redraft: commissioner review, kept out of the review-window sweep by a
 * `trade_check_held` audit row; AF trades: `awaiting_commissioner`). Never refused, never lost.
 * A proposal is not held — it is checked again when it is accepted. If the league row itself cannot be
 * read (after one retry) the setting is unknowable, so the default applies.
 * The exception is a roster whose tribe cannot be read while a tribe rule applies: that is refused
 * (SURVIVOR_TRIBE_UNKNOWN), because it is a fact about the league, not a transient failure.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { governanceCopy, dayTimeLabel, crossTribeWindowsLabel } from './survivorGovernanceCopy'
import { judgeSurvivorTrade, playedLockLifted, weekLastGameFinal, type SurvivorTradeRefusalCode } from './survivorTradeRules'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import { isFinalStatus } from '@/lib/social-newsroom/scoreCheck'
import { resolveSurvivorTradeBypass } from './survivorTradeRuleBypass'
// Registers the free-trade-token bypass (A's reward ledger) with the registry above.
import './survivorFreeTradeTokenBypass'

export type SurvivorTradeRuleCheckInput = {
  leagueId: string
  /** Every roster in the trade, in the id space below. */
  rosterIds: string[]
  /** `redraft`: RedraftRoster ids (the redraft trade paths). `league`: League Roster ids (the generic engine). */
  rosterIdSpace: 'redraft' | 'league'
  players: Array<{ playerId: string; playerName?: string | null; fromRosterId: string }>
  now?: Date
}

export type SurvivorTradeRuleCheck =
  | {
      ok: true
      skipped?: 'not_survivor' | 'rules_off' | 'error'
      /**
       * The check could not run and the commissioner chose "hold it": an acceptance path must send the
       * trade to commissioner approval instead of settling it. Proposal paths may ignore it.
       */
      holdForCommissioner?: boolean
      bypassed?: boolean
      /** The trade passes ONLY because of the bypass: whatever settles it must redeem `bypassSource`. */
      bypassRequired?: boolean
      bypassSource?: string | null
      /** The Survivor week the check ran in (the week a token is spent in). */
      week?: number
    }
  | { ok: false; code: SurvivorTradeRefusalCode; message: string; status: 409 }

const MERGED_PHASES = new Set(['merge', 'merging', 'post_merge', 'jury', 'finale', 'complete'])

type HookDb = PrismaClient

export async function checkSurvivorTradeRules(input: SurvivorTradeRuleCheckInput, db: HookDb = prisma): Promise<SurvivorTradeRuleCheck> {
  const now = input.now ?? new Date()
  let league: { survivorMode: boolean | null; settings: unknown; sport: string | null; season: number | null; language: string | null } | null
  const readLeague = () => db.league.findUnique({ where: { id: input.leagueId }, select: { survivorMode: true, settings: true, sport: true, season: true, language: true } })
  try {
    // One retry: the failure-mode setting lives on this row, so without it the default must apply.
    league = await readLeague().catch(() => readLeague())
  } catch (error) {
    console.warn('[survivor-trade-rules] league read failed; trade allowed', { leagueId: input.leagueId, error: error instanceof Error ? error.message : String(error) })
    return { ok: true, skipped: 'error' }
  }
  if (!league?.survivorMode) return { ok: true, skipped: 'not_survivor' }
  const settings = readSurvivorGovernanceSettings(league.settings)
  if (!settings.tradeRulesEnabled) return { ok: true, skipped: 'rules_off' }
  const failed = (error: unknown): SurvivorTradeRuleCheck => {
    const hold = settings.tradeCheckFailureMode === 'hold'
    console.warn(`[survivor-trade-rules] check failed; trade ${hold ? 'held for the commissioner' : 'allowed'}`, { leagueId: input.leagueId, error: error instanceof Error ? error.message : String(error) })
    return hold ? { ok: true, skipped: 'error', holdForCommissioner: true } : { ok: true, skipped: 'error' }
  }

  try {
    const ids = [...new Set(input.rosterIds.filter(Boolean))]
    const rosters = await db.roster.findMany({
      where: input.rosterIdSpace === 'redraft' ? { leagueId: input.leagueId, redraftRosterId: { in: ids } } : { leagueId: input.leagueId, id: { in: ids } },
      select: { id: true, redraftRosterId: true, platformUserId: true },
    })
    const rosterFor = (id: string) => rosters.find((r) => (input.rosterIdSpace === 'redraft' ? r.redraftRosterId === id : r.id === id))
    const players = await db.survivorPlayer.findMany({
      where: { leagueId: input.leagueId, OR: [{ redraftRosterId: { in: rosters.map((r) => r.id) } }, { userId: { in: rosters.map((r) => r.platformUserId).filter(Boolean) } }] },
      select: { userId: true, redraftRosterId: true, tribeId: true },
    })
    const tribeByRoster = new Map<string, string | null>()
    for (const id of ids) {
      const roster = rosterFor(id)
      const player = roster ? players.find((p) => p.redraftRosterId === roster.id) ?? players.find((p) => p.userId === roster.platformUserId) : undefined
      tribeByRoster.set(id, player?.tribeId ?? null)
    }
    const game = await db.survivorGameState.findUnique({ where: { leagueId: input.leagueId }, select: { currentWeek: true, phase: true, mergeTriggeredAt: true } })
    const week = Math.max(0, game?.currentWeek ?? 0)
    const merged = Boolean(game?.mergeTriggeredAt) || MERGED_PHASES.has(String(game?.phase ?? ''))
    const [closedCouncil, openCouncil] = week > 0
      ? await Promise.all([
        db.survivorTribalCouncil.findFirst({ where: { leagueId: input.leagueId, week, closedAt: { not: null } }, select: { id: true } }),
        db.survivorTribalCouncil.findFirst({ where: { leagueId: input.leagueId, week, closedAt: null }, select: { id: true } }),
      ])
      : [null, null]
    const councilDone = Boolean(closedCouncil) && !openCouncil
    // A week with no council (the season plan's no-elimination weeks): the played lock lifts at the
    // week's last final instead of at a Tribal that never comes. Otherwise unchanged.
    const plan = readSurvivorFullSeasonPlan(league.settings)
    const noCouncilThisWeek = Boolean(plan) && week >= (plan?.startWeek ?? 0) && week <= (plan?.endWeek ?? 0) && !plan!.eliminationWeeks.includes(week) && !closedCouncil && !openCouncil
    const weekGamesFinal = !councilDone && noCouncilThisWeek
      ? weekLastGameFinal(
        await db.sportsGame.findMany({ where: { sport: String(league.sport ?? 'NFL').toUpperCase(), season: league.season ?? now.getUTCFullYear(), week, seasonType: 'regular' }, select: { startTime: true, status: true } }),
        now,
        isFinalStatus,
      )
      : null
    const tribalDoneThisWeek = playedLockLifted({ tribalDoneThisWeek: councilDone, noCouncilThisWeek, weekGamesFinal })

    const tradePlayers = await playedStatus(db, {
      players: input.players,
      sport: String(league.sport ?? 'NFL'),
      season: league.season ?? now.getUTCFullYear(),
      week,
      now,
      redraftRosterIdFor: (id) => (input.rosterIdSpace === 'redraft' ? id : rosterFor(id)?.redraftRosterId ?? null),
      needed: !tribalDoneThisWeek && (settings.playedLockUntilTribal || settings.withinTribeUnplayedOnly) && input.players.length > 0 && week > 0,
    })

    const bypass = await resolveSurvivorTradeBypass({
      leagueId: input.leagueId,
      week,
      rosterIds: rosters.map((r) => r.id),
      players: input.players.flatMap((p) => {
        const from = rosterFor(p.fromRosterId)
        return from ? [{ playerId: p.playerId, fromRosterId: from.id }] : []
      }),
    })
    const foundation = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
    const judgeInput = {
      settings,
      clock: { tribalDay: foundation.tribalCouncilDay, tribalTime: foundation.tribalCouncilTime, now },
      merged,
      tribeByRoster,
      players: tradePlayers,
      tribalDoneThisWeek,
    }
    const verdict = judgeSurvivorTrade({ ...judgeInput, bypass: bypass.bypass })
    if (verdict.ok) {
      // A one-time bypass is spent only by a trade that could not have gone through without it.
      const bypassRequired = verdict.bypassed && !judgeSurvivorTrade({ ...judgeInput, bypass: false }).ok
      return { ok: true, bypassed: verdict.bypassed, bypassRequired, bypassSource: bypassRequired ? bypass.source : null, week }
    }
    const m = governanceCopy(league.language)
    const message = verdict.code === 'SURVIVOR_TRADE_FROZEN' ? m.tradeFrozen
      : verdict.code === 'SURVIVOR_CROSS_TRIBE_BANNED' ? m.tradeCrossTribeBanned
        : verdict.code === 'SURVIVOR_CROSS_TRIBE_CLOSED'
          ? (settings.crossTribeWindows.length > 1 || settings.crossTribeWindows[0]?.opensOn === 'time'
            ? m.tradeCrossTribeClosedWindows(crossTribeWindowsLabel(league.language, settings.crossTribeWindows))
            : m.tradeCrossTribeClosed(dayTimeLabel(league.language, settings.crossTribeCloseDay, settings.crossTribeCloseTime)))
          : verdict.code === 'SURVIVOR_PLAYED_LOCK' ? m.tradePlayed(verdict.playerName ?? '')
            : m.tradeTribeUnknown
    return { ok: false, code: verdict.code, message, status: 409 }
  } catch (error) {
    return failed(error)
  }
}

/** Whether each traded player's game this week has kicked off, from the league's own schedule rows. */
async function playedStatus(
  db: HookDb,
  args: {
    players: SurvivorTradeRuleCheckInput['players']
    sport: string
    season: number
    week: number
    now: Date
    redraftRosterIdFor: (id: string) => string | null
    needed: boolean
  },
) {
  if (!args.needed) return args.players.map((p) => ({ ...p, hasPlayed: null }))
  const redraftIds = [...new Set(args.players.map((p) => args.redraftRosterIdFor(p.fromRosterId)).filter((id): id is string => Boolean(id)))]
  const rows = redraftIds.length
    ? await db.redraftRosterPlayer.findMany({ where: { rosterId: { in: redraftIds }, playerId: { in: args.players.map((p) => p.playerId) }, droppedAt: null }, select: { playerId: true, playerName: true, team: true } })
    : []
  const kickoffs = await buildWeekKickoffMap(db, { sport: args.sport, season: args.season, week: args.week })
  return args.players.map((p) => {
    const row = rows.find((r) => r.playerId === p.playerId)
    if (!row?.team) return { ...p, playerName: p.playerName ?? row?.playerName ?? null, hasPlayed: null }
    const kickoff = lockTeamLookupKeys(args.sport, row.team).map((key) => kickoffs.byTeam.get(key)).find((k): k is Date => k != null) ?? null
    return { ...p, playerName: p.playerName ?? row.playerName ?? null, hasPlayed: kickoff ? kickoff.getTime() <= args.now.getTime() : null }
  })
}
