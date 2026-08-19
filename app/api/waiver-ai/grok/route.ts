import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { assertLeagueMember } from '@/lib/league-access';
import OpenAI from 'openai';
import { executeSerperWebSearch, executeSerperNewsSearch } from '@/lib/serper';
import { getPlayerValuesContext } from '@/lib/player-values/playerValuesLoader';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getGrokClient() {
  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
  if (!apiKey) {
    throw new Error("XAI_API_KEY/GROK_API_KEY is missing")
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  })
}

function getOpenAIClient() {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing")
  }

  return new OpenAI({
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1",
  })
}

const MAX_TOOL_TURNS = 5;

type FactEvidence = { source: 'league' | 'roster' | 'news' | 'model'; metric: string; value: string };

type WaiverSuggestionOut = {
  playerName: string;
  rank: number;
  score: number;
  reason: string[];
  projectedPoints: number;
  faabBidRecommendation: number | null;
  sensitivityNote: string | null;
  factualEvidence?: FactEvidence[];
};

const GROK_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search current web for NFL news, injuries, signings, rookie updates, waiver wire buzz. Returns organic results with position/date, answer boxes, knowledge graph data, top stories, and related questions.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, num: { type: 'number', description: 'Number of results (default 10)' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'news_search',
      description: 'Search Google News specifically for recent NFL/fantasy football news articles. Returns news with title, snippet, source, date. Best for breaking news, injuries, transactions, waiver wire buzz.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, num: { type: 'number', description: 'Number of news results (default 10)' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'x_keyword_search',
      description: 'Search X (Twitter) for real-time player buzz, rookie hype, sentiment, injuries',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
];

function safeParseRoster(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildDeterministicFacts(args: {
  rosterData: string;
  resolvedLeagueSize: number;
  resolvedScoring: string;
  resolvedIsDynasty: boolean;
  resolvedFAAB: number;
  userContention: string;
}): { facts: string[]; evidence: FactEvidence[] } {
  const roster = safeParseRoster(args.rosterData);
  const posCounts: Record<string, number> = {};
  let avgAge = 0;
  let ageN = 0;

  for (const p of roster) {
    const pos = String((p as any)?.position || (p as any)?.pos || '').toUpperCase().trim();
    if (pos) posCounts[pos] = (posCounts[pos] || 0) + 1;
    const age = Number((p as any)?.age);
    if (Number.isFinite(age) && age > 0) {
      avgAge += age;
      ageN += 1;
    }
  }

  const sortedPos = Object.entries(posCounts).sort((a, b) => a[1] - b[1]);
  const weakest = sortedPos.slice(0, 2).map(([pos]) => pos).filter(Boolean);

  const leagueFacts = [
    `League format: ${args.resolvedLeagueSize}-team ${args.resolvedIsDynasty ? 'dynasty' : 'redraft'} ${args.resolvedScoring.toUpperCase()}`,
    `FAAB remaining: ${args.resolvedFAAB}%`,
    `Contention window: ${args.userContention}`,
    ageN > 0 ? `Roster average age: ${(avgAge / ageN).toFixed(1)}` : 'Roster average age unavailable',
    weakest.length > 0 ? `Weakest position depth by count: ${weakest.join(', ')}` : 'Position depth unavailable',
  ];

  const evidence: FactEvidence[] = [
    { source: 'league', metric: 'format', value: `${args.resolvedLeagueSize}-team ${args.resolvedIsDynasty ? 'dynasty' : 'redraft'} ${args.resolvedScoring}` },
    { source: 'league', metric: 'faab_remaining_pct', value: `${args.resolvedFAAB}` },
    { source: 'league', metric: 'contention_window', value: args.userContention },
  ];

  if (ageN > 0) evidence.push({ source: 'roster', metric: 'avg_age', value: (avgAge / ageN).toFixed(1) });
  for (const [pos, count] of Object.entries(posCounts)) {
    evidence.push({ source: 'roster', metric: `depth_${pos}`, value: String(count) });
  }

  return { facts: leagueFacts, evidence: evidence.slice(0, 12) };
}

async function runGrokWithTools(systemPrompt: string, useRealTime: boolean): Promise<{ content: string; newsEvidence: FactEvidence[] }> {
  const grok = getGrokClient()

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Analyze this roster and find the best waiver wire targets. ' + (useRealTime ? 'Use your tools to search for the latest injuries, signings, rookie buzz, and X sentiment for relevant players.' : 'Focus on player profiles, roster fit, and value analysis.') },
  ];

  const newsEvidence: FactEvidence[] = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await grok.chat.completions.create({
      model: 'grok-4-0709',
      messages,
      ...(useRealTime ? { tools: GROK_TOOLS, tool_choice: 'auto' as const } : {}),
      temperature: 0.65,
      max_tokens: 2000,
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { content: msg.content || '{}', newsEvidence: newsEvidence.slice(0, 10) };
    }

    for (const toolCall of msg.tool_calls) {
      const fn = (toolCall as any).function;
      if (!fn) continue;
      const fnName = fn.name;
      let args: any = {};
      try { args = JSON.parse(fn.arguments || '{}'); } catch {}

      let result: any;

      if (fnName === 'web_search') {
        result = await executeSerperWebSearch(args.query || 'NFL fantasy football waiver wire 2026', args.num || 10);
        if (result?.results?.length) {
          newsEvidence.push({ source: 'news', metric: 'web_search', value: `${args.query || 'waiver'} (${result.results.length} results)` });
        }
        if (result?.topStories?.length) {
          newsEvidence.push({ source: 'news', metric: 'top_stories', value: `${result.topStories.length} breaking stories found` });
        }
        if (result?.knowledgeGraph?.title) {
          newsEvidence.push({ source: 'news', metric: 'knowledge_graph', value: result.knowledgeGraph.title });
        }
      } else if (fnName === 'news_search') {
        result = await executeSerperNewsSearch(args.query || 'NFL fantasy football waiver news 2026', args.num || 10);
        if (result?.news?.length) {
          newsEvidence.push({ source: 'news', metric: 'news_search', value: `${args.query || 'waiver news'} (${result.news.length} articles)` });
        }
      } else if (fnName === 'x_keyword_search') {
        try {
          const xRes = await fetch('https://api.x.ai/v1/tools/x_keyword_search', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.XAI_API_KEY || process.env.GROK_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: args.query, limit: args.limit || 12 }),
            signal: AbortSignal.timeout(5000),
          });
          result = xRes.ok ? await xRes.json().catch(() => ({ note: 'X search parse failed' })) : { note: `X search returned ${xRes.status}` };
          if (xRes.ok) newsEvidence.push({ source: 'news', metric: 'x_keyword_search', value: `${args.query || 'nfl'} (ok)` });
        } catch (err: any) {
          result = { note: 'X search timeout or unavailable', query: args.query };
        }
      } else {
        result = { error: `Unknown tool: ${fnName}` };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  const finalMsg = messages[messages.length - 1];
  if (finalMsg.role === 'assistant' && typeof finalMsg.content === 'string') {
    return { content: finalMsg.content, newsEvidence: newsEvidence.slice(0, 10) };
  }
  return { content: '{}', newsEvidence: newsEvidence.slice(0, 10) };
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req) || 'unknown';
    const rl = rateLimit(`waiver-grok:${ip}`, 10, 60_000);
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null;
    const userId = session?.user?.id;

    const {
      leagueId,
      userRoster: manualRoster,
      userContention = 'unknown',
      userFAAB = 100,
      useRealTimeNews = true,
      leagueSize = 12,
      scoring = 'ppr',
      isDynasty = true,
    } = body;

    let rosterData: string;
    let resolvedLeagueSize = leagueSize;
    let resolvedScoring = scoring;
    let resolvedIsDynasty = isDynasty;
    let resolvedFAAB = userFAAB;
    let leagueSettings = '';
    let resolvedSport: string = (body.sport as string) || 'NFL';

    if (leagueId) {
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      try {
        await assertLeagueMember(leagueId, userId);
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const league = await (prisma as any).league.findUnique({
        where: { id: leagueId },
        include: { rosters: true },
      });

      if (!league) {
        return NextResponse.json({ error: 'League not synced yet. Please sync your league first.' }, { status: 400 });
      }

      resolvedSport = (league.sport as string) || 'NFL';
      // Identity is always the authenticated session's own userId — never a client-supplied
      // sleeperUserId/platformUserId, which would let one account read another team's roster.
      const userRoster = league.rosters.find((r: any) => r.platformUserId === userId);
      if (!userRoster) {
        return NextResponse.json({ error: 'Roster not found for this user in this league' }, { status: 400 });
      }

      rosterData = JSON.stringify(userRoster.playerData);
      resolvedLeagueSize = league.leagueSize;
      resolvedScoring = league.scoring;
      resolvedIsDynasty = league.isDynasty;
      resolvedFAAB = userRoster.faabRemaining ?? userFAAB;
      leagueSettings = `\n- Sport: ${resolvedSport}\n- Full league settings: ${JSON.stringify(league.settings)}`;
    } else if (manualRoster && typeof manualRoster === 'string' && manualRoster.trim()) {
      rosterData = manualRoster;
    } else {
      return NextResponse.json({ error: 'Provide either a leagueId (synced) or paste your roster manually' }, { status: 400 });
    }

    let pickupClause = '';
    let profileClause = '';

    if (userId) {
      const [recentPickups, profile] = await Promise.all([
        (prisma as any).waiverPickup.findMany({
          where: { userId, ...(leagueId ? { leagueId } : {}) },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
        (prisma as any).tradeProfile.findUnique({ where: { userId } }),
      ]);

      if (recentPickups.length > 0) {
        const pickupSummary = recentPickups.map((p: any) => `${p.playerName} -> ${p.outcome || 'unknown'}`).join(', ');
        pickupClause = `\n\nPast waiver pickups (learn from these): ${pickupSummary}\nRecommend more players like past hits, avoid profiles similar to past misses.`;
      }

      if (profile?.summary) {
        profileClause = `\n\nUser preference profile: ${profile.summary}`;
      }
    }

    const deterministic = buildDeterministicFacts({
      rosterData,
      resolvedLeagueSize,
      resolvedScoring,
      resolvedIsDynasty,
      resolvedFAAB,
      userContention,
    });

    const realTimeClause = useRealTimeNews
      ? `\n\nREAL-TIME DATA ENABLED: Use your web_search and x_keyword_search tools to find the latest injuries, transactions, signings, coaching changes, rookie draft capital/landing spots, and breaking news. Flag any time-sensitive pickups and note if info has uncertainty.`
      : '';

    const resolvedSportKey = normalizeToSupportedSport(String(resolvedSport || 'NFL'));
    const sportLabel = resolvedSportKey === 'NFL' ? 'football' : resolvedSportKey === 'NBA' ? 'basketball' : resolvedSportKey === 'MLB' ? 'baseball' : resolvedSportKey === 'NHL' ? 'hockey' : resolvedSportKey === 'NCAAF' ? 'college football' : resolvedSportKey === 'NCAAB' ? 'college basketball' : resolvedSportKey === 'SOCCER' ? 'soccer' : 'sports';
    const playerValuesCtx = getPlayerValuesContext({
      sport: resolvedSportKey,
      format: resolvedIsDynasty ? 'dynasty' : 'redraft',
    })
    const systemPrompt = `You are the #1 Waiver Wire AI for 2026 fantasy ${sportLabel}.
${playerValuesCtx ? `${playerValuesCtx}\n\nUse these player values when making recommendations, comparisons, and rankings. Prefer these values over your general training knowledge when they conflict.\n\n` : ''}
Analyze the user's roster, contention window, FAAB budget, and league context to surface the highest-impact waiver targets.

LEAGUE CONTEXT (CRITICAL):
- Sport: ${resolvedSportKey}
- Format: ${resolvedLeagueSize}-team ${resolvedIsDynasty ? 'Dynasty' : 'Redraft'} ${resolvedScoring.toUpperCase()}
- Contention window: ${userContention}
- FAAB remaining: ${resolvedFAAB}%${leagueSettings}

DETERMINISTIC FACTS (MUST BE USED):
${deterministic.facts.map((f) => `- ${f}`).join('\n')}

USER ROSTER:
"""
${rosterData}
"""

Prioritize waiver targets that:
1. Fill immediate roster holes based on the provided roster (identify positional weaknesses)
2. Fit the user's contention window (${userContention}) - win-now targets for contenders, stash/upside for rebuilders
3. Offer breakout upside or long-term stash value in dynasty formats
4. Replace potential busts, aging, or injury-prone players currently on the roster
5. Are realistic FAAB spends given ${resolvedFAAB}% remaining budget
6. Consider roster construction holistically - depth vs ceiling, bye week coverage, handcuff value
${pickupClause}${profileClause}${realTimeClause}

For each target, explain WHY they fit THIS specific roster and contention window using specific measurable facts (depth count, FAAB %, injury status, role changes, recent production, draft capital). Avoid subjective statements without evidence.

Return 6-8 waiver targets ranked by priority. Output detailed text - synthesis step will enforce strict JSON.`;

    const grokResearch = await runGrokWithTools(systemPrompt, useRealTimeNews);

    const openai = getOpenAIClient()

    const synthesis = await openai.chat.completions.create({
      model: 'gpt-4o-2024-11-20',
      messages: [
        {
          role: 'system',
          content: `You are a fantasy ${sportLabel} waiver wire synthesizer. Given Grok's research and deterministic facts, produce final structured JSON. Output ONLY valid JSON.
${playerValuesCtx ? `${playerValuesCtx}\n\nUse these player values when ranking and explaining pickups. Prefer them over general training knowledge when they conflict.\n\n` : ''}
Required format:
{
  "suggestions": [
    {
      "playerName": string,
      "rank": number,
      "score": number,
      "reason": string[] (2-4 fact-based reasons with concrete details),
      "projectedPoints": number,
      "faabBidRecommendation": number | null,
      "sensitivityNote": string | null,
      "factualEvidence": [
        { "source": "league" | "roster" | "news" | "model", "metric": string, "value": string }
      ]
    }
  ],
  "rosterAlerts": [
    {
      "playerName": string,
      "alertType": "bust_risk" | "sell_high" | "injury_concern" | "aging_out",
      "reason": string
    }
  ],
  "explanation": {
    "leagueFit": string,
    "rosterNeedsSummary": string,
    "decisionBasis": "fact_based"
  }
}`,
        },
        {
          role: 'user',
          content: `Deterministic facts:\n${JSON.stringify(deterministic.facts)}\n\nGrok research:\n${grokResearch.content}\n\nNews evidence:\n${JSON.stringify(grokResearch.newsEvidence)}\n\nSynthesize into ranked waiver suggestions with explicit factual evidence per player.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2000,
    });

    const finalContent = synthesis.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(finalContent);

    const suggestions: WaiverSuggestionOut[] = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((s: any, idx: number) => {
          const ev: FactEvidence[] = Array.isArray(s?.factualEvidence)
            ? s.factualEvidence
                .filter((e: any) => e && typeof e.metric === 'string' && typeof e.value === 'string')
                .slice(0, 6)
            : [];

          return {
            playerName: String(s?.playerName || 'Unknown Player'),
            rank: Number.isFinite(Number(s?.rank)) ? Number(s.rank) : idx + 1,
            score: Number.isFinite(Number(s?.score)) ? Math.max(0, Math.min(100, Number(s.score))) : 50,
            reason: Array.isArray(s?.reason) ? s.reason.filter((r: any) => typeof r === 'string').slice(0, 4) : ['No reason provided'],
            projectedPoints: Number.isFinite(Number(s?.projectedPoints)) ? Number(s.projectedPoints) : 0,
            faabBidRecommendation:
              s?.faabBidRecommendation == null || !Number.isFinite(Number(s.faabBidRecommendation))
                ? null
                : Math.max(0, Math.min(100, Number(s.faabBidRecommendation))),
            sensitivityNote: typeof s?.sensitivityNote === 'string' ? s.sensitivityNote : null,
            factualEvidence: ev.length ? ev : deterministic.evidence.slice(0, 3),
          };
        })
      : [];

    return NextResponse.json({
      suggestions,
      rosterAlerts: Array.isArray(parsed?.rosterAlerts) ? parsed.rosterAlerts : [],
      explanation: parsed?.explanation || {
        leagueFit: deterministic.facts[0],
        rosterNeedsSummary: deterministic.facts[4] || deterministic.facts[3],
        decisionBasis: 'fact_based',
      },
      decisionBasis: 'fact_based',
      factsUsed: deterministic.facts,
    });
  } catch (error) {
    console.error('[waiver-ai/grok]', error);
    return NextResponse.json({ error: 'Failed to generate waiver suggestions' }, { status: 500 });
  }
}


