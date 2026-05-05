// app/api/legacy/dev/simulate/route.ts
import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildLeagueIntelSnapshot } from "@/lib/trade-engine/pipeline";
import { attachNeedsSurplus } from "@/lib/trade-engine/value-context-service";
import { runTradeEngine } from "@/lib/trade-engine/trade-engine";
import { runAiAssist } from "@/lib/trade-engine/ai-layer";

function j(v: any) {
  try {
    return JSON.stringify(v);
  } catch {
    return "null";
  }
}

/**
 * DEV-ONLY endpoint
 * Protect with header:
 *   x-dev-token: <process.env.DEV_SIM_TOKEN>
 *
 * Body:
 * {
 *   "sleeper_username": "theciege",
 *   "league_id": "1234567890" // optional
 *   "include_ai": true        // optional (default false)
 * }
 */
export const POST = withApiUsage({ endpoint: "/api/legacy/dev/simulate", tool: "LegacyDevSimulate" })(async (req: NextRequest) => {
  try {
    const DEV_SIM_TOKEN = process.env.DEV_SIM_TOKEN;
    const token = req.headers.get("x-dev-token") || "";

    if (!DEV_SIM_TOKEN) {
      return NextResponse.json(
        { error: "DEV_SIM_TOKEN is not set in env." },
        { status: 500 }
      );
    }
    if (token !== DEV_SIM_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sleeper_username = String(body.sleeper_username || "")
      .trim()
      .toLowerCase();
    const league_id = body.league_id ? String(body.league_id).trim() : "";
    const include_ai = !!body.include_ai;

    if (!sleeper_username) {
      return NextResponse.json(
        { error: "Missing sleeper_username" },
        { status: 400 }
      );
    }

    const cache = league_id
      ? await prisma.sleeperImportCache.findUnique({
          where: {
            sleeperUsername_sleeperLeagueId: {
              sleeperUsername: sleeper_username,
              sleeperLeagueId: league_id,
            },
          },
          select: {
            leagueContext: true,
            managerRosters: true,
            fantasyCalcValueMap: true,
            sleeperLeagueId: true,
            leagueName: true,
          },
        })
      : await prisma.sleeperImportCache.findFirst({
          where: { sleeperUsername: sleeper_username },
          orderBy: { updatedAt: "desc" },
          select: {
            leagueContext: true,
            managerRosters: true,
            fantasyCalcValueMap: true,
            sleeperLeagueId: true,
            leagueName: true,
          },
        });

    if (!cache) {
      return NextResponse.json(
        {
          error:
            "No SleeperImportCache found. Run Trade Analyzer first to build the snapshot.",
        },
        { status: 404 }
      );
    }

    const league: any = cache.leagueContext;
    const rosters: any[] = cache.managerRosters as any[];
    const fantasyCalcValueMap: any = cache.fantasyCalcValueMap;

    if (!Array.isArray(rosters) || rosters.length === 0) {
      return NextResponse.json(
        { error: "Cached managerRosters is empty or invalid." },
        { status: 500 }
      );
    }

    const userRoster = rosters[0];

    const snapshot = await buildLeagueIntelSnapshot({
      league: {
        ...league,
        leagueId: league.leagueId || cache.sleeperLeagueId,
      },
      userRoster,
      rosters,
      fantasyCalcValueMap,
      prisma,
    });

    attachNeedsSurplus(snapshot, rosters);

    const result = runTradeEngine(userRoster.rosterId, snapshot as any);
    let trades = result.validTrades;

    if (include_ai) {
      trades = await runAiAssist({
        snapshot,
        userRosterId: userRoster.rosterId,
        trades,
      });
    }

    const stats = {
      leagueName: snapshot.league.leagueName,
      leagueId: cache.sleeperLeagueId,
      totalTrades: trades.length,
      byLabel: trades.reduce((m: any, t: any) => {
        m[t.acceptanceLabel] = (m[t.acceptanceLabel] || 0) + 1;
        return m;
      }, {}),
      byVeto: trades.reduce((m: any, t: any) => {
        m[t.vetoLikelihood] = (m[t.vetoLikelihood] || 0) + 1;
        return m;
      }, {}),
      parityFlagCount: trades.filter((t: any) => (t.parityFlags?.length || 0) > 0)
        .length,
      idpEnabled: snapshot.idpConfig.enabled,
      candidatesGenerated: result.stats.candidatesGenerated,
      candidatesRejected: result.stats.candidatesRejected,
    };

    const sample = trades.slice(0, 10).map((t: any) => ({
      id: t.id,
      toRosterId: t.toRosterId,
      fairnessScore: t.fairnessScore,
      acceptanceLabel: t.acceptanceLabel,
      vetoLikelihood: t.vetoLikelihood,
      valueRatio: Number(t.valueRatio?.toFixed(3) || 0),
      parityFlags: t.parityFlags,
      give: t.give.map((a: any) => ({
        type: a.type,
        name: a.name || a.displayName || a.id,
        value: a.value,
        isCornerstone: a.isCornerstone,
      })),
      receive: t.receive.map((a: any) => ({
        type: a.type,
        name: a.name || a.displayName || a.id,
        value: a.value,
        isCornerstone: a.isCornerstone,
      })),
      ai: include_ai && t.ai
        ? {
            messageTemplate: t.ai.messageTemplate,
            targetWhy: t.ai.targetWhy,
            riskNarrative: t.ai.riskNarrative,
            timingNarrative: t.ai.timingNarrative,
          }
        : undefined,
    }));

    return NextResponse.json({ ok: true, stats, sample });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "simulate failed", detail: j(e) },
      { status: 500 }
    );
  }
})
