"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowLeftRight, Scale, Users } from "lucide-react"
import { useTradeBuilder } from "./useTradeBuilder"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"

type TradeBuilderProps = {
  leagueId?: string
}

type Manager = {
  rosterId: number
  displayName: string
  userId: string
  players: { id: string; name: string; pos: string; team?: string }[]
  draftPicks: { season: string; round: number; slot: number | null; originalOwner: string; originalRosterId: number }[]
}

export function TradeBuilder({ leagueId }: TradeBuilderProps) {
  const { proposal, setFromTeam, setPartner, togglePlayer, togglePick, submitProposal, saving, error } =
    useTradeBuilder({ leagueId })
  const [selectedPartner, setSelectedPartner] = useState<string>("")
  const [managers, setManagers] = useState<Manager[]>([])
  const [loadingManagers, setLoadingManagers] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [leagueSport, setLeagueSport] = useState<string>(DEFAULT_SPORT)

  useEffect(() => {
    let cancelled = false
    async function loadManagers() {
      if (!leagueId) {
        setManagers([])
        setLoadError("Missing league context.")
        return
      }
      setLoadingManagers(true)
      setLoadError(null)
      try {
        const leagueRes = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}`, {
          cache: "no-store",
        })
        const leagueJson = await leagueRes.json().catch(() => ({}))
        const normalizedSport = normalizeToSupportedSport(leagueJson?.sport)
        const legacySport = normalizedSport === "NBA" ? "nba" : "nfl"
        if (!cancelled) setLeagueSport(normalizedSport)

        const managersRes = await fetch(
          `/api/legacy/trade/league-managers?league_id=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(legacySport)}`,
          {
            cache: "no-store",
          }
        )
        if (!cancelled) setLeagueSport(normalizedSport)
        const managersData = await managersRes.json().catch(() => null)
        if (!managersRes.ok || !Array.isArray(managersData?.managers)) {
          throw new Error(managersData?.error || "Unable to load league managers.")
        }
        const loadedManagers = managersData.managers as Manager[]
        if (loadedManagers.length < 2) {
          throw new Error("Trade Builder needs at least two managers in the league.")
        }

        const rosterRes = await fetch(`/api/league/roster?leagueId=${encodeURIComponent(leagueId)}`, {
          cache: "no-store",
        })
        const rosterData = await rosterRes.json().catch(() => null)
        const myPlayerIdsRaw = rosterData?.roster
        const myPlayerIds = Array.isArray(myPlayerIdsRaw)
          ? myPlayerIdsRaw
          : Array.isArray(myPlayerIdsRaw?.players)
            ? myPlayerIdsRaw.players
            : []
        const myIdsSet = new Set<string>(myPlayerIds)

        const byOverlap = [...loadedManagers]
          .map((m) => ({
            manager: m,
            overlap: m.players.reduce((n, p) => (myIdsSet.has(p.id) ? n + 1 : n), 0),
          }))
          .sort((a, b) => b.overlap - a.overlap)

        const fromManager = byOverlap[0]?.overlap > 0 ? byOverlap[0].manager : loadedManagers[0]
        const partnerManager = loadedManagers.find((m) => m.rosterId !== fromManager.rosterId) || loadedManagers[1]

        if (!cancelled) {
          setManagers(loadedManagers)
          setSelectedPartner(String(partnerManager.rosterId))
          setFromTeam(String(fromManager.rosterId), fromManager.displayName)
          setPartner(String(partnerManager.rosterId), partnerManager.displayName)
        }
      } catch (e: any) {
        if (!cancelled) {
          setManagers([])
          setLoadError(e?.message || "Unable to load league managers.")
        }
      } finally {
        if (!cancelled) setLoadingManagers(false)
      }
    }
    void loadManagers()
    return () => {
      cancelled = true
    }
  }, [leagueId, setFromTeam, setPartner])

  const fromManager = useMemo(
    () => managers.find((m) => String(m.rosterId) === proposal.from.userId) || null,
    [managers, proposal.from.userId],
  )
  const toManager = useMemo(
    () => managers.find((m) => String(m.rosterId) === proposal.to.userId) || null,
    [managers, proposal.to.userId],
  )

  const fromRoster = fromManager?.players || []
  const toRoster = toManager?.players || []
  const fromPicks = (fromManager?.draftPicks || []).map((pick) => ({
    id: `${pick.season}-${pick.round}-${pick.originalRosterId}`,
    label: `${pick.season} R${pick.round}${pick.slot ? ` (#${pick.slot})` : ""}`,
  }))
  const toPicks = (toManager?.draftPicks || []).map((pick) => ({
    id: `${pick.season}-${pick.round}-${pick.originalRosterId}`,
    label: `${pick.season} R${pick.round}${pick.slot ? ` (#${pick.slot})` : ""}`,
  }))

  const sentAssets = proposal.from.players.length + proposal.from.picks.length
  const recvAssets = proposal.to.players.length + proposal.to.picks.length
  const fairnessScore = 50 + Math.max(-25, Math.min(25, (sentAssets - recvAssets) * 8))

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/80">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-400/50 bg-black/60">
            <ArrowLeftRight className="h-3.5 w-3.5 text-cyan-300" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Trade Center</p>
            <p className="text-[11px] text-white/65">
              Build and submit trade offers from live {leagueSport} league rosters.
            </p>
          </div>
        </div>
      </header>

      {loadingManagers && (
        <div className="rounded-xl border border-white/12 bg-black/40 p-3 text-white/70">Loading league managers...</div>
      )}
      {loadError && (
        <div className="rounded-xl border border-red-400/30 bg-red-950/20 p-3 text-red-200">{loadError}</div>
      )}
      {!loadingManagers && !loadError && managers.length < 2 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-3 text-amber-200">
          Trade Builder is unavailable until manager data is loaded.
        </div>
      )}

      {!loadingManagers && !loadError && managers.length >= 2 && (
        <>

      <div className="rounded-xl border border-white/12 bg-black/40 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/70">Trade partner</span>
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-white/60" />
            <select
              value={selectedPartner}
              onChange={(e) => {
                const id = e.target.value
                setSelectedPartner(id)
                const p = managers.find((m) => String(m.rosterId) === id)
                if (p) setPartner(String(p.rosterId), p.displayName)
              }}
              className="rounded-lg border border-white/20 bg-black/60 px-2 py-1 text-[11px] outline-none"
            >
              {managers
                .filter((m) => String(m.rosterId) !== proposal.from.userId)
                .map((m) => (
                <option key={m.rosterId} value={String(m.rosterId)}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <RosterSide
            label={proposal.from.teamName || "Your roster"}
            roster={fromRoster}
            picks={fromPicks}
            selectedPlayers={proposal.from.players}
            selectedPicks={proposal.from.picks}
            onTogglePlayer={(id) => togglePlayer("from", id)}
            onTogglePick={(id) => togglePick("from", id)}
          />
          <RosterSide
            label={proposal.to.teamName || "Partner roster"}
            roster={toRoster}
            picks={toPicks}
            selectedPlayers={proposal.to.players}
            selectedPicks={proposal.to.picks}
            onTogglePlayer={(id) => togglePlayer("to", id)}
            onTogglePick={(id) => togglePick("to", id)}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/12 bg-black/40 p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-white/70">
          <span className="font-semibold">Trade summary</span>
          <span className="text-white/60">
            Assets selected: you {sentAssets} • partner {recvAssets}
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-1.5 text-[11px] text-white/80">
            <p className="text-white/65">You send:</p>
            <SummaryList
              players={fromRoster}
              picks={fromPicks}
              selectedPlayers={proposal.from.players}
              selectedPicks={proposal.from.picks}
            />
            <p className="mt-1 text-white/65">You receive:</p>
            <SummaryList
              players={toRoster}
              picks={toPicks}
              selectedPlayers={proposal.to.players}
              selectedPicks={proposal.to.picks}
            />
          </div>

          <div className="flex flex-col justify-between rounded-lg border border-white/12 bg-black/50 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-white/70">
              <div className="flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-emerald-300" />
                <span>Asset balance</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-300">
                {fairnessScore.toFixed(0)}/100
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-white/10">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-emerald-400"
                style={{ width: `${Math.max(4, Math.min(96, fairnessScore))}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-white/60">
              This balance tracks selected asset counts only. Final review should use Trade Analyzer.
            </p>
            <button
              type="button"
              onClick={() => void submitProposal()}
              disabled={saving || !proposal.from.userId || !proposal.to.userId}
              className="mt-2 inline-flex items-center justify-center rounded-full bg-cyan-400 px-3 py-1.5 text-[11px] font-semibold text-black shadow-sm hover:bg-cyan-300 disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit trade offer"}
            </button>
            {error && (
              <p className="mt-1 text-[11px] text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
      </>
      )}
    </section>
  )
}

type RosterSideProps = {
  label: string
  roster: { id: string; name: string; team?: string; pos: string }[]
  picks: { id: string; label: string }[]
  selectedPlayers: string[]
  selectedPicks: string[]
  onTogglePlayer: (id: string) => void
  onTogglePick: (id: string) => void
}

function RosterSide({
  label,
  roster,
  picks,
  selectedPlayers,
  selectedPicks,
  onTogglePlayer,
  onTogglePick,
}: RosterSideProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-white/70">{label}</p>
      <div className="space-y-1">
        {roster.map((p) => {
          const selected = selectedPlayers.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onTogglePlayer(p.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] ${
                selected
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-50"
                  : "border-white/12 bg-black/50 text-white/80 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold">
                  {p.pos}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-[11px] text-white/60">{p.team || "FA"}</p>
                </div>
              </div>
              <span className="text-[11px] text-emerald-200">{p.id.slice(0, 8)}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1 space-y-1">
        <p className="text-[11px] text-white/65">Picks</p>
        {picks.map((pick) => {
          const selected = selectedPicks.includes(pick.id)
          return (
            <button
              key={pick.id}
              type="button"
              onClick={() => onTogglePick(pick.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1 text-left text-[11px] ${
                selected
                  ? "border-indigo-400/60 bg-indigo-500/10 text-indigo-50"
                  : "border-white/12 bg-black/40 text-white/80 hover:bg-white/5"
              }`}
            >
              <span>{pick.label}</span>
              <span className="text-[11px] text-indigo-200">Pick</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

type SummaryListProps = {
  players: { id: string; name: string; team?: string; pos: string }[]
  picks: { id: string; label: string }[]
  selectedPlayers: string[]
  selectedPicks: string[]
}

function SummaryList({ players, picks, selectedPlayers, selectedPicks }: SummaryListProps) {
  const anyPlayers = selectedPlayers.length > 0
  const anyPicks = selectedPicks.length > 0

  if (!anyPlayers && !anyPicks) {
    return <p className="text-[11px] text-white/55">Nothing selected.</p>
  }

  return (
    <ul className="space-y-0.5 text-[11px] text-white/80">
      {players
        .filter((p) => selectedPlayers.includes(p.id))
        .map((p) => (
          <li key={p.id}>
            {p.pos} {p.name} ({p.team || "FA"})
          </li>
        ))}
      {picks
        .filter((p) => selectedPicks.includes(p.id))
        .map((p) => (
          <li key={p.id}>
            Pick {p.label}
          </li>
        ))}
    </ul>
  )
}

