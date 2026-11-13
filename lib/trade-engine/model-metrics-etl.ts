type LeagueClass = 'DYN' | 'RED' | 'SPC' | 'UNK'

export function leagueClassFromLegacy(l?: {
  leagueType?: string | null
  specialtyFormat?: string | null
}): LeagueClass {
  const lt = (l?.leagueType ?? '').toLowerCase()
  const sfmt = (l?.specialtyFormat ?? '').toLowerCase()
  if (sfmt && sfmt !== 'standard') return 'SPC'
  if (lt.includes('dyn')) return 'DYN'
  if (lt.includes('red')) return 'RED'
  return 'UNK'
}

export function buildSegmentKey(x: {
  isSF: boolean | null
  isTEP: boolean | null
  teamCount: number | null
  opponentTradeSampleSize: number | null
  leagueClass: LeagueClass
}): string {
  const fmt = x.isSF ? 'SF' : '1QB'
  const tep = x.isTEP ? 'TEP' : 'NONTEP'

  const sz = x.teamCount ?? 0
  const sizeBucket =
    sz >= 14 ? 'SZ14P' :
    sz === 12 ? 'SZ12' :
    sz === 10 ? 'SZ10' :
    sz > 0 ? `SZ${sz}` : 'SZUNK'

  const n = x.opponentTradeSampleSize ?? 0
  const hist =
    n >= 10 ? 'H10P' :
    n >= 3 ? 'H3_9' :
    'H0_2'

  return `${x.leagueClass}_${fmt}_${tep}_${sizeBucket}_${hist}`
}

export type BucketStats = {
  bucketCount: number[]
  bucketMeanPred: number[]
  bucketMeanObs: number[]
}

export const EDGES_X = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]
export const EDGES_MARKET_PCT = [-50, -25, -15, -10, -5, 0, 5, 10, 15, 25, 50]
export const EDGES_PPG_DELTA = [-10, -5, -2, -1, 0, 1, 2, 5, 10]

