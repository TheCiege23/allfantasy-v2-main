import { PricedAsset } from './hybrid-valuation';

export interface VolatilityCoefficients {
  [key: string]: number;
}

const POSITION_VOLATILITY: VolatilityCoefficients = {
  'QB_YOUNG': 0.7,
  'QB_PRIME': 0.75,
  'QB_AGING': 1.2,
  'RB': 1.3,
  'RB_YOUNG': 1.1,
  'RB_AGING': 1.5,
  'WR_ELITE': 0.8,
  'WR_YOUNG': 0.85,
  'WR_AGING': 1.1,
  'TE_ELITE': 0.75,
  'TE': 0.9,
  'PICK_1ST_EARLY': 0.9,
  'PICK_1ST_MID': 0.95,
  'PICK_1ST_LATE': 1.0,
  'PICK_2ND': 1.1,
  'PICK_3RD': 1.15,
  'PICK_FUTURE': 1.2,
  'DEFAULT': 1.0,
};

export function getAssetVolatility(asset: PricedAsset, age?: number): number {
  if (asset.type === 'pick') {
    const round = asset.details?.round ?? 1;
    const tier = asset.details?.tier?.toLowerCase() ?? '';
    const year = asset.details?.year ?? new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const isFuture = year > currentYear;
    
    if (isFuture) return POSITION_VOLATILITY['PICK_FUTURE'];
    if (round === 1) {
      if (tier.includes('early')) return POSITION_VOLATILITY['PICK_1ST_EARLY'];
      if (tier.includes('late')) return POSITION_VOLATILITY['PICK_1ST_LATE'];
      return POSITION_VOLATILITY['PICK_1ST_MID'];
    }
    if (round === 2) return POSITION_VOLATILITY['PICK_2ND'];
    return POSITION_VOLATILITY['PICK_3RD'];
  }

  const name = asset.name.toLowerCase();
  const isElite = asset.value > 6000;
  const isYoung = age !== undefined && age < 26;
  const isAging = age !== undefined && age > 29;

  if (name.includes('qb') || isQBName(asset.name)) {
    if (isAging) return POSITION_VOLATILITY['QB_AGING'];
    if (isYoung) return POSITION_VOLATILITY['QB_YOUNG'];
    return POSITION_VOLATILITY['QB_PRIME'];
  }

  if (name.includes('rb') || isRBName(asset.name)) {
    if (isAging) return POSITION_VOLATILITY['RB_AGING'];
    if (isYoung) return POSITION_VOLATILITY['RB_YOUNG'];
    return POSITION_VOLATILITY['RB'];
  }

  if (name.includes('wr') || isWRName(asset.name)) {
    if (isElite) return POSITION_VOLATILITY['WR_ELITE'];
    if (isAging) return POSITION_VOLATILITY['WR_AGING'];
    return POSITION_VOLATILITY['WR_YOUNG'];
  }

  if (name.includes('te') || isTEName(asset.name)) {
    if (isElite) return POSITION_VOLATILITY['TE_ELITE'];
    return POSITION_VOLATILITY['TE'];
  }

  return POSITION_VOLATILITY['DEFAULT'];
}

function isQBName(name: string): boolean {
  const qbs = ['mahomes', 'allen', 'burrow', 'herbert', 'stroud', 'lamar', 'hurts', 'jackson', 'dak', 'prescott'];
  return qbs.some(qb => name.toLowerCase().includes(qb));
}

function isRBName(name: string): boolean {
  const rbs = ['taylor', 'henry', 'barkley', 'chubb', 'mccaffrey', 'cook', 'kamara', 'swift'];
  return rbs.some(rb => name.toLowerCase().includes(rb));
}

function isWRName(name: string): boolean {
  const wrs = ['hill', 'chase', 'jefferson', 'lamb', 'diggs', 'adams', 'brown', 'olave', 'waddle'];
  return wrs.some(wr => name.toLowerCase().includes(wr));
}

function isTEName(name: string): boolean {
  const tes = ['kelce', 'andrews', 'kittle', 'hockenson', 'pitts', 'goedert'];
  return tes.some(te => name.toLowerCase().includes(te));
}

export function computeTradeVolatility(assets: PricedAsset[]): number {
  if (assets.length === 0) return 0;
  
  const weightedVolatilities = assets.map(a => ({
    value: a.value,
    vol: getAssetVolatility(a)
  }));
  
  const totalValue = weightedVolatilities.reduce((sum, w) => sum + w.value, 0);
  if (totalValue === 0) return 1.0;
  
  const weightedAvg = weightedVolatilities.reduce((sum, w) => 
    sum + (w.value / totalValue) * w.vol, 0);
  
  const variance = weightedVolatilities.reduce((sum, w) => 
    sum + (w.value / totalValue) * Math.pow(w.vol - weightedAvg, 2), 0);
  
  const stdDev = Math.sqrt(variance);
  
  return weightedAvg + stdDev;
}

export function getVolatilityLabel(score: number): 'Low' | 'Medium' | 'High' {
  if (score < 0.9) return 'Low';
  if (score < 1.1) return 'Medium';
  return 'High';
}

export function adjustConfidenceForVolatility(
  baseConfidence: number,
  volatilityScore: number,
  deltaValue: number
): { 
  adjustedConfidence: number; 
  volatilityLabel: string;
  explanation: string;
} {
  const volLabel = getVolatilityLabel(volatilityScore);
  let adjustment = 0;
  let explanation = '';

  if (volLabel === 'High') {
    adjustment = deltaValue < 0 ? -0.15 : -0.08;
    explanation = 'Outcome depended on volatile asset performance';
  } else if (volLabel === 'Low') {
    adjustment = deltaValue > 0 ? 0.08 : 0.03;
    explanation = 'Trade involved stable, predictable assets';
  } else {
    adjustment = 0;
    explanation = 'Trade had moderate risk profile';
  }

  const adjustedConfidence = Math.max(0.15, Math.min(0.95, baseConfidence + adjustment));

  return {
    adjustedConfidence,
    volatilityLabel: volLabel,
    explanation
  };
}
