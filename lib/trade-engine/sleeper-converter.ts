// ============================================
// SLEEPER → ASSET[] CONVERTER
// ============================================
// Converts Sleeper API data to trade engine Asset format.

// ============================================
// INPUT TYPES (from Sleeper API)
// ============================================

// ============================================
// HELPER FUNCTIONS
// ============================================

// ============================================
// MAIN CONVERTER
// ============================================

// ============================================
// SLEEPER API HELPERS
// ============================================

export function parseSleeperRosterPositions(positions: string[]): {
  startingQB: number
  startingRB: number
  startingWR: number
  startingTE: number
  startingFlex: number
  startingIDP: number
  benchSlots: number
  superflex: boolean
} {
  const counts = {
    startingQB: 0,
    startingRB: 0,
    startingWR: 0,
    startingTE: 0,
    startingFlex: 0,
    startingIDP: 0,
    benchSlots: 0,
    superflex: false
  }

  for (const pos of positions) {
    const p = pos.toUpperCase()
    switch (p) {
      case 'QB':
        counts.startingQB++
        break
      case 'RB':
        counts.startingRB++
        break
      case 'WR':
        counts.startingWR++
        break
      case 'TE':
        counts.startingTE++
        break
      case 'FLEX':
      case 'REC_FLEX':
        counts.startingFlex++
        break
      case 'SUPER_FLEX':
        counts.superflex = true
        counts.startingFlex++
        break
      case 'BN':
        counts.benchSlots++
        break
      case 'DL':
      case 'LB':
      case 'DB':
      case 'IDP_FLEX':
        counts.startingIDP++
        break
    }
  }

  return counts
}

