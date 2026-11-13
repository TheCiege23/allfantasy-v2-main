// lib/trade-engine/guardrailCopy.ts
import type { GuardrailReasonCode } from "./guardrails";

type GuardrailCopy = {
  short: string;
  long: string;
};

type DetailBag = Record<string, any>;

function pct(n: any): string | undefined {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return `${Math.round(v * 100)}%`;
}

function num(n: any): string | undefined {
  const v = Number(n);
  if (!Number.isFinite(v)) return undefined;
  return `${Math.round(v)}`;
}

function guardrailReasonToCopy(
  code: GuardrailReasonCode,
  details?: DetailBag
): GuardrailCopy {
  switch (code) {
    case "GR_DISABLED":
      return {
        short: "Guardrails off",
        long: "Parity protection is currently disabled, so trades are not being filtered by league fairness safeguards.",
      };

    case "GR_STRONG_TEAM_GAIN_LIMIT": {
      const delta = num(details?.deltaTpi);
      const gain = pct(details?.partnerGainRatio);
      const maxGain = pct(details?.maxPartnerGainRatio);
      return {
        short: "Parity protection (top team)",
        long:
          `This offer was blocked to prevent "feeding" a stronger team.` +
          (delta ? ` (Team strength gap: ΔTPI ${delta}.)` : "") +
          (gain && maxGain ? ` Partner would gain ${gain} vs allowed ${maxGain}.` : ""),
      };
    }

    case "GR_WEAK_TEAM_ANTI_REBUILD": {
      const tpi = num(details?.userTpi);
      const aging = num(details?.agingVetAge);
      const gain = pct(details?.partnerGainRatio);
      const max = pct(details?.maxWeakOverpay);
      const premium = details?.hasPremiumPick ? "premium picks" : "";
      const youth = details?.hasYouth ? "young players" : "";
      const paidWith = [premium, youth].filter(Boolean).join(" and ");
      return {
        short: "Rebuild protection",
        long:
          `This offer was blocked to protect a weaker/rebuilding team from overpaying.` +
          (tpi ? ` (Your TPI: ${tpi}.)` : "") +
          ` It sends ${paidWith || "premium assets"} for an aging veteran` +
          (aging ? ` (age ≥ ${aging}).` : ".") +
          (gain && max ? ` Partner gain ${gain} exceeds limit ${max}.` : ""),
      };
    }

    case "GR_NO_RECEIVE_TOTAL":
      return {
        short: "Invalid valuation",
        long:
          "This offer was blocked because the engine could not compute a valid receiveTotal value (e.g., missing values).",
      };

    default:
      return {
        short: "Blocked by guardrails",
        long: "This offer was blocked by league fairness guardrails.",
      };
  }
}

export function guardrailCodesToUiList(
  codes: GuardrailReasonCode[],
  details?: DetailBag
): Array<{ code: GuardrailReasonCode; short: string; long: string }> {
  return (codes || []).map((c) => {
    const copy = guardrailReasonToCopy(c, details);
    return { code: c, short: copy.short, long: copy.long };
  });
}
