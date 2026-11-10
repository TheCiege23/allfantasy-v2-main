import 'server-only'

import { prisma } from '@/lib/prisma'
import { keeperCostsBySleeperId, measureKeeperCostRule } from '@/lib/keeper/importedKeeperCost'
import { roundCostOnChart } from '@/lib/keeper/tradeKeeperCosts'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import type { LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import { loadFootballCampusTradeEvidence } from './footballCampusTradeValue'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'

type Asset = Extract<TradeAssetInput, { kind: 'player' }>
type Cost = { eligible: boolean; round: number | null; free: boolean }
type Contract = { playerId: string; salary: number; yearSigned: number; yearsTotal: number; source: string }
type ChartPlayer = { id: string; name: string; value: number }
type League = { id: string; platform?: string | null; season?: number | null; type: string }

const NEXT_SEASON_DISCOUNT = 0.85
const MIN_AUCTION_ANCHORS = 5
const ACTIVE_CONTRACTS = ['active', 'tagged', 'option_exercised']

const withheld = (reason: string, basis: string | null): TradeGradeView => ({ graded: false, reason, basis })

function chartPlayers(chart: LeagueTradeChart): ChartPlayer[] {
  return chart.fcPlayers.flatMap(({ player, value }) =>
    player.sleeperId && player.position !== 'PICK' && Number.isFinite(value) && value >= 0
      ? [{ id: player.sleeperId, name: player.name, value }]
      : [])
}

function sleeperId(asset: Asset, line: TradeGradeLine, chart: readonly ChartPlayer[], platform: string | null | undefined): string | null {
  const explicit = asset.providerIdentity?.provider === 'sleeper' ? asset.providerIdentity.id
    : platform === 'sleeper' || !platform || platform === 'native' || platform === 'allfantasy'
      ? asset.rosterPlayerId?.replace(/^sleeper:/, '') : null
  if (explicit) return explicit
  const matches = chart.filter((p) => playerNamesAgree(p.name, line.name))
  const ids = new Set(matches.map((p) => p.id))
  return ids.size === 1 ? matches[0]!.id : null
}

async function loadKeeperCosts(league: League): Promise<Map<string, Cost>> {
  if (league.platform === 'sleeper') {
    const picks = await prisma.draftFact.findMany({
      where: { leagueId: league.id, season: { lte: league.season ?? undefined, not: null } },
      select: { playerId: true, season: true, round: true, metadata: true },
    })
    const facts = picks.flatMap((p) => p.season == null ? [] : [{
      ...p, season: p.season, isKeeper: (p.metadata as { isKeeper?: boolean } | null)?.isKeeper === true,
    }])
    const rule = measureKeeperCostRule(facts)
    if (rule.season !== league.season) return new Map()
    return new Map([...keeperCostsBySleeperId(facts, rule)].map(([id, row]) => [id, { eligible: true, round: row.costRound, free: false }]))
  }
  if (!league.season) return new Map()
  const rows = await prisma.keeperEligibility.findMany({
    where: { leagueId: league.id, season: { season: league.season } },
    select: { playerId: true, isEligible: true, projectedCostRound: true, projectedCost: true },
  })
  const out = new Map<string, Cost>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const id = row.playerId.replace(/^sleeper:/, '')
    if (out.has(id)) duplicates.add(id)
    out.set(id, { eligible: row.isEligible, round: row.projectedCostRound, free: row.projectedCost === 'Free' })
  }
  for (const id of duplicates) out.delete(id)
  return out
}

function presentSalary(contract: Contract, season: number): number {
  const years = contract.yearSigned + contract.yearsTotal - season
  return contract.salary * (1 - NEXT_SEASON_DISCOUNT ** years) / (1 - NEXT_SEASON_DISCOUNT)
}

function auctionRate(rows: readonly Contract[], chart: readonly ChartPlayer[], season: number): number | null {
  const players = new Map(chart.map((p) => [p.id, p.value]))
  const rates = rows.flatMap((r) => {
    const value = players.get(r.playerId) ?? 0
    return r.source === 'startup_auction' && r.yearSigned === season && r.salary > 0 && value > 0
      ? [presentSalary(r, season) / value] : []
  }).sort((a, b) => a - b)
  if (rates.length < MIN_AUCTION_ANCHORS) return null
  const mid = Math.floor(rates.length / 2)
  return (rates[mid]! + rates[Math.floor((rates.length - 1) / 2)]!) / 2
}

async function loadContracts(league: League, season: number): Promise<Map<string, Contract>> {
  const rows = await prisma.playerContract.findMany({
    where: { leagueId: league.id, status: { in: ACTIVE_CONTRACTS }, yearSigned: { lte: season } },
    select: { playerId: true, salary: true, yearSigned: true, yearsTotal: true, source: true },
  })
  const out = new Map<string, Contract>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    if (row.yearSigned + row.yearsTotal <= season || row.salary < 0) continue
    const id = row.playerId.replace(/^sleeper:/, '')
    if (out.has(id)) duplicates.add(id)
    out.set(id, { ...row, playerId: id })
  }
  for (const id of duplicates) out.delete(id)
  return out
}

function withFormatValues(view: Extract<TradeGradeView, { graded: true }>, lines: TradeGradeLine[], note: string): TradeGradeView {
  const sum = (side: TradeGradeLine['side']) => lines.reduce((total, line) => total + (line.side === side ? line.leagueValue ?? 0 : 0), 0)
  const give = sum('give')
  const get = sum('get')
  if (give === 0 && get === 0) return withheld('Neither side has positive value after the league’s costs.', note)
  return gradeTrade({
    giveValue: Math.max(0.01, give), getValue: Math.max(0.01, get),
    giveMarket: view.giveMarket, getMarket: view.getMarket, unpriced: 0,
    giveCount: lines.filter((line) => line.side === 'give').length,
    getCount: lines.filter((line) => line.side === 'get').length,
    basis: note, scoringApplied: view.scoringApplied, needApplied: false, needGap: null, lines, moves: [],
  })
}

/** Same league economics for the shared grader and the console. Memoized for a batch of proposals. */
export function createFootballTradeFormatGrader(league: League, loadCampus = loadFootballCampusTradeEvidence, loadConfig = getC2CConfig) {
  if (league.type !== 'keeper' && league.type !== 'salary_cap' && league.type !== 'c2c') return null
  let keeperCosts: ReturnType<typeof loadKeeperCosts> | undefined
  let contracts: ReturnType<typeof loadContracts> | undefined
  let campus: ReturnType<typeof loadCampus> | undefined
  let config: ReturnType<typeof loadConfig> | undefined

  return async (view: TradeGradeView, chart: LeagueTradeChart, assets: readonly TradeAssetInput[], dated = false): Promise<TradeGradeView> => {
    if (!view.graded) return view
    if (league.type === 'c2c') {
      const picks = assets.filter((asset) => asset.kind === 'pick')
      if (picks.length) {
        const settings = await (config ??= loadConfig(league.id).catch(() => null))
        if (dated || !settings || settings.mergedRookieCollegeDraft || picks.some((pick) => pick.draftSide !== 'canton' || pick.round > settings.rookieDraftRounds)) {
          return withheld('This trade needs a verified Canton pick in a separate rookie draft. Campus and combined drafts need their own pricing evidence.', view.basis)
        }
      }
      if (!view.lines.some((line) => line.valueSource === 'devy_option')) return view
      if (dated || assets.length !== view.lines.length) return withheld('The trade-date Campus-to-Canton values could not be verified.', view.basis)
      const evidence = await (campus ??= loadCampus(league, chart).catch(() => null))
      if (!evidence) return withheld('College production and pro upside do not have enough measured inputs for a common value scale in this Campus-to-Canton league.', view.basis)
      if (evidence.separate && view.lines.some((line) => line.valueSource !== 'devy_option')) {
        return withheld('Separate Campus and Canton standings do not share a value scale. Compare assets in one division at a time.', view.basis)
      }
      const lines: TradeGradeLine[] = []
      for (const [i, line] of view.lines.entries()) {
        if (line.valueSource !== 'devy_option') { lines.push(line); continue }
        const asset = assets[i]
        const value = asset?.kind === 'player' ? evidence.price(asset, line) : null
        if (value == null) return withheld('A verified campus projection or replacement level is missing for ' + line.name + '.', view.basis)
        lines.push({ ...line, leagueValue: value, source: evidence.separate ? 'c2c-campus' : 'c2c-campus-and-pro' })
      }
      if (evidence.separate) return withFormatValues(view, lines, 'Campus division estimate from college points over replacement for the remaining ' + evidence.weeks + ' weeks.')
      return withFormatValues(view, lines, 'Campus-to-Canton estimate. Adds projected college points above replacement for the remaining ' + evidence.weeks + ' weeks of ' + evidence.season + ', converted to one season of pro market value using the two observed boards and the league standings weights. Also includes the discounted pro option.')
    }
    if (dated) return withheld('The league’s trade-date keeper or contract terms are unavailable.', view.basis)
    if (!league.season) return withheld('The league season is needed to price its keeper or contract terms.', view.basis)
    const season = league.season
    const players = chartPlayers(chart)
    if (assets.length !== view.lines.length) return withheld('The trade assets could not be matched to the league’s cost records.', view.basis)
    try {
      if (league.type === 'keeper') {
        const costs = await (keeperCosts ??= loadKeeperCosts(league))
        const values = players.map((p) => p.value).sort((a, b) => b - a)
        const lines: TradeGradeLine[] = []
        for (const [i, asset] of assets.entries()) {
          const line = view.lines[i]!
          if (asset.kind !== 'player') return withheld('Keeper draft picks and FAAB cannot be priced on the keeper option scale.', view.basis)
          const id = sleeperId(asset, line, players, league.platform)
          const cost = id ? costs.get(id) : undefined
          const costValue = cost?.eligible === false || cost?.free ? 0
            : cost?.round != null ? roundCostOnChart(cost.round, chart.leagueSize, values) : null
          if (costValue == null || line.marketValue == null || line.leagueValue == null) {
            return withheld('A verified keeper cost is missing for ' + line.name + '.', view.basis)
          }
          const premium = cost?.eligible ? Math.max(0, line.marketValue - costValue) * NEXT_SEASON_DISCOUNT : 0
          lines.push({ ...line, leagueValue: line.leagueValue + premium })
        }
        return withFormatValues(view, lines, 'Current player values plus a one-season keeper option at 85% of positive surplus. Round costs use the middle pick of that round on the league’s full draft chart.')
      }

      const active = await (contracts ??= loadContracts(league, season))
      const rate = auctionRate([...active.values()], players, season)
      if (rate == null) return withheld('Too few current-season startup auction contracts match the league chart to estimate the cost of cap space.', view.basis)
      const lines: TradeGradeLine[] = []
      for (const [i, asset] of assets.entries()) {
        const line = view.lines[i]!
        if (asset.kind !== 'player') return withheld('Draft picks and FAAB do not have measured cap costs.', view.basis)
        const id = sleeperId(asset, line, players, league.platform)
        const contract = id ? active.get(id) : undefined
        if (!contract || line.leagueValue == null) return withheld('An active contract is missing for ' + line.name + '.', view.basis)
        lines.push({ ...line, leagueValue: Math.max(0, line.leagueValue - presentSalary(contract, season) / rate) })
      }
      return withFormatValues(view, lines, 'Salary-cap surplus estimated from this season’s startup auction and league chart. Remaining salary is discounted at 85% per season and surplus floors at zero.')
    } catch {
      return withheld('The league’s keeper or contract terms could not be read just now.', view.basis)
    }
  }
}
