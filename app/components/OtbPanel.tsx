"use client";

import React, { useMemo, useState } from "react";
import HeroMetricAI from "@/app/components/HeroMetricAI";
import { selectTopTradeCandidate, formatTradeHeadline } from "@/lib/ui/selectTopCandidate";

type OTBPlayer = {
  player_id: string;
  player_name: string;
  position?: string;
  team?: string | null;
  on_block_by?: string;
  notes?: string | null;
};

type UserRosterPlayer = {
  id: string;
  name: string;
  pos?: string;
  team?: string;
  isOtb?: boolean;
};

type TradeCandidate = any;

function cx(...p: Array<string | false | null | undefined>) {
  return p.filter(Boolean).join(" ");
}

export default function OtbPanel({
  otbPlayers,
  otbTradesByPlayerId,
  onSelectPlayer,
  selectedPlayerId,
  loading,
  userRoster,
  userRosterId,
  leagueId,
  username,
  onToggleOtb,
}: {
  otbPlayers: OTBPlayer[];
  otbTradesByPlayerId: Record<string, TradeCandidate[] | undefined>;
  selectedPlayerId?: string | null;
  onSelectPlayer: (playerId: string) => void;
  loading?: boolean;
  userRoster?: UserRosterPlayer[];
  userRosterId?: number | null;
  leagueId?: string;
  username?: string;
  onToggleOtb?: (player: UserRosterPlayer, isCurrentlyOtb: boolean) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<string>("ALL");
  const [sort, setSort] = useState<"alpha" | "pos">("alpha");
  const [myQuery, setMyQuery] = useState("");
  const [togglingPlayerId, setTogglingPlayerId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = otbPlayers || [];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.player_name.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          (p.position || "").toLowerCase().includes(q) ||
          (p.on_block_by || "").toLowerCase().includes(q)
      );
    }
    if (pos !== "ALL") list = list.filter((p) => (p.position || "").toUpperCase() === pos);
    if (sort === "alpha") list = [...list].sort((a, b) => a.player_name.localeCompare(b.player_name));
    if (sort === "pos") list = [...list].sort((a, b) => (a.position || "").localeCompare(b.position || ""));
    return list;
  }, [otbPlayers, query, pos, sort]);

  const myFilteredRoster = useMemo(() => {
    if (!userRoster) return [];
    let list = userRoster;
    if (myQuery.trim()) {
      const q = myQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.team || "").toLowerCase().includes(q) ||
          (p.pos || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [userRoster, myQuery]);

  const handleToggle = async (player: UserRosterPlayer, isCurrentlyOtb: boolean) => {
    if (!onToggleOtb) return;
    setTogglingPlayerId(player.id);
    try {
      await onToggleOtb(player, isCurrentlyOtb);
    } finally {
      setTogglingPlayerId(null);
    }
  };

  const selectedTrades = selectedPlayerId ? otbTradesByPlayerId[selectedPlayerId] ?? [] : [];
  const top = selectTopTradeCandidate(selectedTrades);
  const why = [
    ...(top?.explanation?.whyYouAccept ?? []),
    ...(top?.explanation?.whyTheyAccept ?? []),
    ...(top?.ai?.targetWhy ?? []),
    ...(top?.ai?.timingNarrative ?? []),
  ].filter(Boolean).slice(0, 4);

  return (
    <div className="space-y-4">
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg sm:text-xl font-bold text-cyan-300">OTB · On The Block</h3>
          <p className="text-xs sm:text-sm text-white/60">
            Shop players that league managers have flagged as available.
          </p>
        </div>
        {loading ? (
          <span className="text-xs text-white/50">Loading OTB…</span>
        ) : null}
      </div>

      <HeroMetricAI
        value={selectedPlayerId ? formatTradeHeadline(top) : "Select an OTB player"}
        label="Top OTB Target"
        helper="Cheapest fair package that the other manager is most likely to accept"
        accent="purple"
        confidence={top?.ai?.confidence}
        whyBullets={why}
      />

      {/* My OTB - Mark your players */}
      {userRoster && userRoster.length > 0 && (
        <div className="rounded-2xl border border-purple-400/20 bg-purple-500/5 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <div className="text-sm font-semibold text-purple-200">My Trade Block</div>
              <div className="text-xs text-white/50">Mark players you're willing to trade</div>
            </div>
            <div className="text-xs text-white/50">
              {userRoster.filter(p => p.isOtb).length} marked
            </div>
          </div>

          <input
            value={myQuery}
            onChange={(e) => setMyQuery(e.target.value)}
            placeholder="Search your roster…"
            className="w-full mb-3 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white/85 placeholder:text-white/35 focus:outline-none focus:border-purple-400/30 text-sm"
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[200px] overflow-auto pr-1">
            {myFilteredRoster.map((p) => {
              const isOtb = p.isOtb === true;
              const isToggling = togglingPlayerId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleToggle(p, isOtb)}
                  disabled={isToggling || !onToggleOtb}
                  className={cx(
                    "text-left rounded-xl border px-3 py-2 transition text-sm",
                    isOtb
                      ? "border-purple-400/40 bg-purple-500/20"
                      : "border-white/10 bg-black/20 hover:bg-white/[0.06]",
                    isToggling && "opacity-50"
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-white/85 truncate text-xs">{p.name}</div>
                      <div className="text-[11px] text-white/50">{p.pos} · {p.team || "—"}</div>
                    </div>
                    {isOtb ? (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 border border-purple-400/30">
                        OTB
                      </span>
                    ) : (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
                        +
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[11px] uppercase tracking-wide text-white/50">League OTB Players</div>
            <div className="flex items-center gap-2">
              <select
                value={pos}
                onChange={(e) => setPos(e.target.value)}
                className="text-xs rounded-lg bg-black/40 border border-white/10 text-white/80 px-2 py-1"
              >
                <option value="ALL">All</option>
                <option value="QB">QB</option>
                <option value="RB">RB</option>
                <option value="WR">WR</option>
                <option value="TE">TE</option>
                <option value="K">K</option>
                <option value="DEF">DEF</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as any)}
                className="text-xs rounded-lg bg-black/40 border border-white/10 text-white/80 px-2 py-1"
              >
                <option value="alpha">A→Z</option>
                <option value="pos">Position</option>
              </select>
            </div>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player / team / manager…"
            className="w-full mb-3 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white/85 placeholder:text-white/35 focus:outline-none focus:border-purple-400/30"
          />

          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {filtered.length === 0 ? (
              <div className="text-sm text-white/50">No OTB players found.</div>
            ) : (
              filtered.map((p) => {
                const active = selectedPlayerId === p.player_id;
                return (
                  <button
                    key={p.player_id}
                    onClick={() => onSelectPlayer(p.player_id)}
                    className={cx(
                      "w-full text-left rounded-xl border px-3 py-2 transition",
                      active
                        ? "border-purple-400/30 bg-purple-500/10"
                        : "border-white/10 bg-black/20 hover:bg-white/[0.06]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white/85 truncate">{p.player_name}</div>
                        <div className="text-xs text-white/55">
                          {(p.position || "—")} · {(p.team || "—")}
                          {p.on_block_by ? ` · OTB by ${p.on_block_by}` : ""}
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-purple-400/20 bg-purple-500/10 text-purple-200">
                        OTB
                      </span>
                    </div>
                    {p.notes ? (
                      <div className="mt-1 text-xs text-white/55 line-clamp-2">{p.notes}</div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[11px] uppercase tracking-wide text-white/50">Cheapest fair packages</div>
            <div className="text-xs text-white/50">
              {selectedPlayerId ? `${selectedTrades.length} offers` : "Select a player"}
            </div>
          </div>

          {!selectedPlayerId ? (
            <div className="text-sm text-white/55">
              Pick an OTB player on the left to generate offers.
            </div>
          ) : selectedTrades.length === 0 ? (
            <div className="text-sm text-white/55">
              No offers generated yet (or the OTB endpoint isn't wired). Once the OTB engine runs, offers will show here.
            </div>
          ) : (
            <div className="space-y-3">
              {selectedTrades.slice(0, 8).map((t: any) => (
                <div key={t.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-sm font-semibold text-white/85">{formatTradeHeadline(t)}</div>
                  <div className="mt-1 text-xs text-white/60">
                    {t.acceptanceLabel ? `Acceptance: ${t.acceptanceLabel}` : null}
                    {t.vetoLikelihood ? ` · Veto: ${t.vetoLikelihood}` : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {(t.explanation?.whyYouAccept ?? []).slice(0, 2).map((x: string, i: number) => (
                      <div key={i} className="text-xs text-white/70">
                        <span className="text-white/40 mr-2">•</span>
                        {x}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
