import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSalaryCapConfig } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { validateTradeCap } from '@/lib/salary-cap/SalaryCapTradeValidator'
import type { TradeCapImpact } from '@/lib/salary-cap/types'
import { resolveViewerLeagueRoster } from '@/lib/trade-intel/viewerLeagueRoster'
import type { TradeAssetInput } from './types'

export type ProposalCapResult =
  | { status: 'not_applicable' }
  | { status: 'unavailable'; reason: string }
  | { status: 'evaluated'; legal: boolean; impact: TradeCapImpact;
      contracts: Array<{ side: 'give' | 'get'; name: string; salary: number; expires: number }> }

type CapEvaluator = (give: TradeAssetInput[], get: TradeAssetInput[]) => Promise<ProposalCapResult>
const unavailable = (reason: string): ProposalCapResult => ({ status: 'unavailable', reason })

/** Called after league membership validation. Resolve team identities once for the proposal and counters.
 * Contract IDs/salaries come exclusively from stored, owned contracts, never from the browser. */
export async function prepareProposalCap(args: {
  leagueId: string; userId: string; opponentTeamExternalId?: string | null; requiresCap?: boolean
}): Promise<CapEvaluator> {
  try {
    const config = await getSalaryCapConfig(args.leagueId)
    if (!config) return args.requiresCap
      ? async () => unavailable('This league is marked Salary Cap, but its contract rules have not been configured or imported.')
      : async () => ({ status: 'not_applicable' })
    const missing = (reason: string): CapEvaluator => async () => unavailable(reason)
    if (!config.configId) return missing('Persist salary-cap rules before checking this proposal.')
    if (!args.opponentTeamExternalId) return missing('Select the other team to check both teams’ cap commitments.')
    const viewer = await resolveViewerLeagueRoster(args.leagueId, args.userId)
    const [yourTeam, theirTeam, nativeRoster] = await Promise.all([
      prisma.leagueTeam.findFirst({ where: { leagueId: args.leagueId,
        ...(viewer.ok ? { platformUserId: viewer.team.platformUserId } : { claimedByUserId: args.userId }) },
        select: { id: true, externalId: true, platformUserId: true } }),
      prisma.leagueTeam.findFirst({ where: { leagueId: args.leagueId, externalId: args.opponentTeamExternalId },
        select: { id: true, externalId: true, platformUserId: true } }),
      prisma.roster.findFirst({ where: { leagueId: args.leagueId, platformUserId: args.userId },
        orderBy: { updatedAt: 'desc' }, select: { id: true, platformUserId: true } }),
    ])
    if (!theirTeam || (!yourTeam && !nativeRoster && !viewer.ok)) return missing('Both teams must be linked to this league before checking cap commitments.')
    const otherRoster = theirTeam.platformUserId ? await prisma.roster.findFirst({
      where: { leagueId: args.leagueId, platformUserId: theirTeam.platformUserId },
      orderBy: { updatedAt: 'desc' }, select: { id: true, platformUserId: true },
    }) : null
    const aliases = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))]
    const yours = aliases([yourTeam?.id, yourTeam?.externalId, yourTeam?.platformUserId,
      nativeRoster?.id, nativeRoster?.platformUserId, viewer.ok ? viewer.roster.id : null])
    const theirs = aliases([theirTeam.id, theirTeam.externalId, theirTeam.platformUserId, otherRoster?.id])
    if (yours.some(id => theirs.includes(id))) return missing('The two team identities overlap; resolve the league’s roster links first.')
    const contracts = await prisma.playerContract.findMany({ where: { leagueId: args.leagueId,
      configId: config.configId, rosterId: { in: [...yours, ...theirs] } },
      select: { id: true, rosterId: true, playerId: true, playerName: true, salary: true,
        yearSigned: true, yearsTotal: true, status: true } })
    // Multiple contract namespaces for one team can indicate a duplicate import. Never sum or guess.
    const rosterKey = (ids: string[], fallback: string | undefined) => {
      const stored = [...new Set(contracts.filter(c => ids.includes(c.rosterId)).map(c => c.rosterId))]
      return stored.length === 1 ? stored[0] : stored.length === 0 ? fallback : undefined
    }
    const from = rosterKey(yours, nativeRoster?.id ?? (viewer.ok ? viewer.roster.id : yourTeam?.id))
    const to = rosterKey(theirs, otherRoster?.id ?? theirTeam.id)
    if (!from || !to) return missing('Contracts use ambiguous roster identities; repair the league import before evaluating cap legality.')
    const year = config.season ?? new Date().getFullYear()
    return async (give, get) => {
      try {
        const selected: Array<{ side: 'give' | 'get'; contract: typeof contracts[number] }> = []
        for (const [side, assets, rosterId] of [['give', give, from], ['get', get, to]] as const) {
          for (const asset of assets) {
            if (asset.kind === 'pick') continue // Unsigned rookie contracts are not current commitments.
            if (asset.kind === 'faab') return unavailable('FAAB does not represent salary-cap cash. Cash trades need explicit league rules before cap evaluation.')
            const owned = contracts.filter(c => c.rosterId === rosterId
              && ['active', 'tagged', 'option_exercised'].includes(c.status)
              && c.yearSigned <= year && c.yearSigned + c.yearsTotal > year)
            const byId = asset.playerId ? owned.filter(c => c.playerId === asset.playerId) : []
            const byName = asset.name ? owned.filter(c => c.playerName?.trim().toLowerCase() === asset.name!.trim().toLowerCase()) : []
            const matches = byId.length ? byId : byName
            if (matches.length !== 1 || (byId.length && asset.name && matches[0].playerName
              && matches[0].playerName.trim().toLowerCase() !== asset.name.trim().toLowerCase())) {
              return unavailable(`Cannot identify one owned, unexpired contract for ${asset.name ?? asset.playerId ?? 'this player'}.`)
            }
            selected.push({ side, contract: matches[0] })
          }
        }
        const moving = (side: 'give' | 'get') => selected.filter(c => c.side === side).map(({ contract: c }) => ({ contractId: c.id, playerId: c.playerId, salary: c.salary }))
        const impact = await validateTradeCap(args.leagueId, { fromRosterId: from, toRosterId: to,
          movingToReceiver: moving('give'), movingToSender: moving('get') })
        if (!impact.years?.length) return unavailable(impact.errors.join(' ') || 'Cap commitments could not be verified.')
        return { status: 'evaluated', legal: impact.fromFutureLegal && impact.toFutureLegal, impact,
          contracts: selected.map(({ side, contract: c }) => ({ side, name: c.playerName ?? c.playerId,
            salary: c.salary, expires: c.yearSigned + c.yearsTotal - 1 })) }
      } catch { return unavailable('Cap data could not be loaded. Re-analyze before accepting a salary-cap trade.') }
    }
  } catch { return async () => unavailable('Cap rules could not be loaded; affordability has not been verified.') }
}

export function proposalCapNote(result: ProposalCapResult): string | null {
  if (result.status === 'not_applicable') return null
  if (result.status === 'unavailable') return `Salary-cap check unavailable: ${result.reason}`
  const failed = result.impact.years?.find(y => !y.fromLegal || !y.toLegal)
  return result.legal
    ? 'Both teams satisfy configured cap and floor rules across the recorded commitment years. Unsigned future acquisitions are not funded by this check.'
    : `This package fails configured cap or floor rules${failed ? ` in ${failed.capYear} for ${!failed.fromLegal && !failed.toLegal ? 'both teams' : !failed.fromLegal ? 'your team' : 'the other team'}` : ''}. Value balance does not establish affordability.`
}
