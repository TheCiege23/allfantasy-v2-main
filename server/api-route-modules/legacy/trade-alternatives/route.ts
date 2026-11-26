import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server';
import { isUserParty } from '@/lib/user-matching';
import { legacySessionUserId } from '@/lib/legacy/legacyOneGrade';
import { gradeLegacyCompletedTrades, type LegacyCompletedTrade, type LegacyTradeParty } from '@/lib/legacy/legacyCompletedTradeGrades';
import { proseNamesAGrade } from '@/lib/legacy/legacyPackageGrade';
import type { FrozenCompletedGrade } from '@/lib/decision-os/trade/frozenCompletedGrade';
import {
  alternativeCandidates,
  alternativeConfidence,
  rankAlternatives,
  tradeWithReceived,
  type AlternativesResult,
} from '@/lib/trade-alternatives';

/*
 * 🛑 "WHAT COULD I HAVE DONE INSTEAD?" READS THE ONE COMPLETED-TRADE GRADE (2026-11-26).
 *
 * It priced the trade and every alternative on `lib/hybrid-valuation.ts` and handed an LLM the hybrid
 * letter and "points" to explain, beside a trade card whose letter came from the one grade. Now the
 * trade and every alternative go through `oneGradeForCompletedTrade` (`gradeLegacyCompletedTrades`) on
 * the signed-in user's verified AF league row, from the viewer's side — see `lib/trade-alternatives.ts`
 * for how the comparison is made. The LLM writes only the explanation, is told the grade's verdict, and
 * prose that writes a letter grade is dropped. `confidence` is read off the grade (a better letter is
 * High, a better net alone Medium), never the model's.
 *
 * The client must send the league (`leagueId`): a grade is taken on a league's own values and rules.
 * Without one — or for a league that is not the caller's — the answer is withheld with the reason.
 */

const openai = getOpenAIRouteClient()

export interface AlternativeExplanation {
  recommended: string;
  reasoning: string[];
  confidence: 'High' | 'Medium' | null;
  alternatives: AlternativesResult;
  gradeSource: 'one_trade_engine';
}

const NO_FROZEN = async () => new Map<string, FrozenCompletedGrade>()

async function explain(
  originalTrade: string,
  alternatives: AlternativesResult,
): Promise<{ recommended: string; reasoning: string[] }> {
  const best = alternatives.bestAlternative!
  const fallback = {
    recommended: best.label,
    reasoning: [
      `Graded ${best.grade} from your side, against ${alternatives.originalGrade} for the trade you made`,
      `+${best.deltaImprovement.toFixed(0)} league value over what you received`,
    ],
  }
  const altDescriptions = alternatives.alternatives
    .slice(0, 3)
    .map((a, i) => `${i + 1}. ${a.label} (+${a.deltaImprovement.toFixed(0)} league value)`)
    .join('\n');

  const prompt = `You are a fantasy football trade advisor. Our trade grader has already compared this trade with some alternatives; its verdict is FINAL. Do not give, suggest or imply any letter grade, score or verdict of your own, and do not write any letter grade.

ORIGINAL TRADE: ${originalTrade}

ALTERNATIVES THE GRADER RATES HIGHER (league value gained over what was received):
${altDescriptions}

THE GRADER'S BEST ALTERNATIVE: ${best.label}

Your task:
1. Restate the grader's best alternative as a brief statement of the better trade
2. Give 2-3 short, specific reasons it would have helped, consistent with the grader's verdict

Respond in JSON format:
{
  "recommended": "brief statement of the better trade",
  "reasoning": ["reason 1", "reason 2", "reason 3"]
}

Be coaching-focused, not judgmental. Focus on what could have been, not what was wrong.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 300
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;
    const parsed = JSON.parse(content) as { recommended?: unknown; reasoning?: unknown };
    const recommended = typeof parsed.recommended === 'string' && parsed.recommended.trim() ? parsed.recommended.trim() : best.label;
    const reasoning = Array.isArray(parsed.reasoning) ? parsed.reasoning.filter((r): r is string => typeof r === 'string' && r.trim() !== '') : [];
    if (reasoning.length === 0 || proseNamesAGrade([recommended, ...reasoning].join('\n'))) return fallback;
    return { recommended, reasoning };
  } catch (error) {
    console.error('AI explanation error:', error);
    return fallback;
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-alternatives", tool: "LegacyTradeAlternatives" })(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { trade, userId, leagueId } = body as { trade?: LegacyCompletedTrade; userId?: string; leagueId?: string };

    if (!trade || !userId) {
      return NextResponse.json({ error: 'Missing trade or userId' }, { status: 400 });
    }

    if (!trade.parties || trade.parties.length < 2) {
      return NextResponse.json({ error: 'Trade must have at least 2 parties' }, { status: 400 });
    }

    const isViewer = (p: LegacyTradeParty) => isUserParty(p, String(userId), String(userId));
    const session = await legacySessionUserId();
    const args = { suppliedLeagueId: leagueId, userId: session, isViewer };

    // THE trade's own grade — the letter its card shows.
    const [original] = await gradeLegacyCompletedTrades({ ...args, trades: [trade] });

    let alternatives: AlternativesResult;
    let baselineLetter = null as AlternativesResult['originalGrade'];
    if (!original!.graded) {
      alternatives = rankAlternatives(original!, original!, [], []);
    } else {
      // The baseline and every alternative, priced the same way: none reads a frozen original.
      const candidates = alternativeCandidates(trade, isViewer);
      const [baseline, ...graded] = await gradeLegacyCompletedTrades(
        {
          ...args,
          trades: [
            tradeWithReceived(trade, isViewer, null, 'baseline'),
            ...candidates.map((c, i) => tradeWithReceived(trade, isViewer, c, `alt${i}`)),
          ],
        },
        { loadFrozen: NO_FROZEN },
      );
      alternatives = rankAlternatives(original!, baseline!, candidates, graded);
      baselineLetter = baseline!.graded ? baseline!.letter : null;
    }

    if (alternatives.gradeWithheld) {
      const response: AlternativeExplanation = {
        recommended: 'Not graded',
        reasoning: [alternatives.gradeWithheld],
        confidence: null,
        alternatives,
        gradeSource: 'one_trade_engine',
      };
      return NextResponse.json(response);
    }

    if (!alternatives.bestAlternative) {
      const response: AlternativeExplanation = {
        recommended: 'No better alternatives found',
        reasoning: [`None of the alternatives we compared grades better than your ${alternatives.originalGrade}.`],
        confidence: null,
        alternatives,
        gradeSource: 'one_trade_engine',
      };
      return NextResponse.json(response);
    }

    const me = trade.parties.find(isViewer);
    const them = trade.parties.find((p) => p !== me);
    const names = (p: LegacyTradeParty | undefined) =>
      [...(p?.playersReceived ?? []).map((x) => x.name), ...(p?.picksReceived ?? []).map((x) => `${x.season} Round ${x.round}`)].join(', ') || 'nothing';
    const explanation = await explain(`Received ${names(me)} for ${names(them)}`, alternatives);

    const response: AlternativeExplanation = {
      ...explanation,
      confidence: alternativeConfidence(alternatives, baselineLetter),
      alternatives,
      gradeSource: 'one_trade_engine',
    };
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Trade alternatives error:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate alternatives' }, { status: 500 });
  }
})
