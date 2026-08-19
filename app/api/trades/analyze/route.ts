import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertLeagueMember } from "@/lib/league/league-access";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { runTradeAnalysis } from "@/lib/engine/trade";
import type {
  TradeEngineRequest,
  LeagueFormat,
  SportKey,
} from "@/lib/engine/trade-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authenticated replacement for the deleted no-auth route
// app/api/engine/trade/analyze/route.ts (AF_TRADE_UNIFICATION_BRIEF Phase 0).
// Auth: session required (401), leagueId required + league membership (403),
// IP rate limit (429). The request/response shape of the old route is preserved
// so the /api/app proxies keep working unchanged.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toAssetArray(value: unknown): TradeEngineRequest["assetsA"] {
  return Array.isArray(value) ? (value as TradeEngineRequest["assetsA"]) : [];
}

function normalizeLeagueFormat(value: unknown): LeagueFormat {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  switch (raw) {
    case "dynasty":
      return "dynasty";
    case "redraft":
      return "redraft";
    case "keeper":
      return "keeper";
    default:
      return "dynasty";
  }
}

function normalizeSport(value: unknown): SportKey {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/_/g, "");

  switch (raw) {
    case "NFL":
      return "NFL";
    case "NBA":
      return "NBA";
    case "MLB":
      return "MLB";
    case "NHL":
      return "NHL";
    case "NCAAF":
    case "CFB":
    case "COLLEGEFOOTBALL":
      return "NCAAF";
    case "NCAAB":
    case "CBB":
    case "COLLEGEBASKETBALL":
      return "NCAAB";
    case "SOCCER":
    case "FUTBOL":
    case "FOOTBALL":
      return "SOCCER";
    case "GOLF":
    case "PGA":
      return "GOLF";
    case "NASCAR":
      return "NASCAR";
    case "WWE":
      return "WWE";
    case "AEW":
      return "AEW";
    case "CRICKET":
      return "CRICKET";
    case "CUSTOM":
      return "CUSTOM";
    default:
      return "NFL";
  }
}

type AnalyzeTradeRouteRequest = TradeEngineRequest & {
  rosterIdA?: number;
  rosterIdB?: number;
};

function buildTradeRequest(body: Record<string, unknown>): AnalyzeTradeRouteRequest {
  const leagueId =
    toStringValue(body.leagueId) ?? toStringValue(body.league_id);

  const teamAName = toStringValue(body.teamAName);
  const teamBName = toStringValue(body.teamBName);
  const rosterIdA = toNumberValue(body.rosterIdA);
  const rosterIdB = toNumberValue(body.rosterIdB);

  const request: AnalyzeTradeRouteRequest = {
    sport: normalizeSport(body.sport),
    format: normalizeLeagueFormat(body.format),
    assetsA: toAssetArray(body.assetsA),
    assetsB: toAssetArray(body.assetsB),
  };

  if (leagueId) {
    request.leagueId = leagueId;
    request.league_id = leagueId;
  }

  if (teamAName) {
    request.teamAName = teamAName;
  }

  if (teamBName) {
    request.teamBName = teamBName;
  }

  if (rosterIdA !== undefined) {
    request.rosterIdA = rosterIdA;
  }

  if (rosterIdB !== undefined) {
    request.rosterIdB = rosterIdB;
  }

  if (body.leagueContext !== undefined) {
    request.leagueContext = body.leagueContext as TradeEngineRequest["leagueContext"];
  }

  if (body.rosterA !== undefined && Array.isArray(body.rosterA)) {
    request.rosterA = body.rosterA as TradeEngineRequest["rosterA"];
  }

  if (body.rosterB !== undefined && Array.isArray(body.rosterB)) {
    request.rosterB = body.rosterB as TradeEngineRequest["rosterB"];
  }

  if (body.marketContext !== undefined) {
    request.marketContext =
      body.marketContext as TradeEngineRequest["marketContext"];
  }

  if (body.nflContext !== undefined) {
    request.nflContext = body.nflContext as TradeEngineRequest["nflContext"];
  }

  if (typeof body.tradeGoal === "string") {
    request.tradeGoal = body.tradeGoal;
  }

  if (body.numTeams !== undefined) {
    const numTeams = toNumberValue(body.numTeams);
    if (numTeams !== undefined) {
      request.numTeams = numTeams;
    }
  }

  if (body.newsAdjustments !== undefined) {
    request.newsAdjustments =
      body.newsAdjustments as TradeEngineRequest["newsAdjustments"];
  }

  if (body.options !== undefined) {
    request.options = body.options as TradeEngineRequest["options"];
  }

  if (typeof body.sleeper_username_a === "string") {
    request.sleeper_username_a = body.sleeper_username_a;
  }

  if (typeof body.sleeper_username_b === "string") {
    request.sleeper_username_b = body.sleeper_username_b;
  }

  if (body.sleeperUserA !== undefined) {
    request.sleeperUserA =
      body.sleeperUserA as TradeEngineRequest["sleeperUserA"];
  }

  if (body.sleeperUserB !== undefined) {
    request.sleeperUserB =
      body.sleeperUserB as TradeEngineRequest["sleeperUserB"];
  }

  return request;
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string };
    } | null;
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = getClientIp(req) || "unknown";
    const rl = rateLimit(`trades-analyze:${ip}`, 20, 60_000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429 }
      );
    }

    const rawBody: unknown = await req.json();

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Request body must be a JSON object.",
        },
        { status: 400 }
      );
    }

    // League scope: from the body (old route contract) or the query string
    // (how both /api/app proxies pass it). Required — every trade evaluation
    // must be scoped to a league the caller belongs to.
    const bodyLeagueId =
      toStringValue(rawBody.leagueId) ?? toStringValue(rawBody.league_id);
    const queryLeagueId = req.nextUrl.searchParams?.get("leagueId")?.trim() || undefined;
    const leagueId = bodyLeagueId ?? queryLeagueId;
    if (!leagueId) {
      return NextResponse.json({ error: "leagueId required" }, { status: 400 });
    }

    const gate = await assertLeagueMember(leagueId, userId);
    if (!gate.ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: gate.status });
    }

    const payload = buildTradeRequest(rawBody);

    if (payload.assetsA.length === 0 && payload.assetsB.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Trade analysis requires at least one asset in assetsA or assetsB.",
        },
        { status: 400 }
      );
    }

    const result = await runTradeAnalysis(payload);

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error: unknown) {
    console.error("[trades/analyze] error:", error);

    const message =
      error instanceof Error ? error.message : "Failed to analyze trade.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
    },
  });
}
