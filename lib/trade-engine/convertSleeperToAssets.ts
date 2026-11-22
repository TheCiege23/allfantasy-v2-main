import { Asset } from './types'

interface AssetValueEntry {
  value: number
  marketValue?: number
  impactValue?: number
  vorpValue?: number
  volatility?: number
}

export function convertSleeperToAssets({
  rosters,
  fantasyCalcValues,
  leagueSettings,
}: {
  rosters: any[]
  fantasyCalcValues: Record<string, AssetValueEntry>
  leagueSettings: { isSF: boolean; isTEP: boolean }
}): Record<number, Asset[]> {
  const out: Record<number, Asset[]> = {}

  for (const r of rosters) {
    out[r.rosterId] = []

    for (const p of r.players) {
      const fc = fantasyCalcValues[p.name]
      const value = fc?.value ?? 0

      const isCornerstone =
        (p.pos === 'QB' && leagueSettings.isSF && value > 7500) ||
        (p.pos === 'TE' && leagueSettings.isTEP && value > 6500) ||
        (['RB', 'WR'].includes(p.pos) && value > 9000)

      out[r.rosterId].push({
        id: p.id,
        type: 'PLAYER',
        name: p.name,
        pos: p.pos,
        team: p.team,
        slot: p.slot,
        value,
        marketValue: fc?.marketValue ?? value,
        impactValue: fc?.impactValue ?? 0,
        vorpValue: fc?.vorpValue ?? 0,
        volatility: fc?.volatility ?? 0.2,
        isIdp: p.isIdp,
        age: p.age,
        isCornerstone,
        cornerstoneReason: isCornerstone ? 'Elite positional asset' : undefined,
      })
    }
  }

  return out
}
