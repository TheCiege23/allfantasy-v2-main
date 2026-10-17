import type { FormattedTradeResponse, ValueVerdict, ViabilityVerdict } from './trade-response-formatter'

/**
 * 🛑 WHAT THE DYNASTY TRADE ANALYZER SENDS THE PAGE (2026-09-29) — an ALLOWLIST, not a blocklist.
 *
 * `formatTradeResponse` builds the dual-brain engine's full verdict: a winner and "edge", its own
 * fairness letter, a confidence %, veto risk, side totals and deltas on its private value scale, an
 * acceptance likelihood and score, a partner-fit score, and a "Ready to Send / Needs Adjustment" call.
 * None of it is the one grade, and the page printed most of it beside the one grade. The page now
 * shows THE grade (the route's `tradeGrade`) and only the facts below, which name no winner and carry
 * no number on the engine's scale:
 *
 *   - the AI's reasons and the quality gate's warnings, and the data coverage / freshness / AI
 *     disagreement notes about the analysis itself;
 *   - roster fit in words (which side's needs the deal addresses, surplus-to-need transfers), each
 *     team's window and the timing read, and the league-activity signals;
 *   - the AI's counter ideas and the draft message.
 *
 * ⚠ Counters are kept only when the AI wrote them (`aiCounters`, the gate's filtered counters). The
 * formatter's own fallback counter reads "Side A could add a future pick to close the 18% gap" — a
 * number on the private scale.
 */
export type DynastyAnalyzerClientSections = {
  valueVerdict: Pick<
    ValueVerdict,
    'reasons' | 'warnings' | 'dataFreshness' | 'dataCoverage' | 'disagreement' | 'disagreementCodes' | 'disagreementDetails'
  >
  viabilityVerdict: {
    partnerFit: Omit<ViabilityVerdict['partnerFit'], 'fitScore'>
    timing: ViabilityVerdict['timing']
    leagueActivity: string
    signals: string[]
  }
  actionPlan: {
    counters: FormattedTradeResponse['actionPlan']['counters']
    messageText: string
  }
}

export function dynastyAnalyzerSectionsForClient(
  sections: FormattedTradeResponse,
  aiCounters: readonly string[],
): DynastyAnalyzerClientSections {
  const v = sections.valueVerdict
  const p = sections.viabilityVerdict
  const ai = new Set(aiCounters)
  return {
    valueVerdict: {
      reasons: v.reasons,
      warnings: v.warnings,
      dataFreshness: v.dataFreshness,
      dataCoverage: v.dataCoverage,
      disagreement: v.disagreement,
      ...(v.disagreementCodes ? { disagreementCodes: v.disagreementCodes } : {}),
      ...(v.disagreementDetails ? { disagreementDetails: v.disagreementDetails } : {}),
    },
    viabilityVerdict: {
      partnerFit: {
        needsAlignment: p.partnerFit.needsAlignment,
        surplusMatch: p.partnerFit.surplusMatch,
        details: p.partnerFit.details,
      },
      timing: p.timing,
      leagueActivity: p.leagueActivity,
      signals: p.signals,
    },
    actionPlan: {
      counters: sections.actionPlan.counters.filter((c) => ai.has(c.description)),
      messageText: sections.actionPlan.messageText,
    },
  }
}
