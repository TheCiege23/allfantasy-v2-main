// lib/trade-engine/packageBuilder.ts
import type { Asset, LeagueIntelligence, TradeCandidate, TradeEngineOutput } from "./types";
import { type GuardrailsConfig, type GuardrailCandidateDebug, type GuardrailReasonCode } from "./guardrails";

export type OfferBand = "FAIR" | "AGGRESSIVE" | "OVERPAY";

export type OfferBandsConfig = {
  fairPct?: number;
  aggressiveMinPct?: number;
  aggressiveMaxPct?: number;
  overpayMinPct?: number;
  overpayMaxPct?: number;
};

export type BuildPackagesParams = {
  userRosterId: number;
  partnerRosterId: number;
  target: Asset;
  intelligence: LeagueIntelligence;
  constraints?: any;
  bands?: OfferBandsConfig;
  guardrails?: GuardrailsConfig;
  includeGuardrailDebug?: boolean;
};

export type BuiltOfferPackages = {
  target: Asset;
  engineStats: TradeEngineOutput["stats"];
  offers: Partial<Record<OfferBand, TradeCandidate>>;
  notes: string[];
  meta?: {
    tpiByRosterId?: Record<number, number>;
    userTpi?: number;
    partnerTpi?: number;
  };
  debug?: {
    guardrails?: {
      removedCount: number;
      removed?: GuardrailCandidateDebug[];
      summaryByCode?: Record<GuardrailReasonCode, number>;
    };
  };
};

