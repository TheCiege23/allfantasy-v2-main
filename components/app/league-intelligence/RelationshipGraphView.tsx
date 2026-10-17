"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type MapData = {
  leagueId: string;
  season: number | null;
  nodes: Array<{ nodeId: string; nodeType: string; entityId: string; metadata: Record<string, unknown> | null }>;
  edges: Array<{ edgeId: string; fromNodeId: string; toNodeId: string; edgeType: string; weight: number; metadata?: Record<string, unknown> | null }>;
  rivals: Array<{ nodeA: string; nodeB: string; weight: number }>;
  tradePartners: Array<{ fromNodeId: string; toNodeId: string; tradeCount: number; totalWeight?: number }>;
};

type ViewFilter = "all" | "rivalry" | "trade";

type SelectedEdge = {
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  weight: number;
};

export function RelationshipGraphView({
  leagueId,
  season,
  sport,
  onSelectManager,
}: {
  leagueId: string;
  season: number | null;
  sport?: string | null;
  onSelectManager?: (entityId: string) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdge | null>(null);
  const [relationshipInsight, setRelationshipInsight] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const load = useCallback((options?: { rebuild?: boolean }) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (season != null) params.set("season", String(season));
    if (sport) params.set("sport", sport);
    if (options?.rebuild) params.set("rebuild", "1");
    const query = params.toString();
    const url = `/api/leagues/${encodeURIComponent(leagueId)}/relationship-map${query ? `?${query}` : ""}`;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load map");
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Error");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [leagueId, season, sport]);

  useEffect(() => {
    load();
  }, [load]);

  const nodeLabel = (nodeId: string, entityId: string) => {
    const meta = data?.nodes?.find((n) => n.nodeId === nodeId)?.metadata as Record<string, string> | undefined;
    if (meta?.ownerName) return meta.ownerName;
    if (meta?.teamName) return meta.teamName;
    if (entityId.startsWith("manager:")) return entityId.replace(/^manager:/, "").split(":")[0] ?? entityId;
    return entityId.slice(0, 20);
  };

  if (loading) return <p className="text-sm text-white/60">Loading graph...</p>;
  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return null;

  const selectedNode = selectedNodeId
    ? data.nodes.find((n) => n.nodeId === selectedNodeId) ?? null
    : null;
  const selectedEdgeRecord = selectedEdge
    ? data.edges.find(
        (e) =>
          e.edgeType === selectedEdge.edgeType &&
          ((e.fromNodeId === selectedEdge.fromNodeId && e.toNodeId === selectedEdge.toNodeId) ||
            (e.fromNodeId === selectedEdge.toNodeId && e.toNodeId === selectedEdge.fromNodeId))
      ) ?? selectedEdge
    : null;

  const explainRelationship = async () => {
    if (!selectedEdgeRecord) return;
    setInsightLoading(true);
    setRelationshipInsight(null);
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/graph-insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedEdgeRecord.edgeType === "RIVAL_OF" ? "rivalry" : "timeline",
          season,
          sport,
          focusEntityId: `${selectedEdgeRecord.edgeType}:${selectedEdgeRecord.fromNodeId}:${selectedEdgeRecord.toNodeId}`,
        }),
      });
      if (!res.ok) throw new Error("Failed to explain relationship");
      const json = await res.json();
      setRelationshipInsight(
        json?.readableSummary ??
          json?.metricsInterpretation ??
          json?.momentumStoryline ??
          "No AI explanation available for this relationship."
      );
    } catch (e) {
      setRelationshipInsight(e instanceof Error ? e.message : "Failed to explain relationship");
    } finally {
      setInsightLoading(false);
    }
  };

  const resolveRivalryManagerId = (nodeId: string): string | null => {
    const node = data?.nodes.find((n) => n.nodeId === nodeId);
    if (!node) return null;
    const meta = (node.metadata ?? {}) as Record<string, unknown>;
    if (node.nodeType === "TeamSeason") {
      const externalId = String(meta.externalId ?? "").trim();
      if (externalId) return externalId;
    }
    if (node.nodeType === "Manager") {
      const parts = String(node.entityId).split(":");
      if (parts[0] === "manager" && parts[2]) return String(parts[2]);
      return String(node.entityId);
    }
    return null;
  };

  const openRivalryContext = async () => {
    if (!selectedEdgeRecord || selectedEdgeRecord.edgeType !== "RIVAL_OF") return;
    const sourceEdge = data?.edges.find(
      (edge) =>
        edge.edgeType === selectedEdgeRecord.edgeType &&
        ((edge.fromNodeId === selectedEdgeRecord.fromNodeId &&
          edge.toNodeId === selectedEdgeRecord.toNodeId) ||
          (edge.fromNodeId === selectedEdgeRecord.toNodeId &&
            edge.toNodeId === selectedEdgeRecord.fromNodeId))
    );
    const edgeMeta = (sourceEdge?.metadata ?? {}) as Record<string, unknown>;
    const rivalryId = typeof edgeMeta.rivalryId === "string" ? edgeMeta.rivalryId : null;
    if (rivalryId) {
      router.push(`/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(rivalryId)}`);
      return;
    }
    const managerAId = resolveRivalryManagerId(selectedEdgeRecord.fromNodeId);
    const managerBId = resolveRivalryManagerId(selectedEdgeRecord.toNodeId);
    if (!managerAId || !managerBId) {
      setRelationshipInsight("No linked rivalry record found for this edge.");
      return;
    }
    try {
      const params = new URLSearchParams({
        managerAId,
        managerBId,
        limit: "1",
      });
      if (sport) params.set("sport", sport);
      if (season != null) params.set("season", String(season));
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/rivalries?${params.toString()}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      const resolvedId =
        Array.isArray(json?.rivalries) && typeof json.rivalries[0]?.id === "string"
          ? json.rivalries[0].id
          : null;
      if (!resolvedId) {
        setRelationshipInsight("No linked rivalry record found for this edge.");
        return;
      }
      router.push(`/app/league/${encodeURIComponent(leagueId)}/rivalries/${encodeURIComponent(resolvedId)}`);
    } catch {
      setRelationshipInsight("Could not open rivalry context.");
    }
  };

  const showRivalry = filter === "all" || filter === "rivalry";
  const showTrade = filter === "all" || filter === "trade";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "rivalry", "trade"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-2 py-1 text-xs capitalize ${filter === f ? "bg-white text-black" : "border border-white/10 text-white/70 hover:bg-white/10"}`}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => load()}
          className="rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => load({ rebuild: true })}
          className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/20"
        >
          Rebuild graph
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <p className="mb-2 text-xs text-white/50">
          Nodes: {data.nodes?.length ?? 0} · Edges: {data.edges?.length ?? 0}
        </p>

        {showRivalry && (data.rivals?.length ?? 0) > 0 && (
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium text-white/70">Rivalries</h4>
            <ul className="space-y-2">
              {data.rivals.slice(0, 15).map((r, i) => (
                <li
                  key={`${r.nodeA}-${r.nodeB}-${i}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2 py-1.5 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(r.nodeA);
                      setSelectedEdge(null);
                      setRelationshipInsight(null);
                    }}
                    className="text-cyan-300 hover:underline"
                  >
                    {nodeLabel(r.nodeA, r.nodeA)}
                  </button>
                  <span className="text-white/50">↔</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(r.nodeB);
                      setSelectedEdge(null);
                      setRelationshipInsight(null);
                    }}
                    className="text-cyan-300 hover:underline"
                  >
                    {nodeLabel(r.nodeB, r.nodeB)}
                  </button>
                  <span className="text-white/40">(w:{r.weight})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEdge({
                        fromNodeId: r.nodeA,
                        toNodeId: r.nodeB,
                        edgeType: "RIVAL_OF",
                        weight: r.weight,
                      });
                      setSelectedNodeId(null);
                      setRelationshipInsight(null);
                    }}
                    className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/10"
                  >
                    Edge details
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectManager?.(data.nodes?.find((n) => n.nodeId === r.nodeA)?.entityId ?? r.nodeA)}
                    className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Manager card
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showTrade && (data.tradePartners?.length ?? 0) > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-medium text-white/70">Trade partners</h4>
            <ul className="space-y-2">
              {data.tradePartners.slice(0, 15).map((t, i) => (
                <li
                  key={`${t.fromNodeId}-${t.toNodeId}-${i}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2 py-1.5 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(t.fromNodeId);
                      setSelectedEdge(null);
                      setRelationshipInsight(null);
                    }}
                    className="text-cyan-300 hover:underline"
                  >
                    {nodeLabel(t.fromNodeId, t.fromNodeId)}
                  </button>
                  <span className="text-white/50">⇄</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(t.toNodeId);
                      setSelectedEdge(null);
                      setRelationshipInsight(null);
                    }}
                    className="text-cyan-300 hover:underline"
                  >
                    {nodeLabel(t.toNodeId, t.toNodeId)}
                  </button>
                  <span className="text-white/40">{t.tradeCount} trades</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEdge({
                        fromNodeId: t.fromNodeId,
                        toNodeId: t.toNodeId,
                        edgeType: "TRADED_WITH",
                        weight: t.totalWeight ?? t.tradeCount,
                      });
                      setSelectedNodeId(null);
                      setRelationshipInsight(null);
                    }}
                    className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/10"
                  >
                    Edge details
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectManager?.(data.nodes?.find((n) => n.nodeId === t.fromNodeId)?.entityId ?? t.fromNodeId)}
                    className="rounded border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Manager card
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showRivalry && (data.rivals?.length ?? 0) === 0 && showTrade && (data.tradePartners?.length ?? 0) === 0 && (
          <p className="text-sm text-white/50">No relationships in this view. Try building the graph or selecting All seasons.</p>
        )}
      </div>

      {selectedNode && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-cyan-200">Node detail</h4>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              Back
            </button>
          </div>
          <div className="space-y-1 text-xs text-white/80">
            <div>Node: {selectedNode.nodeId}</div>
            <div>Type: {selectedNode.nodeType}</div>
            <div>Entity: {selectedNode.entityId}</div>
            <div>Name: {nodeLabel(selectedNode.nodeId, selectedNode.entityId)}</div>
          </div>
        </div>
      )}

      {selectedEdgeRecord && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-medium text-amber-200">Edge detail</h4>
            <button
              type="button"
              onClick={() => {
                setSelectedEdge(null);
                setRelationshipInsight(null);
              }}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              Back
            </button>
          </div>
          <div className="space-y-1 text-xs text-white/80">
            <div>Type: {selectedEdgeRecord.edgeType}</div>
            <div>From: {nodeLabel(selectedEdgeRecord.fromNodeId, selectedEdgeRecord.fromNodeId)}</div>
            <div>To: {nodeLabel(selectedEdgeRecord.toNodeId, selectedEdgeRecord.toNodeId)}</div>
            <div>Weight: {selectedEdgeRecord.weight}</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void explainRelationship()}
              disabled={insightLoading}
              className="rounded border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              {insightLoading ? "Explaining..." : "Explain this relationship"}
            </button>
            {selectedEdgeRecord.edgeType === "RIVAL_OF" && (
              <button
                type="button"
                onClick={() => void openRivalryContext()}
                className="rounded border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200 hover:bg-purple-500/20"
              >
                Open rivalry context
              </button>
            )}
          </div>
          {relationshipInsight && (
            <p className="mt-3 text-sm text-white/90">{relationshipInsight}</p>
          )}
        </div>
      )}
    </div>
  );
}
