import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { trackLegacyToolUsage } from "@/lib/analytics-server";
import { requireLegacySleeperIdentity } from "@/lib/legacy/requireLegacySleeperIdentity";
import { getDecisionLogsForCoach, getDecisionSummary } from "@/lib/decision-log";
import { getCachedDNA, formatDNAForPrompt } from "@/lib/manager-dna";

type CoachInput = {
  sleeper_username: string;
  profile?: any;
  stats?: any;
  ranking_preview?: any;
  league_history?: any[];
};

function safeJsonParse(input: any) {
  try {
    if (typeof input !== "string") return null;
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function compactLeagueHistory(list: any[]) {
  return (Array.isArray(list) ? list : []).slice(0, 15).map((lg) => ({
    season: lg?.season,
    sport: lg?.sport,
    type: lg?.type,
    scoring: lg?.scoring,
    team_count: lg?.team_count,
    wins: lg?.wins,
    losses: lg?.losses,
    ties: lg?.ties,
    made_playoffs: lg?.made_playoffs,
    is_champion: lg?.is_champion,
  }));
}

function compactStats(stats: any) {
  if (!stats || typeof stats !== "object") return {};
  return {
    seasons: stats?.seasons_imported ?? stats?.seasons,
    leagues: stats?.leagues_played ?? stats?.leagues,
    wins: stats?.wins,
    losses: stats?.losses,
    ties: stats?.ties,
    record: stats?.record,
    win_percentage: stats?.win_percentage,
    championships: stats?.championships,
    playoffs: stats?.playoffs,
    playoff_percentage: stats?.playoff_percentage,
    total_points_for: stats?.total_points_for ?? stats?.total_points,
  };
}

function compactRankPreview(preview: any) {
  if (!preview || typeof preview !== "object") return {};
  return {
    career: {
      xp: preview?.career?.xp,
      level: preview?.career?.level,
      tier: preview?.career?.tier,
      tier_name: preview?.career?.tier_name,
    },
    yearly_projection: {
      baseline_year_xp: preview?.yearly_projection?.baseline_year_xp,
      ai_low_year_xp: preview?.yearly_projection?.ai_low_year_xp,
      ai_mid_year_xp: preview?.yearly_projection?.ai_mid_year_xp,
      ai_high_year_xp: preview?.yearly_projection?.ai_high_year_xp,
      assumptions: preview?.yearly_projection?.assumptions
        ? {
            avgLeaguesPerYear: preview.yearly_projection.assumptions.avgLeaguesPerYear,
            avgWinsPerYear: preview.yearly_projection.assumptions.avgWinsPerYear,
            avgPlayoffsPerYear: preview.yearly_projection.assumptions.avgPlayoffsPerYear,
            avgChampsPerYear: preview.yearly_projection.assumptions.avgChampsPerYear,
            avgMultiplier: preview.yearly_projection.assumptions.avgMultiplier,
            aiWinRateLiftRange: preview.yearly_projection.assumptions.aiWinRateLiftRange,
            aiPlayoffLiftPerYear: preview.yearly_projection.assumptions.aiPlayoffLiftPerYear,
            aiChampLiftPerYear: preview.yearly_projection.assumptions.aiChampLiftPerYear,
            xp_per_level: preview.yearly_projection.assumptions.xp_per_level,
          }
        : undefined,
    },
  };
}

export const POST = withApiUsage({ endpoint: "/api/legacy/ai-coach", tool: "LegacyAiCoach" })(async (request: NextRequest) => {
  const body = (await request.json().catch(() => null)) as CoachInput | null;

  /*
   * Replaces a limiter keyed on the CALLER-SUPPLIED username with `includeIpInKey: false`,
   * so rotating the username bought unlimited budget on an endpoint that calls a model.
   * The shared gate keys on the authenticated actor and folds in the IP.
   */
  const gate = await requireLegacySleeperIdentity(request, {
    requestedUsername: String(body?.sleeper_username || "").trim() || null,
    rateLimit: { action: "ai_coach", maxRequests: 3, windowMs: 60_000 },
  });
  if (!gate.ok) return gate.response;
  const sleeper_username = gate.identity.sleeperUsername;

  if (!body) {
    return NextResponse.json({ error: "Missing request body" }, { status: 400 });
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it to Secrets and redeploy/restart." },
      { status: 500 }
    );
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const stats = compactStats(body.stats);
  const ranking_preview = compactRankPreview(body.ranking_preview);
  const league_history = compactLeagueHistory(body.league_history ?? []);

  let dnaContext = '';
  try {
    const dna = await getCachedDNA(sleeper_username);
    if (dna) {
      dnaContext = formatDNAForPrompt(dna);
    }
  } catch {}

  let decisionContext = '';
  try {
    const [recentDecisions, summary] = await Promise.all([
      getDecisionLogsForCoach(sleeper_username, 15),
      getDecisionSummary(sleeper_username),
    ]);
    if (recentDecisions.length > 0) {
      const followRate = summary.total > 0
        ? Math.round((summary.followed / summary.total) * 100)
        : 0;
      decisionContext = [
        ``,
        `## DECISION HISTORY (AI Recommendation Track Record)`,
        `This user has ${summary.total} logged AI recommendations.`,
        `- Followed: ${summary.followed} (${followRate}%)`,
        `- Ignored: ${summary.ignored}`,
        `- Pending: ${summary.pending}`,
        `- Win rate when followed: ${Math.round(summary.followedWinRate * 100)}%`,
        `- Win rate when ignored: ${Math.round(summary.ignoredWinRate * 100)}%`,
        ``,
        `Recent decisions:`,
        ...recentDecisions.slice(0, 10).map(d =>
          `  - [${d.decisionType}] ${d.recommendation} (confidence: ${Math.round(d.confidence * 100)}%, risk: ${d.risk}, followed: ${d.followed ?? 'pending'}, outcome: ${d.grade ?? 'awaiting'})`
        ),
        ``,
        `Use this history to give RETROSPECTIVE advice:`,
        `- If they ignored good advice that panned out, call it out gently.`,
        `- If they followed advice that didn't work, acknowledge it honestly.`,
        `- Reference specific past decisions when relevant to current advice.`,
      ].join('\n');
    }
  } catch {
    // decision log not available, continue without it
  }

  const prompt = {
    role: "user",
    content: [
      `You are THE ELITE AllFantasy AI Head Coach - your job is to tell managers exactly what to do next.`,
      ``,
      `## YOUR PERSONALITY`,
      `You speak like a real head coach giving direct orders. You're conversational, honest, and entertaining.`,
      `Use phrases like:`,
      `- "I know it's tempting… don't do it."`,
      `- "This is how rebuilds get delayed."`,
      `- "Your next move should be selling [Player] before the rookie draft."`,
      `- "Ignore RBs this offseason. Your window is 2026."`,
      `- "Stop hoarding picks. You have enough. Start spending."`,
      ``,
      `## OFFSEASON WINDOW STATUS`,
      `Classify them based on OFFSEASON factors (not record):`,
      `- 🏆 READY_TO_COMPETE: Window OPEN for 2025. Buy proven talent, win now!`,
      `- 🔨 REBUILDING: Building for 2026+. Sell aging RBs, acquire picks and youth.`,
      `- ⚠️ OVEREXTENDED: Fragile contender. Shore up depth or sell before crater.`,
      `- 📉 AGING_CORE: Window closing fast. Aggressively sell for picks NOW.`,
      `- 🧱 DIRECTION_NEEDED: Stuck in middle. Pick a lane or die slowly.`,
      ``,
      `## OFFSEASON TIMING PRIORITIES`,
      `Organize advice by offseason phase:`,
      `1. PRE-DRAFT (Now): What trades to make before rookie draft`,
      `2. ROOKIE DRAFT: Draft strategy based on their window`,
      `3. FREE AGENCY: Which free agents to target/avoid`,
      `4. TRAINING CAMP: Roster cuts and final moves`,
      ``,
      `## SYNTHESIZE ALL DATA`,
      `Look at their trade patterns, waiver habits, roster construction, and historical performance.`,
      `Identify their biggest mistakes and give them specific players/picks to target.`,
      ``,
      `User: ${sleeper_username}`,
      `Stats: ${JSON.stringify(stats, null, 2)}`,
      `Ranking Preview: ${JSON.stringify(ranking_preview, null, 2)}`,
      `League History (sample): ${JSON.stringify(league_history, null, 2)}`,
      dnaContext,
      decisionContext,
      ``,
      `## YOUR TASK`,
      `Give them a GAME PLAN - not generic advice. Name specific actions.`,
      `Be honest. Be entertaining. Be direct.`,
      `Write like you're talking TO them, not ABOUT them.`,
      ``,
      `Return JSON with exactly these fields:`,
      `- headline (string - conversational, attention-grabbing summary like "You're one move away from a championship window")`,
      `- window_status (string - "READY_TO_COMPETE" | "REBUILDING" | "OVEREXTENDED" | "AGING_CORE" | "DIRECTION_NEEDED")`,
      `- window_status_emoji (string - "🏆" | "🔨" | "⚠️" | "📉" | "🧱")`,
      `- next_move (string - THE most important thing they should do right now, conversational like "Sell Kelce before the rookie draft. I know it hurts, but his value is at its peak.")`,
      `- what_hurts_most (array of exactly 3 strings - their biggest issues, written conversationally)`,
      `- offseason_game_plan (object with phases):`,
      `  - pre_draft (array of 2 strings - trades to make before rookie draft)`,
      `  - rookie_draft (array of 2 strings - draft strategy)`,
      `  - free_agency (array of 2 strings - FA targets)`,
      `  - training_camp (array of 1 string - final moves)`,
      `- dont_do_this (array of 2 strings - common mistakes to avoid for their situation, written like "I know it's tempting to trade for an RB1, but don't do it. Your window is 2026.")`,
      `- coaching_quote (string - a motivational/honest closing line like "Rebuilds are won by patience. Trust the process." or "Championships are won by making the hard trades. Stop being sentimental.")`,
      `- retrospective_insights (array of strings, optional - if decision history is available, include 1-3 retrospective observations like "You ignored my advice to sell Player X three weeks ago — and his value dropped 15%. Trust the process next time." or "You followed my waiver pickup suggestion and it paid off — nice work.")`,
    ].join("\n"),
  };

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
              `You are THE ELITE AllFantasy AI Head Coach - you tell managers exactly what to do next. You're conversational, direct, and entertaining. You speak TO them like a real coach: 'Your next move should be...' 'I know it's tempting, but don't do it.' 'This is how rebuilds get delayed.' Synthesize all their data into a clear GAME PLAN organized by offseason timing (pre-draft, rookie draft, free agency, training camp). Be honest about mistakes. Name specific players and picks.

CRITICAL: Today's date is ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}. The 2024 NFL Draft class (Marvin Harrison Jr, Malik Nabers, Jayden Daniels, Caleb Williams, Omarion Hampton, Brock Bowers, etc.) have ALREADY completed their rookie seasons and are now active NFL players with game tape - do NOT refer to them as prospects.

Always respond with valid JSON only.`,
          },
          prompt as any,
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "OpenAI request failed (network)",
        details: String(e?.message || e || "").slice(0, 500),
      },
      { status: 500 }
    );
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");

    console.error("OPENAI AI_COACH ERROR", {
      status: resp.status,
      model,
      baseUrl,
      errText: errText.slice(0, 500),
    });

    return NextResponse.json(
      {
        error: "OpenAI request failed",
        status: resp.status,
        details: errText.slice(0, 500),
      },
      { status: 500 }
    );
  }

  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  const coach = safeJsonParse(content);
  if (!coach) {
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: String(content ?? "").slice(0, 500) },
      { status: 500 }
    );
  }

  // Track tool usage
  trackLegacyToolUsage('ai_coach', null, null, { sleeperUsername: sleeper_username })

  return NextResponse.json({
    ok: true,
    coach,
  });
})
