import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertLeagueMember } from "@/lib/league/league-access";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { evaluateTrade } from "@/lib/decision-os/trade/evaluateTrade";
import { NOT_YOUR_LEAGUE_REASON, resolveEvaluationLeagueId } from "@/lib/decision-os/trade/evaluationLeague";
import { gradeInputsFromLegacyAssets } from "@/lib/decision-os/trade/receiptViews";
import { appliedCounterInputs, legacyPackageGrade, type CounterCandidate } from "@/lib/legacy/legacyPackageGrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AF_TRADE_UNIFICATION_BRIEF Phase 0.5: this route previously had NO auth.
// Now: session required (401), IP rate limit (429), and league membership
// (403) whenever the payload is league-scoped. League-less simulations
// (standalone analyzer flows with no internal league) remain allowed for
// authenticated users only.

/*
 * 🛑 A SIMULATED COUNTER IS GRADED BY THE ONE TRADE GRADE (2026-09-29).
 *
 * This route ran `runTradeAnalysis` (lib/engine/trade) on the countered deal and the AF Legacy
 * analyzer's counter card printed its verdict, "fairness N/100" and an animated acceptance percentage.
 * Now the countered deal — the original deal plus the counter's added/asked player, exactly what the
 * card's Apply button puts in the builder — goes through `evaluateTrade()` and the card prints that
 * letter. Orientation is the legacy analyzer's: Team A receives `assetsA` and sends `assetsB`.
 *
 * It also never worked for its only caller: the card posts `{ originalRequest, appliedCounter }`,
 * which this route did not read, so every "Apply & Simulate" came back 400. It reads that shape now.
 *
 * ⚠ THE LEGACY PAGE SENDS A SLEEPER LEAGUE ID. `assertLeagueMember` keys on an AllFantasy id and
 * answers 404 for a Sleeper one, so a 404 falls through to `resolveEvaluationLeagueId`, which accepts
 * either and proves membership the same way. A 403 (their league, not yours) is still a 403.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toCandidate(value: unknown): CounterCandidate | null {
  if (!isRecord(value)) return null;
  return {
    id: toStringValue(value.id) ?? null,
    name: toStringValue(value.name) ?? null,
    pos: toStringValue(value.pos) ?? null,
    team: toStringValue(value.team) ?? null,
  };
}

/** The deal being countered: the card's `originalRequest`, or one of the older wrapper keys. */
function extractSimulationPayload(rawBody: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["originalRequest", "trade", "proposedTrade", "counterTrade", "simulation"]) {
    const v = rawBody[key];
    if (isRecord(v)) return v;
  }
  return rawBody;
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
    const rl = rateLimit(`trade-simulate-counter:${ip}`, 20, 60_000);
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

    const sourcePayload = extractSimulationPayload(rawBody);

    // League membership gate whenever the simulation is league-scoped.
    // leagueId may live on the raw body or the extracted simulation payload.
    const leagueId =
      toStringValue(rawBody.leagueId) ??
      toStringValue(rawBody.league_id) ??
      toStringValue(sourcePayload.leagueId) ??
      toStringValue(sourcePayload.league_id) ??
      (req.nextUrl.searchParams?.get("leagueId")?.trim() || undefined);

    let gradeLeagueId: string | null = null;
    if (leagueId) {
      const gate = await assertLeagueMember(leagueId, userId);
      if (gate.ok) {
        gradeLeagueId = leagueId;
      } else if (gate.status === 403) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      } else {
        // Not an AllFantasy league id — a provider's (the legacy page's Sleeper id). Same proof.
        gradeLeagueId = await resolveEvaluationLeagueId({ suppliedLeagueId: leagueId, userId });
      }
    }

    const assetsA = Array.isArray(sourcePayload.assetsA) ? sourcePayload.assetsA : [];
    const assetsB = Array.isArray(sourcePayload.assetsB) ? sourcePayload.assetsB : [];
    const applied = isRecord(rawBody.appliedCounter) ? rawBody.appliedCounter : {};
    const addToGive = toCandidate(applied.addToGive);
    const addToGet = toCandidate(applied.addToGet);

    if (assetsA.length === 0 && assetsB.length === 0 && !addToGive && !addToGet) {
      return NextResponse.json(
        {
          ok: false,
          error: "Counter simulation requires at least one asset in assetsA or assetsB.",
        },
        { status: 400 }
      );
    }

    const numTeams = Number(sourcePayload.numTeams) || 12;
    const deal = appliedCounterInputs(
      {
        give: gradeInputsFromLegacyAssets(assetsB as never[], numTeams),
        get: gradeInputsFromLegacyAssets(assetsA as never[], numTeams),
      },
      { addToGive, addToGet },
    );

    const receipt = await evaluateTrade(
      {
        surface: "legacy-counter-simulate",
        leagueId: gradeLeagueId,
        userId,
        give: deal.give,
        get: deal.get,
        viewerSide: false,
      },
      leagueId && !gradeLeagueId
        ? { grade: async () => ({ graded: false, reason: NOT_YOUR_LEAGUE_REASON, basis: null }) }
        : {},
    );

    return NextResponse.json({
      ok: true,
      /** THE grade of the countered deal, for Team A (the side that receives `assetsA`). */
      grade: legacyPackageGrade(receipt.grade),
      evaluationReceiptId: receipt.receiptId,
    });
  } catch (error: unknown) {
    console.error("[trade/simulate-counter] error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to simulate trade counter.",
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
