export type GuardrailReasonCode =
  | "GR_DISABLED"
  | "GR_STRONG_TEAM_GAIN_LIMIT"
  | "GR_WEAK_TEAM_ANTI_REBUILD"
  | "GR_NO_RECEIVE_TOTAL";

export type GuardrailsConfig = {
  enabled?: boolean;
  strongTeamDelta1?: number;
  strongTeamDelta2?: number;
  maxPartnerGainAtDelta1?: number;
  maxPartnerGainAtDelta2?: number;
  protectWeakTeams?: boolean;
  weakTeamTpiThreshold?: number;
  agingVetAge?: number;
  youthAge?: number;
  maxWeakTeamOverpayRatio?: number;
  includeReasonCodes?: boolean;
};

export type GuardrailCandidateDebug = {
  tradeId: string;
  codes: GuardrailReasonCode[];
  details?: Record<string, any>;
};

