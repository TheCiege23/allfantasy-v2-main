interface AcceptanceBucket {
  key: string;
  label: string;
  score: number;
  rawDelta: number;
}

interface AcceptanceDriver {
  key: string;
  delta: number;
  note: string;
}

interface AcceptanceOutput {
  base: number;
  final: number;
  z: number;
  confidence: 'HIGH' | 'MODERATE' | 'LEARNING';
  buckets: AcceptanceBucket[];
  drivers: AcceptanceDriver[];
  diagnostics?: {
    ldiBoostRaw: number;
    managerDeltaRaw: number;
    devyDeltaRaw: number;
    inputsValid: boolean;
  };
}

interface AcceptanceInput {
  fairnessScore: number;
  needsFitScore: number;
  volatilityDelta: number;
  tradeCount?: number;
  ldi?: Record<string, number>;
  offeredPlayers?: Array<{
    position: string;
    isDevy?: boolean;
    draftProjectionScore?: number;
    breakoutAge?: number;
    injurySeverityScore?: number;
  }>;
  isSuperFlex?: boolean;
  managerProfile?: {
    futureFocused?: boolean;
    riskAverse?: boolean;
    pickHoarder?: boolean;
    studChaser?: boolean;
    tradeHistory?: Array<{ timestamp: number; traits: string[] }>;
  };
}

const W_FAIRNESS  = 0.9;
const W_NEEDS     = 0.7;
const W_VOL       = -0.6;

const LDI_HIGH_THRESHOLD = 65;
const LDI_LOW_THRESHOLD  = 40;
const LDI_HIGH_DELTA     = 0.04;
const LDI_LOW_DELTA      = -0.02;
const LDI_MAX_BOOST      = 0.15;
const LDI_MIN_BOOST      = -0.10;

const POSITION_LDI_WEIGHT: Record<string, number> = {
  QB: 0.8,
  QB_SF: 1.4,
  RB: 1.2,
  WR: 1.0,
  TE: 1.1,
};

const MGR_FUTURE_FOCUSED = 0.05;
const MGR_RISK_AVERSE    = -0.05;
const MGR_PICK_HOARDER   = 0.04;
const MGR_STUD_CHASER    = 0.03;

const DEVY_PROJECTION_THRESHOLD = 85;
const DEVY_BREAKOUT_AGE_MAX     = 20;
const DEVY_INJURY_THRESHOLD     = 70;
const DEVY_PROJECTION_DELTA     = 0.06;
const DEVY_BREAKOUT_DELTA       = 0.03;
const DEVY_INJURY_DELTA         = -0.07;
const DEVY_MAX_BONUS_PER_PLAYER = 0.08;

const CONFIDENCE_HIGH     = 10;
const CONFIDENCE_MODERATE = 6;

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const RECENCY_TRAIT_THRESHOLD = 1.0;
const RECENCY_STRONG_THRESHOLD = 2.5;

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalize(score: number): number {
  const raw = (score - 50) / 50;
  return clamp(raw, -1, 1);
}

function validateInputs(input: AcceptanceInput): boolean {
  const { fairnessScore, needsFitScore, volatilityDelta } = input;

  if (
    typeof fairnessScore !== 'number' || isNaN(fairnessScore) ||
    typeof needsFitScore !== 'number' || isNaN(needsFitScore) ||
    typeof volatilityDelta !== 'number' || isNaN(volatilityDelta)
  ) {
    console.error('[acceptance] Invalid inputs:', { fairnessScore, needsFitScore, volatilityDelta });
    return false;
  }

  return true;
}

function applyConfidenceCalibration(
  base: number,
  confidence: 'HIGH' | 'MODERATE' | 'LEARNING'
): number {
  switch (confidence) {
    case 'HIGH':
      return base;
    case 'MODERATE':
      return base + (0.50 - base) * 0.15;
    case 'LEARNING':
      return base + (0.50 - base) * 0.35;
  }
}

function getConfidenceTier(tradeCount: number): 'HIGH' | 'MODERATE' | 'LEARNING' {
  if (tradeCount >= CONFIDENCE_HIGH)     return 'HIGH';
  if (tradeCount >= CONFIDENCE_MODERATE) return 'MODERATE';
  return 'LEARNING';
}

function applyTradeRecencyDecay(
  trades: Array<{ timestamp: number; traits: string[] }>,
  currentTimestamp: number
): Record<string, number> {
  const weights: Record<string, number> = {};

  for (const trade of trades) {
    const age = Math.max(0, currentTimestamp - trade.timestamp);
    const decay = Math.exp(-0.693 * age / RECENCY_HALF_LIFE_MS);

    for (const trait of trade.traits) {
      weights[trait] = (weights[trait] ?? 0) + decay;
    }
  }

  return weights;
}

function getPositionLdiWeight(position: string, isSuperFlex: boolean): number {
  if (position === 'QB' && isSuperFlex) return POSITION_LDI_WEIGHT['QB_SF'];
  return POSITION_LDI_WEIGHT[position] ?? 1.0;
}

function computeLDIBoost(
  offeredPlayers: AcceptanceInput['offeredPlayers'],
  ldi: Record<string, number>,
  isSuperFlex: boolean
): { boost: number; drivers: AcceptanceDriver[] } {
  if (!offeredPlayers?.length || !ldi) return { boost: 0, drivers: [] };

  let raw = 0;
  const drivers: AcceptanceDriver[] = [];

  for (const player of offeredPlayers) {
    if (player.isDevy) continue;
    const pos = player.position?.toUpperCase() ?? '';
    const posLdi = ldi[pos] ?? 50;
    const posWeight = getPositionLdiWeight(pos, isSuperFlex);

    if (posLdi >= LDI_HIGH_THRESHOLD) {
      const weightedDelta = LDI_HIGH_DELTA * posWeight;
      raw += weightedDelta;
      drivers.push({
        key: `ldi_high_${player.position}`,
        delta: weightedDelta,
        note: `High league demand for ${player.position} (LDI: ${posLdi}, weight: ${posWeight.toFixed(1)}x)`,
      });
    } else if (posLdi <= LDI_LOW_THRESHOLD) {
      const weightedDelta = LDI_LOW_DELTA * posWeight;
      raw += weightedDelta;
      drivers.push({
        key: `ldi_low_${player.position}`,
        delta: weightedDelta,
        note: `Low league demand for ${player.position} (LDI: ${posLdi}, weight: ${posWeight.toFixed(1)}x)`,
      });
    }
  }

  const boost = clamp(raw, LDI_MIN_BOOST, LDI_MAX_BOOST);

  if (raw !== boost) {
    console.warn(`[acceptance] LDI boost clamped: raw=${raw.toFixed(3)}, clamped=${boost.toFixed(3)}`);
  }

  return { boost, drivers };
}

function computeManagerDelta(
  profile: AcceptanceInput['managerProfile'],
  confidence: 'HIGH' | 'MODERATE' | 'LEARNING'
): { delta: number; drivers: AcceptanceDriver[] } {
  if (!profile) return { delta: 0, drivers: [] };

  const confidenceScale: Record<string, number> = {
    HIGH: 1.0,
    MODERATE: 0.5,
    LEARNING: 0.0,
  };
  const scale = confidenceScale[confidence];

  const recencyWeights = profile.tradeHistory?.length
    ? applyTradeRecencyDecay(profile.tradeHistory, Date.now())
    : {};

  const traitMap: Record<string, { flag: boolean | undefined; baseDelta: number; key: string; note: string }> = {
    futureFocused: { flag: profile.futureFocused, baseDelta: MGR_FUTURE_FOCUSED, key: 'mgr_future', note: 'Manager prefers future-focused trades' },
    riskAverse:    { flag: profile.riskAverse,    baseDelta: MGR_RISK_AVERSE,    key: 'mgr_risk',   note: 'Manager avoids risky assets' },
    pickHoarder:   { flag: profile.pickHoarder,   baseDelta: MGR_PICK_HOARDER,   key: 'mgr_picks',  note: 'Manager values picks highly' },
    studChaser:    { flag: profile.studChaser,     baseDelta: MGR_STUD_CHASER,    key: 'mgr_stud',   note: 'Manager chases proven studs' },
  };

  let delta = 0;
  const drivers: AcceptanceDriver[] = [];

  for (const [trait, cfg] of Object.entries(traitMap)) {
    const recencyWeight = recencyWeights[trait] ?? 0;
    const hasRecencySignal = recencyWeight >= RECENCY_TRAIT_THRESHOLD;
    const hasStrongRecency = recencyWeight >= RECENCY_STRONG_THRESHOLD;

    if (!cfg.flag && !hasRecencySignal) continue;

    let multiplier = 1.0;
    let source = 'profile';
    if (!cfg.flag) {
      multiplier = 0.7;
      source = 'recent trades';
    } else if (hasStrongRecency) {
      multiplier = Math.min(1.5, 1.0 + (recencyWeight - RECENCY_TRAIT_THRESHOLD) * 0.2);
      source = 'profile + recent trades';
    }

    const d = cfg.baseDelta * scale * multiplier;
    delta += d;
    drivers.push({ key: cfg.key, delta: d, note: `${cfg.note} (${source})` });
  }

  return { delta, drivers };
}

function computeDevyDelta(
  offeredPlayers: AcceptanceInput['offeredPlayers']
): { delta: number; drivers: AcceptanceDriver[] } {
  const devyPlayers = offeredPlayers?.filter(p => p.isDevy) ?? [];
  if (!devyPlayers.length) return { delta: 0, drivers: [] };

  let delta = 0;
  const drivers: AcceptanceDriver[] = [];

  for (const player of devyPlayers) {
    let playerBonus = 0;
    const playerDrivers: AcceptanceDriver[] = [];

    if ((player.draftProjectionScore ?? 0) >= DEVY_PROJECTION_THRESHOLD) {
      playerBonus += DEVY_PROJECTION_DELTA;
      playerDrivers.push({
        key: 'devy_projection',
        delta: DEVY_PROJECTION_DELTA,
        note: `High draft projection score (${player.draftProjectionScore})`,
      });
    }

    if ((player.breakoutAge ?? 99) <= DEVY_BREAKOUT_AGE_MAX) {
      playerBonus += DEVY_BREAKOUT_DELTA;
      playerDrivers.push({
        key: 'devy_breakout',
        delta: DEVY_BREAKOUT_DELTA,
        note: `Early breakout age (${player.breakoutAge})`,
      });
    }

    if ((player.injurySeverityScore ?? 0) > DEVY_INJURY_THRESHOLD) {
      playerBonus += DEVY_INJURY_DELTA;
      playerDrivers.push({
        key: 'devy_injury',
        delta: DEVY_INJURY_DELTA,
        note: `High injury severity (${player.injurySeverityScore})`,
      });
    }

    const cappedBonus = clamp(playerBonus, -0.10, DEVY_MAX_BONUS_PER_PLAYER);
    delta += cappedBonus;
    drivers.push(...playerDrivers);
  }

  return { delta, drivers };
}

function buildBuckets(
  fairnessNorm: number,
  needsNorm: number,
  volNorm: number,
  ldiBoost: number,
  managerDelta: number,
  devyDelta: number
): AcceptanceBucket[] {
  const toScore = (contribution: number): number =>
    clamp(Math.round(50 + contribution * 50), 0, 100);

  return [
    {
      key: 'fairness',
      label: 'Trade Fairness',
      score: toScore(W_FAIRNESS * fairnessNorm),
      rawDelta: W_FAIRNESS * fairnessNorm,
    },
    {
      key: 'needs_fit',
      label: 'Team Needs Fit',
      score: toScore(W_NEEDS * needsNorm),
      rawDelta: W_NEEDS * needsNorm,
    },
    {
      key: 'volatility',
      label: 'Risk Profile',
      score: toScore(W_VOL * volNorm),
      rawDelta: W_VOL * volNorm,
    },
    {
      key: 'ldi',
      label: 'League Demand',
      score: toScore(ldiBoost * 3),
      rawDelta: ldiBoost,
    },
    {
      key: 'manager',
      label: 'Manager Tendencies',
      score: toScore(managerDelta * 5),
      rawDelta: managerDelta,
    },
    {
      key: 'devy',
      label: 'Devy Signals',
      score: toScore(devyDelta * 5),
      rawDelta: devyDelta,
    },
  ];
}

export function computeAcceptanceProbability(
  input: AcceptanceInput
): AcceptanceOutput {
  const inputsValid = validateInputs(input);

  if (!inputsValid) {
    return {
      base: 0.50,
      final: 0.50,
      z: 0,
      confidence: 'LEARNING',
      buckets: [],
      drivers: [],
      diagnostics: {
        ldiBoostRaw: 0,
        managerDeltaRaw: 0,
        devyDeltaRaw: 0,
        inputsValid: false,
      },
    };
  }

  const {
    fairnessScore,
    needsFitScore,
    volatilityDelta,
    tradeCount = 0,
    ldi = {},
    offeredPlayers = [],
    isSuperFlex = false,
    managerProfile,
  } = input;

  const fairnessNorm = normalize(fairnessScore);
  const needsNorm    = normalize(needsFitScore);
  const volNorm      = normalize(volatilityDelta);

  const confidence = getConfidenceTier(tradeCount);

  const { boost: ldiBoost, drivers: ldiDrivers }       = computeLDIBoost(offeredPlayers, ldi, isSuperFlex);
  const { delta: managerDelta, drivers: managerDrivers } = computeManagerDelta(managerProfile, confidence);
  const { delta: devyDelta, drivers: devyDrivers }       = computeDevyDelta(offeredPlayers);

  const z =
    W_FAIRNESS * fairnessNorm +
    W_NEEDS    * needsNorm +
    W_VOL      * volNorm +
    ldiBoost +
    managerDelta +
    devyDelta;

  if (process.env.NODE_ENV === 'development') {
    console.debug('[acceptance] z breakdown:', {
      fairness:  (W_FAIRNESS * fairnessNorm).toFixed(3),
      needs:     (W_NEEDS * needsNorm).toFixed(3),
      vol:       (W_VOL * volNorm).toFixed(3),
      ldi:       ldiBoost.toFixed(3),
      manager:   managerDelta.toFixed(3),
      devy:      devyDelta.toFixed(3),
      total_z:   z.toFixed(3),
    });
  }

  const base = clamp(sigmoid(z), 0.01, 0.99);
  const final = clamp(applyConfidenceCalibration(base, confidence), 0.01, 0.99);

  const allDrivers: AcceptanceDriver[] = [
    {
      key: 'fairness',
      delta: W_FAIRNESS * fairnessNorm,
      note: `Fairness score: ${fairnessScore}/100`,
    },
    {
      key: 'needs_fit',
      delta: W_NEEDS * needsNorm,
      note: `Needs fit score: ${needsFitScore}/100`,
    },
    {
      key: 'volatility',
      delta: W_VOL * volNorm,
      note: `Volatility delta: ${volatilityDelta}/100`,
    },
    ...ldiDrivers,
    ...managerDrivers,
    ...devyDrivers,
  ];

  const topDrivers = [...allDrivers]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const buckets = buildBuckets(
    fairnessNorm,
    needsNorm,
    volNorm,
    ldiBoost,
    managerDelta,
    devyDelta
  );

  return {
    base,
    final,
    z,
    confidence,
    buckets,
    drivers: topDrivers,
    diagnostics: {
      ldiBoostRaw: ldiBoost,
      managerDeltaRaw: managerDelta,
      devyDeltaRaw: devyDelta,
      inputsValid: true,
    },
  };
}

