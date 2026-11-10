import 'server-only'

import { prisma } from '@/lib/prisma'
import { getC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { collegePlayerIds } from '@/lib/c2c/campusLineup'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { campusPointsToMarket } from './footballCampusTradeValue'
import type { loadSportPointsBase, SportPointsLeague } from './sportPointsContext'
import { gradeSportDynastyDeal, FULL_SEASON_GAMES, nbaProspectValue, pickDynastyValue, pickLabel, playerDynastyValue, priceSportDynastySides, youngPlayerPool } from './sportDynastyValue'
import { meetsSampleBar, type SportPointsContext } from './sportPointsValue'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'

const collegeId = /^espn:ncaab:(\d+)$/
const playerKey = (asset: TradeAssetInput) => asset.kind === 'player' ? asset.rosterPlayerId ?? asset.playerId ?? '' : ''
const withheld = (reason: string): TradeGradeView => ({ graded: false, reason, basis: null })

/** A real campus board shares the saved roster ids and season with the league. */
export function nbaCampusProduction(ctx: SportPointsContext, held: ReadonlySet<string>) {
  const production = new Map<string, { name: string; perGame: number; dynasty: number | null }>()
  for (const id of held) {
    const raw = collegeId.exec(id)?.[1]
    const player = raw ? ctx.rosterIndex?.get(raw) : undefined
    if (!player || !meetsSampleBar(player)) continue
    const replacement = ctx.replacementByPosition.get(player.position.trim().toUpperCase())
    if (!replacement) continue
    const classYear = ctx.dynasty?.classYears?.get(player.id)
    const dynasty = classYear == null ? null : playerDynastyValue({ sport: 'NCAAB', player, collegeSeasons: 5 - classYear, replacementPerGame: replacement.perGame, gamesRemaining: ctx.window.gamesRemaining })
    production.set(id, { name: player.name, perGame: Math.max(0, player.perGame - replacement.perGame), dynasty })
  }
  return production
}

export function createNbaCampusTradeGrader(league: SportPointsLeague, loadBase: typeof loadSportPointsBase) {
  let configPromise: ReturnType<typeof getC2CConfig> | undefined
  let proPromise: ReturnType<typeof loadBase> | undefined
  let campusPromise: ReturnType<typeof loadBase> | undefined
  let heldPromise: Promise<Set<string>> | undefined

  return async (give: readonly TradeAssetInput[], get: readonly TradeAssetInput[]): Promise<TradeGradeView> => {
    const config = await (configPromise ??= getC2CConfig(league.id))
    if (!config) return withheld('Campus-to-Canton scoring rules are unavailable for this league.')
    const assets = [...give, ...get]
    const onCampus = (asset: TradeAssetInput) => asset.kind === 'pick' ? asset.draftSide === 'campus' : collegeId.test(playerKey(asset))
    const campusCount = assets.filter(onCampus).length
    const picks = assets.filter((asset) => asset.kind === 'pick')
    if (picks.length && (config.mergedRookieCollegeDraft || picks.some((pick) => !pick.draftSide))) {
      return withheld('Specify Campus or Canton. A combined draft needs its own pick curve.')
    }
    if (picks.some((pick) => pick.round > (onCampus(pick) ? config.collegeDraftRounds : config.rookieDraftRounds))) {
      return withheld('A pick’s round exceeds the league’s configured draft rounds.')
    }
    const campusPicks = picks.some(onCampus)
    if (campusPicks && config.standingsModel !== 'separate') {
      return withheld('Campus pick values need measured college and pro outcomes to grade against the combined standings.')
    }
    if (config.standingsModel === 'separate' && campusCount && campusCount !== assets.length) {
      return withheld('This league awards separate Campus and Canton standings. A single letter cannot combine gains across the two divisions.')
    }
    const needPro = campusCount < assets.length || config.standingsModel !== 'separate'
    const [pro, campus, held] = await Promise.all([
      needPro ? (proPromise ??= loadBase({ sport: 'NBA', league: { ...league, leagueType: 'dynasty' } })) : null,
      campusCount ? (campusPromise ??= loadBase({ sport: 'NCAAB', league: { ...league, settings: null, leagueType: 'dynasty' }, campusOnly: true })) : null,
      campusCount ? (heldPromise ??= prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } })
        .then((rows) => new Set(rows.flatMap((row) => [...collegePlayerIds(row.playerData)])))) : new Set<string>(),
    ])
    if (pro && !pro.ok) return withheld(pro.reason)
    const dynasty = pro?.ctx.dynasty
    if (needPro && !dynasty) return withheld('Canton dynasty values are unavailable for this league.')

    const givePro = give.filter((asset) => !onCampus(asset))
    const getPro = get.filter((asset) => !onCampus(asset))
    const proContext = pro?.ok ? { ...pro.ctx, sport: 'NBA' as const } : null
    if (!campusCount) return dynasty && proContext ? gradeSportDynastyDeal({ give, get, ctx: proContext, dynasty }) : withheld('Canton values are unavailable.')
    const proGrade = dynasty && proContext && (givePro.length || getPro.length)
      ? priceSportDynastySides({ give: givePro, get: getPro, ctx: proContext, dynasty }) : null
    if (proGrade && !proGrade.graded) return proGrade
    if (!campus?.ok) return withheld(campus?.reason ?? 'Campus projections are unavailable.')
    if (campus.ctx.window.season !== league.season) return withheld('Campus projections must match the league season.')
    if (config.collegeScoringSystem !== 'points') return withheld('The Campus grading board requires the league’s standard college points rules.')

    const production = nbaCampusProduction(campus.ctx, held)
    const collegeDraft = campus.ctx.dynasty
    const campusPool = campusPicks && collegeDraft ? youngPlayerPool({ ...campus.ctx, sport: 'NCAAB' }, collegeDraft) : []
    const separate = config.standingsModel === 'separate'
    const pool = dynasty && proContext ? youngPlayerPool(proContext, dynasty) : []
    const rate = separate ? 1 : campusPointsToMarket([...production.values()].map((p) => p.perGame), pool, FULL_SEASON_GAMES.NCAAB)
    if (rate == null) return withheld('The league needs more verified Campus projections and NBA prospects to compare both divisions.')
    const proWeight = config.hybridProWeight ?? 60
    if (config.standingsModel === 'hybrid' && (!(proWeight > 0) || proWeight > 100)) return withheld('The league’s hybrid standings weights are unavailable.')
    const weight = config.standingsModel === 'hybrid' ? (100 - proWeight) / proWeight : 1
    const lines = proGrade?.graded ? [...proGrade.lines] : []
    let giveValue = proGrade?.graded ? proGrade.giveTotal : 0
    let getValue = proGrade?.graded ? proGrade.getTotal : 0
    for (const [side, items] of [['give', give], ['get', get]] as const) {
      for (const asset of items.filter(onCampus)) {
        if (asset.kind === 'pick') {
          if (!collegeDraft) return withheld('No verified freshman projections are available for the Campus draft.')
          const price = pickDynastyValue({ sport: 'NCAAB', pick: asset, pool: campusPool, teams: campus.ctx.teams, nextDraftYear: collegeDraft.nextDraftYear })
          if (!price.ok) return withheld(price.reason)
          if (side === 'give') giveValue += price.value
          else getValue += price.value
          lines.push({ side, name: 'Campus ' + pickLabel(asset), marketValue: price.value, leagueValue: price.value, source: 'nba-c2c-campus-pick', valueSource: 'pick_curve', valueAsOf: null })
          continue
        }
        const id = playerKey(asset)
        const college = production.get(id)
        if (!college) return withheld(`A verified Campus projection and replacement level are required for ${asset.kind === 'player' ? asset.name ?? 'this player' : 'this pick'}.`)
        const rank = dynasty?.nbaProspectRanks?.get(id)
        const option = separate ? 0 : rank && dynasty && proContext
          ? nbaProspectValue(rank, { pool, teams: proContext.teams, season: proContext.window.season, nextDraftYear: dynasty.nextDraftYear }) : null
        if (option == null) return withheld(`${college.name} needs a verified NBA pre-draft rank to price the Canton option.`)
        const value = separate ? college.dynasty : college.perGame * campus.ctx.window.gamesRemaining * rate * weight + option
        if (value == null) return withheld(`${college.name} needs a verified college class year for the Campus dynasty horizon.`)
        if (side === 'give') giveValue += value
        else getValue += value
        const line: TradeGradeLine = { side, name: college.name, marketValue: value, leagueValue: value, source: separate ? 'nba-c2c-campus' : 'nba-c2c-campus-and-pro', valueSource: 'sport_projection', valueAsOf: rank?.publishedAt ?? null }
        lines.push(line)
      }
    }
    if (giveValue <= 0 && getValue <= 0) return withheld('The assets on both sides are at replacement level.')
    const basis = separate
      ? 'Campus division estimate from college points over replacement for the remaining eligibility years, with future seasons discounted.' + (campusPicks ? ' Picks use current freshmen as a proxy for future entrants and discount later drafts.' : '')
      : 'Campus-to-Canton estimate. Converts the remaining college production above replacement using the observed college and young NBA boards, applies the league standings weights, and includes the discounted pro option from verified NBA draft ranks.'
    return gradeTrade({
      giveValue: Math.max(0.01, giveValue), getValue: Math.max(0.01, getValue),
      giveMarket: giveValue, getMarket: getValue, unpriced: 0, giveCount: give.length, getCount: get.length,
      basis, scoringApplied: true, needApplied: false, needGap: null, lines, moves: [],
    })
  }
}
