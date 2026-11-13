import { PricedAsset, pricePlayer, pricePick, ValuationContext, UserTrade, TradeDelta, PickInput } from './hybrid-valuation';

interface AlternativeOption {
  label: string;
  assets: PricedAsset[];
  totalValue: number;
  deltaImprovement: number;
  type: 'player_swap' | 'pick_package' | 'mixed';
}

export interface AlternativesResult {
  originalDelta: number;
  originalGrade: string;
  alternatives: AlternativeOption[];
  bestAlternative: AlternativeOption | null;
}

interface PickPackage {
  label: string;
  picks: PickInput[];
}

const PICK_PACKAGES: PickPackage[] = [
  { label: '2025 1st', picks: [{ year: 2025, round: 1, tier: 'mid' }] },
  { label: '2025 1st + 3rd', picks: [{ year: 2025, round: 1, tier: 'mid' }, { year: 2025, round: 3, tier: 'mid' }] },
  { label: '2025 2nd + 2026 1st', picks: [{ year: 2025, round: 2, tier: 'mid' }, { year: 2026, round: 1, tier: 'mid' }] },
  { label: '2026 1st + 2026 2nd', picks: [{ year: 2026, round: 1, tier: 'mid' }, { year: 2026, round: 2, tier: 'mid' }] },
  { label: '2026 1st + 3rd', picks: [{ year: 2026, round: 1, tier: 'mid' }, { year: 2026, round: 3, tier: 'mid' }] },
];

const COMPARABLE_PLAYERS: Record<string, string[]> = {
  'WR': ['Ja\'Marr Chase', 'Justin Jefferson', 'Tyreek Hill', 'CeeDee Lamb', 'Davante Adams', 'Stefon Diggs', 'Chris Olave', 'Jaylen Waddle', 'AJ Brown', 'Amon-Ra St. Brown'],
  'QB': ['Patrick Mahomes', 'Josh Allen', 'Joe Burrow', 'Justin Herbert', 'Lamar Jackson', 'Jalen Hurts', 'CJ Stroud', 'Dak Prescott'],
  'RB': ['Jonathan Taylor', 'Christian McCaffrey', 'Saquon Barkley', 'Derrick Henry', 'Nick Chubb', 'Dalvin Cook', 'Breece Hall', 'Bijan Robinson'],
  'TE': ['Travis Kelce', 'Mark Andrews', 'TJ Hockenson', 'Kyle Pitts', 'George Kittle', 'Dallas Goedert'],
};

function getComparablePlayers(position: string | undefined): string[] {
  if (!position) return [];
  const pos = position.toUpperCase();
  return COMPARABLE_PLAYERS[pos] || [];
}

export async function generateAlternatives(
  trade: UserTrade,
  userId: string,
  tradeDelta: TradeDelta,
  ctx: ValuationContext
): Promise<AlternativesResult> {
  const alternatives: AlternativeOption[] = [];
  
  // Try exact match first, then fallback to first party (user is typically first)
  let userParty = trade.parties.find(p => p.userId === userId);
  let otherParty = trade.parties.find(p => p.userId !== userId);
  
  // Fallback: if no exact match, assume user is first party in the array
  if (!userParty && trade.parties.length >= 2) {
    console.log(`[trade-alternatives] No exact userId match for ${userId}, falling back to first party`);
    userParty = trade.parties[0];
    otherParty = trade.parties[1];
  }
  
  if (!userParty || !otherParty) {
    console.log(`[trade-alternatives] Cannot identify parties. userId=${userId}, parties=${JSON.stringify(trade.parties.map(p => p.userId))}`);
    return {
      originalDelta: tradeDelta.deltaValue,
      originalGrade: tradeDelta.grade,
      alternatives: [],
      bestAlternative: null
    };
  }

  const gaveAssets = tradeDelta.gaveAssets;
  const gaveValue = tradeDelta.userGaveValue;
  
  for (const gaveAsset of gaveAssets) {
    if (gaveAsset.type !== 'player') continue;
    
    const targetValue = gaveAsset.value;
    const tolerance = targetValue * 0.15;
    
    const playerPosition = otherParty.playersReceived.find(
      p => p.name.toLowerCase() === gaveAsset.name.toLowerCase()
    )?.position;
    
    const comparables = getComparablePlayers(playerPosition);
    
    for (const altName of comparables) {
      if (altName.toLowerCase() === gaveAsset.name.toLowerCase()) continue;
      
      const pricedAlt = await pricePlayer(altName, ctx);
      const valueDiff = Math.abs(pricedAlt.value - targetValue);
      
      if (valueDiff > tolerance) continue;
      
      const newReceivedValue = tradeDelta.userReceivedValue - gaveAsset.value + pricedAlt.value;
      const newDelta = newReceivedValue - (gaveValue - gaveAsset.value);
      const improvement = newDelta - tradeDelta.deltaValue;
      
      if (improvement > 100) {
        alternatives.push({
          label: `Trade for ${altName} instead`,
          assets: [pricedAlt],
          totalValue: pricedAlt.value,
          deltaImprovement: improvement,
          type: 'player_swap'
        });
      }
    }
  }

  for (const pkg of PICK_PACKAGES) {
    const pricedPicks: PricedAsset[] = [];
    let packageValue = 0;
    
    for (const pick of pkg.picks) {
      const pricedPick = await pricePick(pick, ctx);
      pricedPicks.push(pricedPick);
      packageValue += pricedPick.value;
    }
    
    const valueDiff = Math.abs(packageValue - gaveValue);
    if (valueDiff <= gaveValue * 0.2) {
      const newDelta = packageValue - gaveValue + tradeDelta.deltaValue;
      const improvement = newDelta - tradeDelta.deltaValue;
      
      if (improvement > 50) {
        alternatives.push({
          label: `Trade for ${pkg.label}`,
          assets: pricedPicks,
          totalValue: packageValue,
          deltaImprovement: improvement,
          type: 'pick_package'
        });
      }
    }
  }

  alternatives.sort((a, b) => b.deltaImprovement - a.deltaImprovement);
  const topAlternatives = alternatives.slice(0, 5);

  return {
    originalDelta: tradeDelta.deltaValue,
    originalGrade: tradeDelta.grade,
    alternatives: topAlternatives,
    bestAlternative: topAlternatives.length > 0 ? topAlternatives[0] : null
  };
}
