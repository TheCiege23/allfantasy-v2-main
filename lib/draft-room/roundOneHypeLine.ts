import { tOr } from '@/lib/i18n/tInterpolate'

/**
 * The one-line hype under a Round 1 pick announcement. Position copy per sport (the overlay used
 * to know only football, so every NBA and NHL pick read "Opening statement pick locked in."),
 * plus the island's first torch for a Survivor draft.
 *
 * `t` is optional: with it each line is looked up under `draftRoom.roundOne.hype.*`, and the English
 * below is the fallback, so a caller without a language provider gets exactly the old text.
 */
export function roundOneHypeLine(
  input: { sport?: string | null; position?: string | null; formatType?: string | null },
  t?: (key: string) => string,
): string {
  const sport = String(input.sport ?? '').trim().toUpperCase()
  const pos = String(input.position ?? '').trim().toUpperCase()
  const survivor = String(input.formatType ?? '').trim().toLowerCase() === 'survivor'
  const tr = (key: string, english: string) => tOr(t ?? ((k) => k), key, english)
  const line = sportLine(sport, pos, tr)
  return survivor ? `${line} ${tr('draftRoom.roundOne.hype.survivorTorch', 'The first torch on the island is lit.')}` : line
}

function sportLine(sport: string, pos: string, tr: (key: string, english: string) => string): string {
  if (sport === 'NBA') {
    if (pos === 'PG' || pos === 'SG' || pos === 'G') return tr('draftRoom.roundOne.hype.nbaGuard', 'A floor general takes the first spotlight.')
    if (pos === 'SF' || pos === 'PF' || pos === 'F') return tr('draftRoom.roundOne.hype.nbaWing', 'A wing with star upside is off the board.')
    if (pos === 'C') return tr('draftRoom.roundOne.hype.nbaCenter', 'Anchoring the paint from pick one.')
    return tr('draftRoom.roundOne.hype.default', 'Opening statement pick locked in.')
  }
  if (sport === 'NHL') {
    if (pos === 'C') return tr('draftRoom.roundOne.hype.nhlCenter', 'A top-line center, first off the board.')
    if (pos === 'LW' || pos === 'RW' || pos === 'W') return tr('draftRoom.roundOne.hype.nhlWing', 'A sniper on the wing opens the draft.')
    if (pos === 'D') return tr('draftRoom.roundOne.hype.nhlDefense', 'A franchise blueliner goes early.')
    if (pos === 'G') return tr('draftRoom.roundOne.hype.nhlGoalie', 'A starting goalie before anyone blinks.')
    return tr('draftRoom.roundOne.hype.default', 'Opening statement pick locked in.')
  }
  if (sport === 'MLB') {
    if (pos === 'SP' || pos === 'RP' || pos === 'P') return tr('draftRoom.roundOne.hype.mlbPitcher', 'An ace takes the mound in Round 1.')
    if (pos) return tr('draftRoom.roundOne.hype.mlbHitter', 'A lineup cornerstone is locked in.')
    return tr('draftRoom.roundOne.hype.default', 'Opening statement pick locked in.')
  }
  // Football (NFL, NCAAF) and the default.
  if (pos === 'QB') return tr('draftRoom.roundOne.hype.qb', 'Commanding the board early with a field general.')
  if (pos === 'RB') return tr('draftRoom.roundOne.hype.rb', 'Ground game priority set for the draft room.')
  if (pos === 'WR') return tr('draftRoom.roundOne.hype.wr', 'A high-upside target just came off the board.')
  if (pos === 'TE') return tr('draftRoom.roundOne.hype.te', 'Securing a mismatch creator in Round 1.')
  return tr('draftRoom.roundOne.hype.default', 'Opening statement pick locked in.')
}
