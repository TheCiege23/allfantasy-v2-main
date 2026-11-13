// lib/trade-engine/ai-assist-orchestrator.ts
import type { TradeCandidate } from "./types";

export type AiProviderMode = "off" | "openai" | "grok" | "both";

export type AssistSnapshotLike = {
  league?: any;
  profilesByRosterId?: Record<number, any>;
  [k: string]: any;
};

export type RunAssistOptions = {
  mode?: AiProviderMode;

  snapshot?: AssistSnapshotLike;
  userRosterId: number;

  trades?: TradeCandidate[];

  openai?: {
    enabled?: boolean;
  };

  grok?: {
    enabled?: boolean;
    maxCandidates?: number;
    concurrency?: number;
    leagueMeta?: {
      leagueName?: string;
      format?: "dynasty" | "redraft";
      superflex?: boolean;
      tep?: boolean;
      idp?: boolean;
    };
  };

  includeNotes?: boolean;
};

