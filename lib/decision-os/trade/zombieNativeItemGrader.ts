import 'server-only'

import { prisma } from '@/lib/prisma'
import { itemRole } from '@/lib/zombie/beta2025Items'
import { zombieItemId } from '@/lib/zombie/beta2025ItemTrades'
import { gradeInputsFromRedraftAssets } from './tradeGradeInputs'
import { loadZombiePlayerContext, type GuillotineContextResult } from './guillotineContext'
import { gradeTrade, type TradeGradeView } from './tradeGrade'
import { priceZombiePlayerSide } from './zombieValue'
import { zombieItemSwapValue, type ZombieValuationItem } from './zombieItemValue'

type NativeAsset = {
  assetType: string
  fromRosterId: string
  toRosterId: string
  playerId?: string | null
  playerName?: string | null
  metadata?: unknown
}

type NativeProposal = {
  proposerRosterId: string
  receiverRosterId: string
  status: string
  assets: readonly NativeAsset[]
}

const withheld = (reason: string): TradeGradeView => ({ graded: false, reason, basis: null })

/** One read per league list, then one evidence-backed grade per two-team proposal with items. */
export async function createZombieNativeItemGrader(leagueId: string): Promise<{
  grade(proposal: NativeProposal): Promise<TradeGradeView>
}> {
  const [zombie, league, teams, rosterLinks] = await Promise.all([
    prisma.zombieLeague.findUnique({ where: { leagueId }, select: {
      id: true, sport: true, status: true, season: true, currentWeek: true, totalWeeks: true,
      correctionHoldFromWeek: true, experienceMode: true,
    } }),
    prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, settings: true, sport: true, leagueSize: true } }),
    prisma.zombieLeagueTeam.findMany({ where: { leagueId }, include: { items: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, redraftRosterId: true } }),
  ])
  if (!zombie || !league || zombie.sport.toUpperCase() !== 'NFL') {
    return { grade: async () => withheld('Zombie item values require a native NFL Zombie league.') }
  }
  const resolution = await prisma.zombieWeeklyResolution.findUnique({
    where: { zombieLeagueId_week: { zombieLeagueId: zombie.id, week: zombie.currentWeek } },
    select: { status: true },
  })
  const byLegacyRosterId = new Map(teams.map(team => [team.rosterId, team]))
  const byNativeRosterId = new Map(teams.filter(team => team.redraftRosterId).map(team => [team.redraftRosterId!, team]))
  for (const roster of rosterLinks) {
    const team = byLegacyRosterId.get(roster.id)
    if (roster.redraftRosterId && team) byNativeRosterId.set(roster.redraftRosterId, team)
  }
  const zombieCount = teams.filter(team => String(team.status).trim().toLowerCase() === 'zombie').length
  const window = {
    currentWeek: zombie.currentWeek,
    finalWeek: zombie.totalWeeks,
    zombieCount,
    teamCount: teams.length,
    weaponsEnabled: zombie.experienceMode !== 'simple',
  }
  let playerContext: Promise<GuillotineContextResult> | null = null
  const context = () => (playerContext ??= loadZombiePlayerContext({
    id: league.id, settings: league.settings, sport: league.sport, leagueSize: league.leagueSize,
  }).catch((): GuillotineContextResult => ({ ok: false, reason: 'Zombie player projections could not be loaded.' })))

  return {
    async grade(proposal) {
      if (!['active', 'in_progress'].includes(zombie.status)) return withheld('This Zombie season is not active.')
      if (zombie.correctionHoldFromWeek != null) return withheld('A Zombie stat correction is awaiting review, so trade values are held.')
      if (resolution && resolution.status !== 'pending') return withheld('This Zombie week is resolving or awaiting review, so item trades are held.')
      if (window.finalWeek <= window.currentWeek) return withheld('No future Zombie scoring weeks remain for item valuation.')
      const proposer = byNativeRosterId.get(proposal.proposerRosterId)
      const receiver = byNativeRosterId.get(proposal.receiverRosterId)
      if (!proposer || !receiver || proposer.id === receiver.id) return withheld('Both Zombie teams must be identified before item values can be graded.')
      try {
        if (itemRole(proposer.status) === 'Zombie' || itemRole(receiver.status) === 'Zombie') {
          return withheld('A Zombie cannot trade. The current team roles make this proposal ineligible.')
        }
      } catch {
        return withheld('A team’s Zombie role could not be verified.')
      }
      if (proposal.assets.some(asset =>
        !['player', 'zombie_item'].includes(asset.assetType) ||
        ![proposal.proposerRosterId, proposal.receiverRosterId].includes(asset.fromRosterId) ||
        ![proposal.proposerRosterId, proposal.receiverRosterId].includes(asset.toRosterId) ||
        asset.fromRosterId === asset.toRosterId,
      )) return withheld('This proposal has an unsupported asset or participant for Zombie item valuation.')

      const itemAssets = proposal.assets.filter(asset => asset.assetType === 'zombie_item')
      let items: Array<{ id: string; fromRosterId: string; toRosterId: string; item: ZombieValuationItem }>
      try {
        items = itemAssets.map(asset => {
          const id = zombieItemId(asset)
          const sender = byNativeRosterId.get(asset.fromRosterId)!
          const owned = sender.items.find(item => item.id === id)
          if (!owned || owned.zombieLeagueId !== zombie.id) throw new Error('Missing item')
          return { id, fromRosterId: asset.fromRosterId, toRosterId: asset.toRosterId, item: owned }
        })
      } catch {
        return withheld('A traded Zombie item is no longer in the sender’s verified inventory.')
      }
      if (zombie.experienceMode === 'simple' && items.some(({ item }) => item.itemType.startsWith('weapon_'))) {
        return withheld('Weapon trades are disabled in Simple Zombie.')
      }
      if (new Set(items.map(item => item.id)).size !== items.length) return withheld('The same Zombie item appears more than once in this trade.')
      const proposerItems = zombieItemSwapValue({
        owned: proposer.items,
        outgoingIds: items.filter(item => item.fromRosterId === proposal.proposerRosterId).map(item => item.id),
        incoming: items.filter(item => item.toRosterId === proposal.proposerRosterId).map(item => item.item),
        window,
      })
      const receiverItems = zombieItemSwapValue({
        owned: receiver.items,
        outgoingIds: items.filter(item => item.fromRosterId === proposal.receiverRosterId).map(item => item.id),
        incoming: items.filter(item => item.toRosterId === proposal.receiverRosterId).map(item => item.item),
        window,
      })
      if (!proposerItems || !receiverItems) return withheld('Zombie item ownership, activation, or scoring rules could not be verified.')

      const playerAssets = proposal.assets.filter(asset => asset.assetType === 'player')
      const giveInputs = gradeInputsFromRedraftAssets(playerAssets.filter(asset => asset.fromRosterId === proposal.proposerRosterId))
      const getInputs = gradeInputsFromRedraftAssets(playerAssets.filter(asset => asset.toRosterId === proposal.proposerRosterId))
      if (giveInputs.unpriceable.length || getInputs.unpriceable.length) return withheld('A player in this Zombie trade could not be identified.')
      let playerGive = { total: 0, lines: [] as Extract<TradeGradeView, { graded: true }>['lines'] }
      let playerGet = { total: 0, lines: [] as Extract<TradeGradeView, { graded: true }>['lines'] }
      if (playerAssets.length) {
        const loaded = await context()
        if (!loaded.ok) return withheld(loaded.reason)
        const playerWindow = { ...loaded.ctx, weeksLeft: Math.min(loaded.ctx.weeksLeft, Math.max(0, window.finalWeek - window.currentWeek + 1)) }
        const give = priceZombiePlayerSide(giveInputs.assets, 'give', playerWindow)
        const get = priceZombiePlayerSide(getInputs.assets, 'get', playerWindow)
        if ('withheld' in give) return withheld(give.withheld)
        if ('withheld' in get) return withheld(get.withheld)
        playerGive = give
        playerGet = get
      }
      const giveValue = playerGive.total + proposerItems.outgoingCost
      const getValue = playerGet.total + proposerItems.incomingBenefit
      if (giveValue <= 0 && getValue <= 0) return withheld('These players and items have no verified future scoring edge in this Zombie league.')
      const basis = `Zombie · league scoring and free-agent replacement for players; actual team inventory and top-two weapons, bomb suppression, and today's Horde prevalence held constant for item estimates over weeks ${window.currentWeek + 1}–${window.finalWeek}. Infection, revival, loot, cash payouts, and current-week locked item bonuses are not numerically priced.`
      const itemLines = items.map(({ id, item, fromRosterId }) => {
        const fromProposer = fromRosterId === proposal.proposerRosterId
        const value = fromProposer ? proposerItems.outgoingValues.get(id) : proposerItems.incomingValues.get(id)
        return {
          side: fromProposer ? 'give' as const : 'get' as const,
          name: item.itemType.replace('weapon_', '').replaceAll('_', ' '),
          marketValue: value ?? 0, leagueValue: value ?? 0,
          source: 'zombie-item-inventory', valueSource: 'zombie_item' as const,
          valueAsOf: null,
          valueScope: `weeks ${window.currentWeek + 1}–${window.finalWeek}`,
        }
      })
      const grade = gradeTrade({
        giveValue: Math.max(giveValue, 0.01), getValue: Math.max(getValue, 0.01),
        giveMarket: giveValue, getMarket: getValue, unpriced: 0,
        giveCount: proposal.assets.filter(asset => asset.fromRosterId === proposal.proposerRosterId).length,
        getCount: proposal.assets.filter(asset => asset.toRosterId === proposal.proposerRosterId).length,
        basis, scoringApplied: true, needApplied: false, needGap: null,
        lines: [...playerGive.lines, ...playerGet.lines, ...itemLines], moves: [],
      })
      if (!grade.graded) return grade
      const partner = gradeTrade({
        giveValue: Math.max(playerGet.total + receiverItems.outgoingCost, 0.01),
        getValue: Math.max(playerGive.total + receiverItems.incomingBenefit, 0.01),
        giveMarket: playerGet.total + receiverItems.outgoingCost,
        getMarket: playerGive.total + receiverItems.incomingBenefit,
        unpriced: 0, giveCount: proposal.assets.filter(asset => asset.fromRosterId === proposal.receiverRosterId).length,
        getCount: proposal.assets.filter(asset => asset.toRosterId === proposal.receiverRosterId).length,
        basis, scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [],
      })
      return {
        ...grade,
        partnerLetter: partner.graded ? partner.letter : grade.partnerLetter,
        action: 'review',
        recommendation: 'Review infection risk, serum revival, loot, payout rules, and final trade eligibility before accepting. Item values are team-specific future scoring estimates.',
      }
    },
  }
}
