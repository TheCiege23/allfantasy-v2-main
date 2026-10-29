/**
 * The one-line hype under a Round 1 pick announcement. Position copy per sport (the overlay used
 * to know only football, so every NBA and NHL pick read "Opening statement pick locked in."),
 * plus the island's first torch for a Survivor draft.
 */
export function roundOneHypeLine(input: { sport?: string | null; position?: string | null; formatType?: string | null }): string {
  const sport = String(input.sport ?? '').trim().toUpperCase()
  const pos = String(input.position ?? '').trim().toUpperCase()
  const survivor = String(input.formatType ?? '').trim().toLowerCase() === 'survivor'
  const line = sportLine(sport, pos)
  return survivor ? `${line} The first torch on the island is lit.` : line
}

function sportLine(sport: string, pos: string): string {
  if (sport === 'NBA') {
    if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'A floor general takes the first spotlight.'
    if (pos === 'SF' || pos === 'PF' || pos === 'F') return 'A wing with star upside is off the board.'
    if (pos === 'C') return 'Anchoring the paint from pick one.'
    return 'Opening statement pick locked in.'
  }
  if (sport === 'NHL') {
    if (pos === 'C') return 'A top-line center, first off the board.'
    if (pos === 'LW' || pos === 'RW' || pos === 'W') return 'A sniper on the wing opens the draft.'
    if (pos === 'D') return 'A franchise blueliner goes early.'
    if (pos === 'G') return 'A starting goalie before anyone blinks.'
    return 'Opening statement pick locked in.'
  }
  if (sport === 'MLB') {
    if (pos === 'SP' || pos === 'RP' || pos === 'P') return 'An ace takes the mound in Round 1.'
    if (pos) return 'A lineup cornerstone is locked in.'
    return 'Opening statement pick locked in.'
  }
  // Football (NFL, NCAAF) and the default.
  if (pos === 'QB') return 'Commanding the board early with a field general.'
  if (pos === 'RB') return 'Ground game priority set for the draft room.'
  if (pos === 'WR') return 'A high-upside target just came off the board.'
  if (pos === 'TE') return 'Securing a mismatch creator in Round 1.'
  return 'Opening statement pick locked in.'
}
