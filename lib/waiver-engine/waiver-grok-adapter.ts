// lib/waiver-engine/waiver-grok-adapter.ts
import type { WaiverSuggestion, WaiverPlayerRef } from "./waiver-types";
import { runGrokAssistOnWaiverSuggestions } from "./grok-waiver-ai-layer";

type PlayerLookup = (playerNameOrId: string) => Partial<WaiverPlayerRef> | null | undefined;

type WaiverGrokAdapterOptions = {
  enabled?: boolean;
  lookupPlayer?: PlayerLookup;
  leagueMeta?: {
    leagueName?: string;
    format?: "dynasty" | "redraft" | string;
    superflex?: boolean;
    tep?: boolean;
    idp?: boolean;
  };
  teamContextNotes?: string[];
  maxSuggestions?: number;
  concurrency?: number;
};

type AnyObj = Record<string, any>;

function asString(v: any): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function splitReasoningToBullets(text?: string): string[] | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;

  const rawParts =
    t.includes("\n")
      ? t.split("\n")
      : t.includes("•")
        ? t.split("•")
        : t.includes("- ")
          ? t.split("- ")
          : [t];

  const parts = rawParts
    .map((s) => s.replace(/^[-•\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((s) => s.slice(0, 220));

  return parts.length ? parts : undefined;
}

function buildSuggestionId(raw: AnyObj, idx: number): string {
  return (
    asString(raw?.id) ||
    asString(raw?.suggestion_id) ||
    asString(raw?.key) ||
    asString(raw?.player_id) ||
    asString(raw?.player_name) ||
    `waiver_suggestion_${idx}`
  );
}

function buildAddRef(raw: AnyObj, lookup?: PlayerLookup): WaiverPlayerRef | undefined {
  const playerId = asString(raw?.player_id) || asString(raw?.id);
  const playerName = asString(raw?.player_name) || asString(raw?.name);

  const lookupKey = playerId || playerName;
  const looked = lookupKey && lookup ? lookup(lookupKey) : null;

  return {
    id: playerId || undefined,
    name: playerName || looked?.name || undefined,
    pos: asString(raw?.pos) || asString(raw?.position) || looked?.pos || undefined,
    team: asString(raw?.team) || looked?.team || undefined,
    tags: Array.isArray(raw?.tags)
      ? raw.tags.filter((x: any) => typeof x === "string").slice(0, 12)
      : Array.isArray(looked?.tags)
        ? looked!.tags
        : undefined,
  };
}

function mapRawSuggestionToWaiverSuggestion(raw: AnyObj, idx: number, lookupPlayer?: PlayerLookup): WaiverSuggestion {
  const tier = asString(raw?.tier);
  const reasoning = asString(raw?.reasoning) || asString(raw?.rationale) || asString(raw?.explanation);

  const reasons = [
    ...(tier ? [`Tier: ${tier}`] : []),
    ...(splitReasoningToBullets(reasoning) ?? []),
  ];

  return {
    id: buildSuggestionId(raw, idx),
    add: buildAddRef(raw, lookupPlayer),
    reasons: reasons.length ? reasons : undefined,
  };
}

export async function enrichRawWaiverSuggestionsWithGrok<T extends AnyObj>(
  rawSuggestions: T[],
  opts: WaiverGrokAdapterOptions
): Promise<{
  suggestions: Array<T & { ai?: WaiverSuggestion["ai"] }>;
  grok: { enriched: number; attempted: number; notes: string[] };
}> {
  const mapped: WaiverSuggestion[] = (rawSuggestions || []).map((s, idx) =>
    mapRawSuggestionToWaiverSuggestion(s, idx, opts.lookupPlayer)
  );

  const grokRes = await runGrokAssistOnWaiverSuggestions(mapped, {
    enabled: opts.enabled,
    maxSuggestions: opts.maxSuggestions,
    concurrency: opts.concurrency,
    leagueMeta: opts.leagueMeta,
    teamContextNotes: opts.teamContextNotes,
  });

  const out = (rawSuggestions || []).map((raw, idx) => {
    const ai = grokRes.suggestions?.[idx]?.ai;
    if (!ai) return raw as T & { ai?: WaiverSuggestion["ai"] };
    return { ...(raw as any), ai } as T & { ai?: WaiverSuggestion["ai"] };
  });

  return { suggestions: out, grok: grokRes.grok };
}
