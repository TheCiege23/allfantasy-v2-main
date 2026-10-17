"use client";

import { useState, useCallback, useEffect } from "react";
import { RelationshipGraphView } from "./RelationshipGraphView";
import { DynastyTimelineView } from "./DynastyTimelineView";
import { ManagerRelationshipCard } from "./ManagerRelationshipCard";
import { GraphInsightDrawer } from "./GraphInsightDrawer";
import { RivalryEngineList } from "./RivalryEngineList";
import { SUPPORTED_SPORTS } from "@/lib/sport-scope";
import { useUserTimezone } from "@/hooks/useUserTimezone";

export type GraphPanelView = "summary" | "graph" | "timeline" | "managers" | "rivalries";

type RelationshipProfile = {
  leagueId: string;
  season: number | null;
  strongestRivalries: Array<{ nodeA: string; nodeB: string; intensityScore: number; weight: number }>;
  tradeClusters: Array<{ id: string; members: Array<{ nodeId: string; entityId: string }>; internalWeight?: number; dominantPair?: { nodeA: string; nodeB: string; weight: number } }>;
  influenceLeaders: Array<{ nodeId: string; entityId: string; compositeScore: number; centralityScore: number; tradeInfluenceScore: number; rivalryInfluenceScore: number; championshipImpactScore: number }>;
  centralManagers: Array<{ nodeId: string; entityId: string; centralityScore: number; degree: number; weightedDegree: number }>;
  isolatedManagers: Array<{ nodeId: string; entityId: string }>;
  dynastyPowerTransitions: Array<{ fromSeason: number; toSeason: number; fromNodeIds: string[]; toNodeIds: string[]; type: string }>;
  repeatedEliminationPatterns: Array<{ eliminatorNodeId: string; eliminatedNodeId: string; count: number; seasons: number[] }>;
  generatedAt: string;
};

type DynastySeason = { season: number; platformLeagueId: string; importedAt: string };
const ALL_SPORTS = "ALL";

export default function LeagueIntelligenceGraphPanel({
  leagueId,
  isDynasty = false,
}: {
  leagueId: string;
  isDynasty?: boolean;
}) {
  const { formatDateInTimezone } = useUserTimezone();
  const [view, setView] = useState<GraphPanelView>("summary");
  const [season, setSeason] = useState<number | null>(null);
  const [profile, setProfile] = useState<RelationshipProfile | null>(null);
  const [dynastySeasons, setDynastySeasons] = useState<DynastySeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [insightDrawerOpen, setInsightDrawerOpen] = useState(false);
  const [sportFilter, setSportFilter] = useState<string>(ALL_SPORTS);
  const [rivalryExplainId, setRivalryExplainId] = useState<string | null>(null);
  const [rivalryExplainNarrative, setRivalryExplainNarrative] = useState<string | null>(null);
  const [rivalryTimelineId, setRivalryTimelineId] = useState<string | null>(null);
  const [rivalryTimelineData, setRivalryTimelineData] = useState<Array<{ eventType: string; description: string | null; createdAt: string }> | null>(null);
  const [selectedManagerEntityId, setSelectedManagerEntityId] = useState<string | null>(null);

  const loadProfile = useCallback(
    async (seasonParam: number | null, options?: { rebuild?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (seasonParam != null) params.set("season", String(seasonParam));
        if (sportFilter !== ALL_SPORTS) params.set("sport", sportFilter);
        if (options?.rebuild) params.set("rebuild", "1");
        const query = params.toString();
        const url = `/api/leagues/${encodeURIComponent(leagueId)}/relationship-profile${query ? `?${query}` : ""}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load profile"));
        const data = await res.json();
        setProfile(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        setProfile(null);
      } finally {
        setLoading(false);
      }
    },
    [leagueId, sportFilter]
  );

  const loadDynastySeasons = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-backfill`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data?.dynastySeasons) ? data.dynastySeasons : [];
      setDynastySeasons(list.map((d: { season: number; platformLeagueId: string; importedAt: string }) => ({ season: d.season, platformLeagueId: d.platformLeagueId, importedAt: d.importedAt })));
    } catch {
      setDynastySeasons([]);
    }
  }, [leagueId]);

  useEffect(() => {
    void loadProfile(season);
  }, [loadProfile, season, sportFilter]);

  useEffect(() => {
    if (isDynasty) void loadDynastySeasons();
  }, [isDynasty, loadDynastySeasons]);

  const seasonLabel = season != null ? `${season}` : "All (dynasty)";
  const hasHistory = isDynasty && dynastySeasons.length > 0;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">League Intelligence Graph</h2>
        <div className="flex flex-wrap items-center gap-2">
          {isDynasty && (
            <select
              value={season ?? ""}
              onChange={(e) => setSeason(e.target.value === "" ? null : parseInt(e.target.value, 10))}
              className="rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-sm text-white"
            >
              <option value="">All seasons</option>
              {dynastySeasons.map((d) => (
                <option key={d.season} value={d.season}>{d.season}</option>
              ))}
            </select>
          )}
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-sm text-white"
            title="Filter graph by sport"
          >
            <option value={ALL_SPORTS}>All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>{s === "NCAAB" ? "NCAA Basketball" : s === "NCAAF" ? "NCAA Football" : s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadProfile(season)}
            disabled={loading}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
            title="Refresh graph data"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void loadProfile(season, { rebuild: true })}
            disabled={loading}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            title="Rebuild graph nodes and edges"
          >
            Rebuild graph
          </button>
          <button
            type="button"
            onClick={() => setInsightDrawerOpen(true)}
            className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/20"
          >
            Explain with Chimmy
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {(["summary", "graph", "timeline", "managers", "rivalries"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-xs capitalize ${view === v ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"}`}
          >
            {v}
          </button>
        ))}
      </div>

      {hasHistory && (
        <p className="mb-3 text-xs text-white/60">
          Using imported dynasty history ({dynastySeasons.length} seasons). View: {seasonLabel}.
        </p>
      )}

      {loading && <p className="text-sm text-white/60">Loading graph data...</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {!loading && !error && profile && (
        <>
          {view === "summary" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={() => setView("rivalries")}
                className="rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:bg-white/[0.04]"
              >
                <div className="text-xs text-white/50">Rivalries</div>
                <div className="text-lg font-medium text-white">{profile.strongestRivalries?.length ?? 0}</div>
              </button>
              <button
                type="button"
                onClick={() => setView("graph")}
                className="rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:bg-white/[0.04]"
              >
                <div className="text-xs text-white/50">Trade clusters</div>
                <div className="text-lg font-medium text-white">{profile.tradeClusters?.length ?? 0}</div>
              </button>
              <button
                type="button"
                onClick={() => setView("timeline")}
                className="rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:bg-white/[0.04]"
              >
                <div className="text-xs text-white/50">Power transitions</div>
                <div className="text-lg font-medium text-white">{profile.dynastyPowerTransitions?.length ?? 0}</div>
              </button>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 sm:col-span-2 lg:col-span-3">
                <div className="text-xs text-white/50">Top influence</div>
                {profile.influenceLeaders?.[0] ? (
                  <div className="mt-1 text-sm text-white/90">
                    {String((profile.influenceLeaders[0] as { entityId?: string }).entityId ?? "—")} (score: {(profile.influenceLeaders[0] as { compositeScore?: number }).compositeScore?.toFixed(2) ?? "—"})
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-white/60">No data</div>
                )}
              </div>
            </div>
          )}

          {view === "graph" && (
            <RelationshipGraphView
              leagueId={leagueId}
              season={season}
              sport={sportFilter === ALL_SPORTS ? null : sportFilter}
              onSelectManager={(id) => {
                setView("managers");
                setSelectedManagerEntityId(id);
              }}
            />
          )}

          {view === "timeline" && (
            <DynastyTimelineView
              leagueId={leagueId}
              profile={profile}
              dynastySeasons={dynastySeasons}
            />
          )}

          {view === "rivalries" && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/80">Rivalry engine</h3>
              <RivalryEngineList
                leagueId={leagueId}
                sport={sportFilter === ALL_SPORTS ? undefined : sportFilter}
                season={season}
                onExplain={async (rivalryId) => {
                  setRivalryExplainId(rivalryId);
                  setRivalryTimelineId(null);
                  setRivalryTimelineData(null);
                  try {
                    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rivalries/explain`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ rivalryId }),
                    });
                    const data = await res.json().catch(() => ({}));
                    setRivalryExplainNarrative(data.narrative ?? null);
                  } catch {
                    setRivalryExplainNarrative("Could not load explanation.");
                  }
                }}
                onViewTimeline={async (rivalryId) => {
                  setRivalryTimelineId(rivalryId);
                  setRivalryExplainId(null);
                  setRivalryExplainNarrative(null);
                  try {
                    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/rivalries/${rivalryId}/timeline`, { cache: "no-store" });
                    const data = await res.json().catch(() => ({}));
                    setRivalryTimelineData(Array.isArray(data.timeline) ? data.timeline : null);
                  } catch {
                    setRivalryTimelineData([]);
                  }
                }}
              />
              {rivalryExplainNarrative != null && rivalryExplainId && (
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-sm text-white/90">
                  <div className="text-xs text-cyan-300/80 mb-1">Explain this rivalry</div>
                  <p>{rivalryExplainNarrative}</p>
                </div>
              )}
              {rivalryTimelineData != null && rivalryTimelineId && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-white/50 mb-2">Timeline</div>
                  <ul className="space-y-1.5">
                    {(rivalryTimelineData as Array<{ eventType: string; description: string | null; createdAt: string }>).map((e, i) => (
                      <li key={i} className="text-xs text-white/70">
                        <span className="text-white/40">{e.eventType}</span>
                        {e.description ? ` — ${e.description}` : ""}
                        <span className="ml-1 text-white/30">{e.createdAt ? formatDateInTimezone(e.createdAt) : ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {view === "managers" && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/80">Central managers</h3>
              {(profile.centralManagers ?? [])
                .slice()
                .sort((a, b) => {
                  if (!selectedManagerEntityId) return 0;
                  if (a.entityId === selectedManagerEntityId) return -1;
                  if (b.entityId === selectedManagerEntityId) return 1;
                  return 0;
                })
                .slice(0, 8)
                .map((m) => (
                <ManagerRelationshipCard
                  key={m.nodeId}
                  leagueId={leagueId}
                  entityId={m.entityId}
                  nodeId={m.nodeId}
                  centralityScore={m.centralityScore}
                  profile={profile}
                  sport={sportFilter === ALL_SPORTS ? null : sportFilter}
                  season={season}
                  highlighted={selectedManagerEntityId === m.entityId}
                />
              ))}
              {(profile.isolatedManagers ?? []).length > 0 && (
                <>
                  <h3 className="mt-4 text-sm font-medium text-white/80">Isolated</h3>
                  {profile.isolatedManagers.slice(0, 4).map((m) => (
                    <ManagerRelationshipCard
                      key={m.nodeId}
                      leagueId={leagueId}
                      entityId={m.entityId}
                      nodeId={m.nodeId}
                      centralityScore={0}
                      profile={profile}
                      sport={sportFilter === ALL_SPORTS ? null : sportFilter}
                      season={season}
                      highlighted={selectedManagerEntityId === m.entityId}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}

      <GraphInsightDrawer
        open={insightDrawerOpen}
        onClose={() => setInsightDrawerOpen(false)}
        leagueId={leagueId}
        season={season}
        sport={sportFilter === ALL_SPORTS ? null : sportFilter}
      />
    </section>
  );
}
