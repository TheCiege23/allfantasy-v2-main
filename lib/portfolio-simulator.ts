export interface PortfolioAsset {
  type: 'NFL' | 'DEVY' | 'PICK'
  name?: string
  position?: string
  age?: number
  value?: number
  draftProjectionScore?: number
  projectedDraftRound?: number
  injurySeverityScore?: number
  pickRound?: number
  pickYear?: number
}

interface PortfolioSimResult {
  projectedValue: number
  volatilityBand: number
  year1: number
  year3: number
  year5: number
  assetBreakdown: {
    nflValue: number
    devyValue: number
    pickValue: number
  }
}

function ageCurve(age: number, position: string, yearsOut: number): number {
  const futureAge = age + yearsOut
  if (position === 'RB') {
    if (futureAge <= 23) return 1.05
    if (futureAge <= 25) return 1.0
    if (futureAge <= 27) return 0.85
    if (futureAge <= 29) return 0.65
    return 0.4
  }
  if (position === 'WR') {
    if (futureAge <= 24) return 1.05
    if (futureAge <= 27) return 1.0
    if (futureAge <= 30) return 0.90
    if (futureAge <= 32) return 0.75
    return 0.55
  }
  if (position === 'QB') {
    if (futureAge <= 28) return 1.05
    if (futureAge <= 34) return 1.0
    if (futureAge <= 37) return 0.85
    return 0.6
  }
  if (position === 'TE') {
    if (futureAge <= 25) return 1.0
    if (futureAge <= 28) return 1.05
    if (futureAge <= 31) return 0.9
    return 0.65
  }
  return 1.0
}

function devyGradProb(projectedRound: number | undefined): number {
  if (!projectedRound) return 0.3
  if (projectedRound === 1) return 0.9
  if (projectedRound === 2) return 0.75
  if (projectedRound === 3) return 0.6
  return 0.4
}

function injuryVolatility(severity: number | undefined): number {
  if (!severity || severity <= 0) return 0
  return severity * 3
}

export function simulatePortfolio(assets: PortfolioAsset[], years = 5): PortfolioSimResult {
  let nflValue = 0
  let devyValue = 0
  let pickValue = 0
  let volatility = 0

  const yearSnapshots: number[] = []

  for (let y = 0; y <= years; y++) {
    let yearTotal = 0

    for (const asset of assets) {
      if (asset.type === 'NFL') {
        const baseVal = asset.value ?? 50
        const pos = asset.position || 'WR'
        const age = asset.age ?? 24
        const curve = ageCurve(age, pos, y)
        const val = baseVal * curve
        yearTotal += val

        if (y === 0) {
          nflValue += val
          volatility += injuryVolatility(asset.injurySeverityScore)
        }
      }

      if (asset.type === 'DEVY') {
        const gradProb = devyGradProb(asset.projectedDraftRound)
        const dps = asset.draftProjectionScore ?? 50
        const graduationYear = Math.max(1, (asset.projectedDraftRound ?? 3) <= 2 ? 1 : 2)

        if (y >= graduationYear) {
          const nflAge = 22 + y - graduationYear
          const pos = asset.position || 'WR'
          const curve = ageCurve(nflAge, pos, 0)
          yearTotal += gradProb * dps * curve
        } else {
          yearTotal += dps * 0.5
        }

        if (y === 0) {
          devyValue += gradProb * dps
          volatility += (1 - gradProb) * 15
          volatility += injuryVolatility(asset.injurySeverityScore)
        }
      }

      if (asset.type === 'PICK') {
        const round = asset.pickRound ?? 2
        const basePickVal = round === 1 ? 100 : round === 2 ? 65 : round === 3 ? 40 : 20
        const pickYear = asset.pickYear ?? new Date().getFullYear() + 1
        const currentYear = new Date().getFullYear()
        const yearsUntilPick = Math.max(0, pickYear - currentYear - y)

        if (yearsUntilPick <= 0) {
          yearTotal += basePickVal * 0.7
        } else {
          yearTotal += basePickVal * 0.9
        }

        if (y === 0) {
          pickValue += basePickVal
          volatility += 5
        }
      }
    }

    yearSnapshots.push(Math.round(yearTotal))
  }

  return {
    projectedValue: yearSnapshots[0] || 0,
    volatilityBand: Math.min(50, Math.round(volatility)),
    year1: yearSnapshots[1] || yearSnapshots[0] || 0,
    year3: yearSnapshots[3] || yearSnapshots[Math.min(years, 2)] || 0,
    year5: yearSnapshots[5] || yearSnapshots[years] || 0,
    assetBreakdown: {
      nflValue: Math.round(nflValue),
      devyValue: Math.round(devyValue),
      pickValue: Math.round(pickValue),
    },
  }
}
