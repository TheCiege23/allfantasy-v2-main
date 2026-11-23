/**
 * Chimmy's trade grade for a viewer WITHOUT AF Intelligence (owner, 2026-11-22: "the extended trade value
 * and trade eval — users get a basic answer but not the full answer, with an upgrade button").
 *
 * The basic answer is the same one the Trade Center gives a free user: what moves, the letter (both
 * letters when there are two) and the league values behind it. The full answer adds why the values moved
 * (the market evidence), the lineup before and after, and the playoff scenario — those lines are dropped
 * here and the model is told not to reconstruct them. The upgrade button under the answer comes from
 * `proToolsRefused` (lib/chimmy/answerPolish.ts), like every other paid Chimmy tool. PURE.
 */

const BASIC_LINE = /^(TRADE SCENARIO|- You give:|- League value|- Grade:|- Draft picks|- Evaluation receipt:)/

export const TRADE_BREAKDOWN_LOCKED_NOTE =
  "The full trade breakdown — why the values moved, the lineup before and after, and the playoff scenario — is part of AF Pro, AF Commissioner and AF Supreme, and this user's plan does not include it. Give the letter and the league values above only. Do NOT estimate a lineup change, playoff odds or market moves yourself. Say in one short line that the full breakdown comes with AF Pro; the app adds the upgrade button itself."

export function basicTradeScenarioText(full: string): string {
  const lines = full.split('\n')
  // A scenario that was NOT computed carries no paid depth — pass it through as it is.
  if (!lines[0]?.startsWith("TRADE SCENARIO (")) return full
  return [...lines.filter((l) => BASIC_LINE.test(l)), TRADE_BREAKDOWN_LOCKED_NOTE].join('\n')
}
