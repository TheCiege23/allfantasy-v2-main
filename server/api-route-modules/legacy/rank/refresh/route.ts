import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeLegacyRankPreview } from "@/lib/ranking/computeLegacyRank";
import { trackLegacyToolUsage } from "@/lib/analytics-server";
import { requireLegacySleeperIdentity } from "@/lib/legacy/requireLegacySleeperIdentity";
import { buildIntelligenceEvidence, type LegacyDataStatus } from "@/lib/legacy/dataStatus";
import { recordProductEvent } from "@/lib/analytics";
import { LEGACY_HONESTY } from "@/lib/analytics/eventNames";

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const POST = withApiUsage({ endpoint: "/api/legacy/rank/refresh", tool: "LegacyRankRefresh" })(async (request: NextRequest) => {
  const requestedUsername = request.nextUrl.searchParams?.get("sleeper_username");

  /*
   * This route carried BOTH defects at once. It recomputed rankings for whatever username
   * the query string named — an unauthenticated write anyone could trigger for anyone —
   * and its limiter keyed on that same self-asserted username with `includeIpInKey: false`,
   * so rotating the username reset the budget and the "1 per 60s" cap never bound.
   *
   * Resolving identity server-side fixes both: the username can no longer be chosen, and
   * the limiter below keys on the resolved actor, which a caller cannot vary.
   *
   * allowGuest: the ranking surface is reachable right after a guest import.
   */
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername,
    rateLimit: { action: "rank_refresh", maxRequests: 1, windowMs: 60_000 },
  });
  if (!gate.ok) return gate.response;

  const uname = gate.identity.sleeperUsername.toLowerCase();

  const legacyUser = await prisma.legacyUser.findFirst({
    where: { sleeperUsername: uname },
    select: { id: true, sleeperUsername: true, sleeperUserId: true },
  });

  if (!legacyUser) {
    return NextResponse.json({ error: "Legacy user not found. Run import first." }, { status: 404 });
  }

  const leagues = await prisma.legacyLeague.findMany({
    where: { userId: legacyUser.id },
    orderBy: [{ season: "desc" }, { name: "asc" }],
    include: {
      seasonSummary: true,
      rosters: {
        where: {
          OR: [{ ownerId: legacyUser.sleeperUserId }, { isOwner: true }],
        },
      },
    },
  });

  const myRosterByLeagueId = new Map<string, any>();
  for (const lg of leagues as any[]) {
    const candidates = lg.rosters ?? [];
    const byOwnerId =
      candidates.find((r: any) => r.ownerId != null && String(r.ownerId) === String(legacyUser.sleeperUserId)) ?? null;
    const byIsOwner = candidates.find((r: any) => r.isOwner === true) ?? null;
    const myRoster = byOwnerId ?? byIsOwner;
    if (myRoster) myRosterByLeagueId.set(lg.id, myRoster);
  }

  const myRosters = Array.from(myRosterByLeagueId.values());

  const seasonsPlayed = new Set((leagues as any[]).map((lg) => lg.season)).size || 1;
  const totalWins = myRosters.reduce((s, r) => s + safeNum(r.wins), 0);

  const championships = (leagues as any[]).reduce((s, lg) => {
    const r = myRosterByLeagueId.get(lg.id);
    if (!r) return s;
    const fallbackChampion = lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId);
    return s + ((r.isChampion || fallbackChampion) ? 1 : 0);
  }, 0);

  const league_history = (leagues as any[]).map((lg) => {
    const r = myRosterByLeagueId.get(lg.id);

    const wins = safeNum(r?.wins, 0);
    const losses = safeNum(r?.losses, 0);
    const ties = safeNum(r?.ties, 0);

    const fallbackChampion =
      r && lg.winnerRosterId != null && safeNum(lg.winnerRosterId) === safeNum(r.rosterId);
    const isChampion = !!r?.isChampion || !!fallbackChampion;

    const playoffTeams = safeNum((lg as any).playoffTeams, 0);
    const finalStanding = r?.finalStanding != null ? safeNum(r.finalStanding, 0) : null;
    const playoffSeed = r?.playoffSeed != null ? safeNum(r.playoffSeed, 0) : null;

    const madePlayoffs =
      (playoffSeed != null && playoffSeed > 0) ||
      isChampion ||
      (playoffTeams > 0 && finalStanding != null && finalStanding > 0 && finalStanding <= playoffTeams);

    return {
      season: lg.season,
      sport: lg.sport,
      type: lg.leagueType,
      scoring: lg.scoringType,
      team_count: lg.teamCount,

      wins,
      losses,
      ties,

      made_playoffs: !!madePlayoffs,
      is_champion: !!isChampion,
    };
  });

  if (league_history.length === 0) {
    return NextResponse.json(
      { error: "No leagues found yet. Import your Sleeper history first." },
      { status: 404 }
    );
  }

  const playoffAppearances = league_history.reduce((s, lg) => s + (lg.made_playoffs ? 1 : 0), 0);

  const preview = computeLegacyRankPreview({
    totals: {
      seasons_imported: seasonsPlayed,
      leagues_played: myRosters.length,
      wins: totalWins,
      playoffs: playoffAppearances,
      championships,
    },
    leagueHistory: league_history as any,
  });

  // Keep DB caching for fast loads and "stale" detection
  await prisma.$executeRaw`
    INSERT INTO legacy_user_rank_cache (
      legacy_user_id,
      career_xp, career_level, career_tier, career_tier_name,
      baseline_year_xp, ai_low_year_xp, ai_mid_year_xp, ai_high_year_xp,
      assumptions_json,
      last_calculated_at,
      last_refresh_at
    )
    VALUES (
      ${legacyUser.id},
      ${preview.career.xp}, ${preview.career.level}, ${preview.career.tier}, ${preview.career.tier_name},
      ${preview.yearly_projection.baseline_year_xp},
      ${preview.yearly_projection.ai_low_year_xp},
      ${preview.yearly_projection.ai_mid_year_xp},
      ${preview.yearly_projection.ai_high_year_xp},
      ${JSON.stringify(preview.yearly_projection.assumptions)}::jsonb,
      now(),
      now()
    )
    ON CONFLICT (legacy_user_id)
    DO UPDATE SET
      career_xp = EXCLUDED.career_xp,
      career_level = EXCLUDED.career_level,
      career_tier = EXCLUDED.career_tier,
      career_tier_name = EXCLUDED.career_tier_name,
      baseline_year_xp = EXCLUDED.baseline_year_xp,
      ai_low_year_xp = EXCLUDED.ai_low_year_xp,
      ai_mid_year_xp = EXCLUDED.ai_mid_year_xp,
      ai_high_year_xp = EXCLUDED.ai_high_year_xp,
      assumptions_json = EXCLUDED.assumptions_json,
      last_calculated_at = now(),
      last_refresh_at = now()
  `;

  // Track tool usage
  trackLegacyToolUsage('rank_refresh', legacyUser.id)

  // Honesty envelope: the rank preview is DERIVED from imported history, and a manager with
  // one thin season gets a numerically confident preview — the evidence block says how much
  // history actually backs it. Rosterless leagues mean career stats coalesced from nothing.
  const rosterlessLeagues = (leagues as any[]).length - myRosters.length;
  const evidence = buildIntelligenceEvidence({
    importedSeasonCount: seasonsPlayed,
    matchupCount: league_history.reduce((s, lg) => s + safeNum(lg.wins, 0) + safeNum(lg.losses, 0) + safeNum(lg.ties, 0), 0),
    tradeCount: null,
    rosterCount: myRosters.length,
    basedOn: ['Imported Sleeper league history', 'league settings'],
  });
  if (evidence.confidence === 'low') {
    recordProductEvent(LEGACY_HONESTY.INTELLIGENCE_LOW_CONFIDENCE_SHOWN, {
      path: '/api/legacy/rank/refresh',
      meta: { surface: 'rank_preview', platform: 'sleeper', seasonsPlayed, rosterCount: myRosters.length },
    });
  }

  return NextResponse.json({
    ok: true,
    ranking_preview: preview,
    // Preserved from the old hand-rolled limiter: app/af-legacy reads this to render the
    // remaining-refreshes counter, so dropping it would blank that UI rather than error.
    rate_limit: gate.rateLimit ?? null,
    meta: {
      status: {
        state: rosterlessLeagues > 0 ? 'partial' : 'available',
        confidence: evidence.confidence,
        source: 'derived',
        lastUpdatedAt: new Date().toISOString(),
        reasonCode: rosterlessLeagues > 0 ? 'ROSTERS_MISSING_FOR_SOME_LEAGUES' : undefined,
        message:
          rosterlessLeagues > 0
            ? `Your roster could not be found in ${rosterlessLeagues} imported league(s); those seasons are not counted.`
            : 'Ranking preview computed from your imported Sleeper history.',
        retryable: false,
      } satisfies LegacyDataStatus,
      evidence,
    },
  });
})

