// app/api/legacy/dev/stress-test/route.ts
import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildLeagueIntelSnapshot,
} from "@/lib/trade-engine/pipeline";
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

export const POST = withApiUsage({ endpoint: "/api/legacy/dev/stress-test", tool: "LegacyDevStressTest" })(async (req: NextRequest) => {
  try {
    const DEV_SIM_TOKEN = process.env.DEV_SIM_TOKEN;
    const token = req.headers.get("x-dev-token") || "";

    if (!DEV_SIM_TOKEN) {
      return NextResponse.json({ error: "DEV_SIM_TOKEN is not set in env." }, { status: 500 });
    }
    if (token !== DEV_SIM_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sleeper_username = String(body.sleeper_username || "").trim().toLowerCase();
    const league_id = body.league_id ? String(body.league_id).trim() : "";
    const include_ai = !!body.include_ai;
    const prefer_cache_only =
      body.prefer_cache_only === undefined ? true : !!body.prefer_cache_only;

    if (!sleeper_username) {
      return NextResponse.json({ error: "Missing sleeper_username" }, { status: 400 });
    }

    const existingSnapshot = league_id
      ? await prisma.sleeperImportCache.findUnique({
          where: {
            sleeperUsername_sleeperLeagueId: {
              sleeperUsername: sleeper_username,
              sleeperLeagueId: league_id,
            },
          },
          select: {
            sleeperLeagueId: true,
            leagueName: true,
            leagueContext: true,
            managerRosters: true,
            fantasyCalcValueMap: true,
          },
        })
      : await prisma.sleeperImportCache.findFirst({
          where: { sleeperUsername: sleeper_username },
          orderBy: { updatedAt: "desc" },
          select: {
            sleeperLeagueId: true,
            leagueName: true,
            leagueContext: true,
            managerRosters: true,
            fantasyCalcValueMap: true,
          },
        });

    if (prefer_cache_only && !existingSnapshot) {
      return NextResponse.json(
        {
          error:
            "No SleeperImportCache found and prefer_cache_only=true. Run Trade Analyzer first.",
        },
        { status: 404 }
      );
    }

    let leagueContext: any = existingSnapshot?.leagueContext || null;
    let managerRosters: any[] = (existingSnapshot?.managerRosters as any[]) || [];
    let fantasyCalcValueMap: any = existingSnapshot?.fantasyCalcValueMap || {};

    if (!existingSnapshot) {
      const pre = await prisma.tradePreAnalysisCache.findUnique({
        where: {
          sleeperUsername_sleeperLeagueId: {
            sleeperUsername: sleeper_username,
            sleeperLeagueId: league_id,
          },
        },
        select: {
          leagueSettings: true,
          managerProfiles: true,
        },
      });

      if (!pre?.leagueSettings || !pre?.managerProfiles) {
        return NextResponse.json(
          { error: "No usable cache found (SleeperImportCache or TradePreAnalysisCache missing data)." },
          { status: 404 }
        );
      }

      leagueContext = pre.leagueSettings;
      managerRosters = pre.managerProfiles as any[];
      fantasyCalcValueMap = fantasyCalcValueMap || {};
    }

    if (!leagueContext || !Array.isArray(managerRosters) || managerRosters.length === 0) {
      return NextResponse.json({ error: "Cached data invalid: missing leagueContext/managerRosters." }, { status: 500 });
    }

    const resolvedLeagueId = league_id || existingSnapshot?.sleeperLeagueId || leagueContext.leagueId;
    if (!resolvedLeagueId) {
      return NextResponse.json({ error: "Missing sleeperLeagueId. Provide league_id." }, { status: 400 });
    }

    await prisma.sleeperImportCache.upsert({
      where: {
        sleeperUsername_sleeperLeagueId: {
          sleeperUsername: sleeper_username,
          sleeperLeagueId: resolvedLeagueId,
        },
      },
      create: {
        sleeperUsername: sleeper_username,
        sleeperLeagueId: resolvedLeagueId,
        leagueName: leagueContext.leagueName || existingSnapshot?.leagueName || null,
        leagueContext: leagueContext as any,
        managerRosters: managerRosters as any,
        fantasyCalcValueMap: fantasyCalcValueMap as any,
      },
      update: {
        leagueName: leagueContext.leagueName || existingSnapshot?.leagueName || null,
        leagueContext: leagueContext as any,
        managerRosters: managerRosters as any,
        fantasyCalcValueMap: fantasyCalcValueMap as any,
      },
    });

    const userRoster = managerRosters[0];
    const snapshot = await buildLeagueIntelSnapshot({
      league: { ...leagueContext, leagueId: resolvedLeagueId },
      userRoster,
      rosters: managerRosters,
      fantasyCalcValueMap,
      prisma,
    });

    attachNeedsSurplus(snapshot, managerRosters);

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
      leagueId: resolvedLeagueId,
      totalTrades: trades.length,
      byLabel: trades.reduce((m: any, t: any) => {
        m[t.acceptanceLabel] = (m[t.acceptanceLabel] || 0) + 1;
        return m;
      }, {}),
      byVeto: trades.reduce((m: any, t: any) => {
        m[t.vetoLikelihood] = (m[t.vetoLikelihood] || 0) + 1;
        return m;
      }, {}),
      parityFlagCount: trades.filter((t: any) => (t.parityFlags?.length || 0) > 0).length,
      idpEnabled: snapshot.idpConfig.enabled,
      cacheOnly: prefer_cache_only,
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
      { error: e?.message || "stress-test failed", detail: j(e) },
      { status: 500 }
    );
  }
})
