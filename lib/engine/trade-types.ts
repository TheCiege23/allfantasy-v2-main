type TradeConfidenceState = "HIGH" | "MODERATE" | "LEARNING";

type LeagueFormat = "dynasty" | "redraft" | "keeper";
type QbFormat = "1QB" | "superflex";

export type SportKey =
  | "NFL"
  | "NBA"
  | "MLB"
  | "NHL"
  | "NCAAF"
  | "NCAAB"
  | "SOCCER"
  | "GOLF"
  | "NASCAR"
  | "WWE"
  | "AEW"
  | "CRICKET"
  | "CUSTOM";

interface SleeperUserIdentity {
  username: string;
  userId: string;
}

interface LeagueScoringSettings {
  ppr?: number;
  ppCarry?: number;
  ppCompletion?: number;
  sixPtPassTd?: boolean;
  bonusFlags?: Record<string, boolean>;
  tep?: { enabled: boolean; premiumPprBonus?: number };
  qbFormat?: QbFormat;
}

interface LeagueRosterSettings {
  slots?: Record<string, number>;
  limits?: Record<string, number | null>;
}

export interface TradeLeagueContext {
  leagueId: string;
  sport: SportKey;
  format: LeagueFormat;
  season?: number;
  week?: number;
  phase?: string;
  numTeams?: number;
  username?: string;
  platform?: string;
  scoring?: LeagueScoringSettings;
  roster?: LeagueRosterSettings;
  trade?: {
    vetoType?: "none" | "commissioner" | "league_vote";
    tradeDeadlineWeek?: number;
    faabTradable?: boolean;
    faabBudget?: number;
  };
}

export interface TradePlayerAsset {
  id: string;
  name: string;
  pos?: string;
  team?: string;
  age?: number;
  media?: {
    headshotUrl?: string;
    teamLogoUrl?: string;
  };
  league?: "NFL" | "NCAA";
  devyEligible?: boolean;
  graduatedToNFL?: boolean;
  recruitingComposite?: number;
  breakoutAge?: number;
  devyAdp?: number;
  projectedDraftRound?: number;
  projectedDraftPick?: number;
  nilImpactScore?: number;
  injurySeverityScore?: number;
  draftProjectionScore?: number;
}

interface TradePickAsset {
  year: number;
  round: number;
  pickNumber?: number;
  originalOwner?: string;
  projected_range?: string;
}

export type TradeAssetUnion =
  | { type: "player"; player: TradePlayerAsset }
  | { type: "pick"; pick: TradePickAsset }
  | { type: "faab"; faab: { amount: number } };

export type Asset = TradeAssetUnion;

export interface TeamContext {
  rosterId?: string;
  managerName?: string;
  recordOrRank?: string;
  roster: TradePlayerAsset[];
  exposure?: Record<string, number>;
  direction?: "CONTEND" | "REBUILD" | "MIDDLE" | "FRAGILE_CONTEND";
  directionConfidence?: TradeConfidenceState;
}

interface MarketContext {
  ldiByPos?: Record<string, number>;
  partnerTendencies?: Record<
    string,
    {
      overpayByPos?: Record<string, number>;
      discountByPos?: Record<string, number>;
      sampleSize?: number;
      futureFocused?: boolean;
      riskAverse?: boolean;
      pickHoarder?: boolean;
      studChaser?: boolean;
      tradeHistory?: Array<{ timestamp: number; traits: string[] }>;
    }
  >;
  liquidity?: {
    tradesLast30?: number;
    activeManagers?: number;
    totalManagers?: number;
    avgAssetsPerTrade?: number;
  };
}

interface NflContext {
  asOf?: string;
  players?: Record<
    string,
    {
      injuryStatus?: string;
      expectedReturnWeeks?: number;
      role?: string;
      usage?: {
        snapPct?: number;
        targetsPg?: number;
        carriesPg?: number;
        routesPg?: number;
        rzTargetsPg?: number;
        rzCarriesPg?: number;
      };
      trend?: {
        last4Points?: number;
        seasonPoints?: number;
      };
      coachingChange?: boolean;
      depthChartChange?: boolean;
    }
  >;
}

export interface TradeEngineRequest {
  sport: SportKey;
  format: LeagueFormat;
  league_id?: string;
  leagueId?: string;
  sleeper_username_a?: string;
  sleeper_username_b?: string;
  sleeperUserA?: SleeperUserIdentity;
  sleeperUserB?: SleeperUserIdentity;
  leagueContext?: TradeLeagueContext;
  assetsA: TradeAssetUnion[];
  assetsB: TradeAssetUnion[];
  rosterA?: TradePlayerAsset[];
  rosterB?: TradePlayerAsset[];
  marketContext?: MarketContext;
  nflContext?: NflContext;
  teamAName?: string;
  teamBName?: string;
  tradeGoal?: string;
  numTeams?: number;
  newsAdjustments?: Record<
    string,
    { multiplier: number; sentiment: string; reason: string }
  >;
  options?: {
    explainLevel?: "short" | "full";
    counterCount?: number;
    offlineSnapshotOk?: boolean;
    simulateChampionship?: boolean;
  };
}

export interface TradeEngineResponse {
  verdict: "accept" | "reject" | "counter";
  verdictConfidence: "high" | "medium" | "low";
  momentum: {
    direction: "positive" | "negative" | "neutral";
    score: number;
  };
  fairness: {
    score: number;
    delta: number;
    confidence: TradeConfidenceState;
    drivers: { key: string; delta: number; note: string }[];
    explanations: string[];
  };
  leagueAdjusted: {
    delta: number;
    drivers: string[];
  };
  lineupImpact: {
    starterDeltaPts: number;
    note: string;
  };
  risk: {
    injury: number;
    roleStability: number;
    volatility: number;
    notes: string[];
  };
  acceptanceProbability: {
    base: number;
    final: number;
    z: number;
    confidence: TradeConfidenceState;
    buckets: Array<{
      key: string;
      label: string;
      score: number;
      rawDelta: number;
    }>;
    drivers: { key: string; delta: number; note: string }[];
    diagnostics?: {
      ldiBoostRaw: number;
      managerDeltaRaw: number;
      devyDeltaRaw: number;
      inputsValid: boolean;
    };
  };
  counters: Array<{
    label: string;
    changes: Array<Record<string, unknown>>;
    acceptProb: number;
    fairnessScore: number;
    whyTheyAccept: string[];
    whyItHelpsYou: string[];
  }>;
  championshipEquity?: {
    teamA: {
      oddsBefore: number;
      oddsAfter: number;
      delta: number;
    };
    teamB: {
      oddsBefore: number;
      oddsAfter: number;
      delta: number;
    };
    confidence: TradeConfidenceState;
    topReasons: string[];
  };
  multiLegImpact?: {
    yourRankDelta?: number;
    theirRankDelta?: number;
    uninvolvedBeneficiaries?: Array<{ rosterId: string; delta: number }>;
  };
  evidence: {
    leagueContextUsed: boolean;
    nflContextUsed: boolean;
    pricingSources?: Record<string, string>;
    partnerModelUsed: boolean;
    liquidityUsed: boolean;
    devyUsed: boolean;
    scoringNormalized?: boolean;
  };
  meta?: Record<string, unknown>;
  playerAnalytics?: Record<
    string,
    {
      comparablePlayers: string[];
      athleticGrade: { grade: string; score: number; label: string } | null;
      collegeGrade: { grade: string; score: number; label: string } | null;
      combine: {
        fortyYardDash: number | null;
        speedScore: number | null;
        athleticismScore: number | null;
      } | null;
      breakoutAge: number | null;
      weeklyVolatility: number | null;
    }
  >;
  /** Enhanced pipeline output (UTV + multi-factor + risk + team context + log fairness) */
  enhanced?: {
    sideA: Array<{
      name: string; type: string; position?: string
      rawValue: number; riskScore: number; riskAdjustedValue: number
      contextAdjustedValue: number; utv: number; riskLabel: string
      warnings: string[]; confidence: string
    }>
    sideB: Array<{
      name: string; type: string; position?: string
      rawValue: number; riskScore: number; riskAdjustedValue: number
      contextAdjustedValue: number; utv: number; riskLabel: string
      warnings: string[]; confidence: string
    }>
    totalA: number
    totalB: number
    fairness: {
      score: number
      tier: 'balanced' | 'slight_edge' | 'moderate_edge' | 'lopsided'
      favoredSide: 'A' | 'B' | 'even'
      delta: number
      impactDelta: number
      explanations: string[]
    }
    teamContextA: { window: string; needs: string[]; winPct: number; pointsDiff: number; benchStrength: number } | null
    teamContextB: { window: string; needs: string[]; winPct: number; pointsDiff: number; benchStrength: number } | null
    sport: string
    executionMs: number
  } | null
}