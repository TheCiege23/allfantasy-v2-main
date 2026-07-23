"use client"

import Link from "next/link"
import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { SmartDataView } from "@/components/app/league/SmartDataView"
import PlayerDetailModal from "@/components/PlayerDetailModal"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import LeagueIntelligenceGraphPanel from "@/components/app/league-intelligence/LeagueIntelligenceGraphPanel"
import { UnifiedRelationshipInsightsPanel } from "@/components/app/league-intelligence/UnifiedRelationshipInsightsPanel"
import { LeagueForecastSection } from "@/components/simulation/LeagueForecastSection"
import { DynastyProjectionPanel } from "@/components/dynasty/DynastyProjectionPanel"
import WarehouseHistoryPanel from "@/components/app/tabs/WarehouseHistoryPanel"
import { useLegacyTab } from "@/hooks/useLegacyTab"
import { postMarketRefresh } from "@/lib/api/legacy"
import { trackDiscoveryLeagueView } from "@/lib/discovery-analytics/client"
import type {
  GetDraftWarRoomQuery,
  GetTradeCommandCenterQuery,
  LegacyApiResponse,
  MarketRefreshData,
} from "@/types/legacy"

type LeagueTab =
  | "Overview"
  | "Team"
  | "Matchups"
  | "Roster"
  | "Players"
  | "Waivers"
  | "Trades"
  | "Draft"
  | "Standings/Playoffs"
  | "League"
  | "Intelligence"
  | "Chat"
  | "Settings"
  | "Previous Leagues"

const LEAGUE_TABS: LeagueTab[] = [
  "Overview",
  "Team",
  "Matchups",
  "Roster",
  "Players",
  "Waivers",
  "Trades",
  "Draft",
  "Standings/Playoffs",
  "League",
  "Intelligence",
  "Chat",
  "Settings",
  "Previous Leagues",
]

function isLeagueTab(tab: string | null | undefined): tab is LeagueTab {
  return tab != null && LEAGUE_TABS.includes(tab as LeagueTab)
}

type LeagueSummary = {
  id: string
  name: string
  sport?: string | null
  joinCode?: string
  tournamentId?: string
  _count?: { members?: number; entries?: number }
}

type StandingsResponse = {
  standings?: Array<{
    entryId: string
    entryName: string
    ownerName: string
    points: number
    picksCount: number
    rank: number
    tiebreakerPoints?: number | null
    tiebreakerDelta?: number | null
  }>
}

type EntriesResponse = {
  entries?: Array<{
    id: string
    name: string
    userId: string
    createdAt: string
    picks?: Array<{ id: string; round: number; points: number | null }>
  }>
}

type RosterResponse = {
  roster?: unknown
  faabRemaining?: number
  error?: string
}

type ChatResponse = {
  messages?: Array<{
    id: string
    message: string
    createdAt: string
    user?: { displayName?: string | null; email?: string | null }
  }>
}


function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <section
      className={`mode-panel rounded-2xl p-5 shadow-lg ${accent ? "border border-cyan-400/40 bg-cyan-900/10" : ""}`}
      style={{ minHeight: 120 }}
    >
      <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
        {accent && <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function InlineNote({ text }: { text: string }) {
  return <p className="mode-muted text-sm">{text}</p>
}

export default function LeagueHomeShellPage() {
    // Player modal state
    const [selectedPlayer, setSelectedPlayer] = useState<any | null>(null)
    const [playerModalOpen, setPlayerModalOpen] = useState(false)
  const params = useParams<{ leagueId: string }>() ?? ({} as { leagueId: string })
  const searchParams = useSearchParams()
  const leagueId = params?.leagueId || "unknown"
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<LeagueTab>("Overview")

  const [leagueSummary, setLeagueSummary] = useState<LeagueSummary | null>(null)
  const [standings, setStandings] = useState<StandingsResponse["standings"]>([])
  const [entries, setEntries] = useState<EntriesResponse["entries"]>([])
  const [rosterData, setRosterData] = useState<RosterResponse | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatResponse["messages"]>([])
  const [dataError, setDataError] = useState<string | null>(null)
  const [loadingLeagueData, setLoadingLeagueData] = useState<boolean>(true)
  const [legacyIdentitySource, setLegacyIdentitySource] = useState<string>('session_fallback')
  const [resolvedLegacyUserId, setResolvedLegacyUserId] = useState<string>('')

  const [draftPick, setDraftPick] = useState<number>(7)
  const [draftRound, setDraftRound] = useState<number>(1)

  const [waiverRefresh, setWaiverRefresh] = useState<LegacyApiResponse<MarketRefreshData> | null>(null)
  const [waiverLoading, setWaiverLoading] = useState<boolean>(false)
  const trackedDiscoveryViewRef = useRef(false)

  const isAuthenticated = status === "authenticated"

  const userLabel = useMemo(() => {
    if (!isAuthenticated) return "Guest"
    return session?.user?.name || session?.user?.email || "User"
  }, [isAuthenticated, session?.user?.email, session?.user?.name])

  const legacyUserKey = useMemo(() => {
    if (resolvedLegacyUserId) return resolvedLegacyUserId
    const sessionId = (session?.user as { id?: string } | undefined)?.id
    return sessionId || session?.user?.email || ""
  }, [resolvedLegacyUserId, session])

  const tradeQuery = useMemo<GetTradeCommandCenterQuery | null>(() => {
    if (!legacyUserKey || !leagueId || !isAuthenticated) return null
    return {
      leagueId,
      userId: legacyUserKey,
      includeIncomingOffers: true,
      includeSentOffers: true,
      includeExpiredOffers: true,
      includeOfferBuilder: true,
    }
  }, [legacyUserKey, leagueId, isAuthenticated])

  const draftQuery = useMemo<GetDraftWarRoomQuery | null>(() => {
    if (!legacyUserKey || !leagueId || !isAuthenticated) return null
    return {
      leagueId,
      userId: legacyUserKey,
      draftId: `draft_${leagueId}_rookie`,
      overallPick: draftPick,
      round: draftRound,
      includeSimulation: true,
      includePredictedPicksAhead: true,
    }
  }, [legacyUserKey, leagueId, draftPick, draftRound, isAuthenticated])

  const tradeTab = useLegacyTab(
    "trade_command_center",
    (tradeQuery || { leagueId: "", userId: "" }) as GetTradeCommandCenterQuery,
    { enabled: Boolean(tradeQuery), autoRefresh: true },
  )

  const draftTab = useLegacyTab(
    "draft_war_room",
    (draftQuery || {
      leagueId: "",
      userId: "",
      draftId: "",
      overallPick: 1,
      round: 1,
    }) as GetDraftWarRoomQuery,
    { enabled: Boolean(draftQuery), autoRefresh: true },
  )

  const loadLeagueData = useCallback(async () => {
    if (!leagueId) {
      setLoadingLeagueData(false)
      return
    }
    if (!isAuthenticated) {
      setLoadingLeagueData(false)
      return
    }
    setLoadingLeagueData(true)
    setDataError(null)

    try {
      const [myLeaguesRes, standingsRes, entriesRes, rosterRes, chatRes] = await Promise.all([
        fetch("/api/bracket/my-leagues", { cache: "no-store" }),
        fetch(`/api/bracket/leagues/${leagueId}/standings`, { cache: "no-store" }),
        fetch(`/api/bracket/entries?leagueId=${encodeURIComponent(leagueId)}`, { cache: "no-store" }),
        fetch(`/api/league/roster?leagueId=${encodeURIComponent(leagueId)}`, { cache: "no-store" }),
        fetch(`/api/bracket/leagues/${leagueId}/chat`, { cache: "no-store" }),
      ])

      const myLeaguesJson = await myLeaguesRes.json().catch(() => ({}))
      const standingsJson: StandingsResponse = await standingsRes.json().catch(() => ({}))
      const entriesJson: EntriesResponse = await entriesRes.json().catch(() => ({}))
      const rosterJson: RosterResponse = await rosterRes.json().catch(() => ({}))
      const chatJson: ChatResponse = await chatRes.json().catch(() => ({}))

      const leagues = Array.isArray(myLeaguesJson?.leagues) ? (myLeaguesJson.leagues as LeagueSummary[]) : []
      setLeagueSummary(leagues.find((l) => l.id === leagueId) || null)
      setStandings(Array.isArray(standingsJson?.standings) ? standingsJson.standings : [])
      setEntries(Array.isArray(entriesJson?.entries) ? entriesJson.entries : [])
      setRosterData(rosterJson)
      setChatMessages(Array.isArray(chatJson?.messages) ? chatJson.messages.slice(-20) : [])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load league data"
      setDataError(message)
    } finally {
      setLoadingLeagueData(false)
    }
  }, [isAuthenticated, leagueId])

  const refreshWaiverPanel = useCallback(async () => {
    if (!legacyUserKey || !leagueId || !isAuthenticated) return
    setWaiverLoading(true)
    try {
      const response = await postMarketRefresh({
        leagueId,
        userId: legacyUserKey,
        scope: "waivers",
        forceLiveNewsRefresh: true,
      })
      setWaiverRefresh(response)
    } finally {
      setWaiverLoading(false)
    }
  }, [legacyUserKey, leagueId, isAuthenticated])

  useEffect(() => {
    void loadLeagueData()
  }, [loadLeagueData])

  useEffect(() => {
    const tabParam = searchParams?.get("tab") ?? null
    if (isLeagueTab(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  useEffect(() => {
    let mounted = true

    async function resolveIdentity() {
      if (!isAuthenticated) return

      try {
        const res = await fetch('/api/legacy/identity', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!mounted) return

        const recommendedUserId = data?.identity?.recommendedUserId
        const source = data?.identity?.source

        if (typeof recommendedUserId === 'string' && recommendedUserId.trim()) {
          setResolvedLegacyUserId(recommendedUserId.trim())
        }
        if (typeof source === 'string' && source.trim()) {
          setLegacyIdentitySource(source.trim())
        }
      } catch {
        // keep session fallback key
      }
    }

    void resolveIdentity()

    return () => {
      mounted = false
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (activeTab === "Waivers" && !waiverRefresh && !waiverLoading) {
      void refreshWaiverPanel()
    }
  }, [activeTab, waiverRefresh, waiverLoading, refreshWaiverPanel])

  useEffect(() => {
    if (trackedDiscoveryViewRef.current) return
    if (!leagueId || leagueId === "unknown" || loadingLeagueData) return
    trackedDiscoveryViewRef.current = true
    trackDiscoveryLeagueView({
      leagueId,
      source: "fantasy",
      leagueName: leagueSummary?.name ?? null,
      sport: leagueSummary?.sport ?? null,
    })
  }, [leagueId, leagueSummary?.name, leagueSummary?.sport, loadingLeagueData])

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 space-y-4 mode-readable">
        <section className="mode-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{leagueSummary?.name || "League Home"}</h1>
              <p className="mode-muted text-sm">League ID: {leagueId}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Link href="/leagues" className="rounded-lg border border-white/15 px-3 py-2 text-center text-sm hover:bg-white/10">
                Back to Leagues
              </Link>
              <button
                onClick={() => void loadLeagueData()}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
              >
                Refresh League Data
              </button>
              <Link href="/legacy" className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-center text-sm text-cyan-200 hover:bg-cyan-500/20">
                Open Legacy AI
              </Link>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/70">
            <span className="rounded-full border border-cyan-400/25 px-2 py-1 text-cyan-200">Legacy Identity: {legacyIdentitySource}</span>
            <span className="rounded-full border border-white/15 px-2 py-1">Members: {leagueSummary?._count?.members ?? "-"}</span>
            <span className="rounded-full border border-white/15 px-2 py-1">Entries: {leagueSummary?._count?.entries ?? entries?.length ?? 0}</span>
            {leagueSummary?.joinCode && <span className="rounded-full border border-white/15 px-2 py-1">Join Code: {leagueSummary.joinCode}</span>}
          </div>
        </section>

        <section className="mode-panel sticky top-[64px] z-30 rounded-2xl p-2 sm:top-[72px] sm:p-3 backdrop-blur-xl">
          <div className="flex gap-1.5 overflow-x-auto sm:gap-2 [scrollbar-width:none] snap-x snap-mandatory">
            {LEAGUE_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`shrink-0 snap-start whitespace-nowrap rounded-lg px-3 py-2 text-xs transition sm:px-4 sm:text-sm ${
                  activeTab === tab ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </section>

        {dataError && (
          <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{dataError}</section>
        )}

        {loadingLeagueData ? (
          <Card title="Loading">
            <InlineNote text="Loading league context..." />
          </Card>
        ) : (
          <>
            {activeTab === "Overview" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {/* League Snapshot */}
                <Card title="League Snapshot" accent>
                  <InlineNote text="Combined league data — sections below populate as real data is wired." />
                  <div className="mt-3 space-y-1 text-sm text-white/80">
                    <div>League: {leagueSummary?.name || "Unknown"}</div>
                    <div>Members: {leagueSummary?._count?.members ?? 0}</div>
                    <div>Total Entries: {entries?.length ?? 0}</div>
                  </div>
                </Card>

                {/* Next Matchup (Placeholder) */}
                <Card title="Next Matchup">
                  <InlineNote text="Your next scheduled matchup." />
                  <div className="mt-3 text-sm text-white/80">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">vs. [Opponent]</span>
                      <span className="rounded bg-cyan-800/40 px-2 py-1 text-xs text-cyan-200">Projected: --</span>
                    </div>
                    <div className="text-xs text-white/60 mt-1">Date: --</div>
                  </div>
                </Card>

                {/* Quick Stats */}
                <Card title="Quick Stats">
                  <div className="space-y-1 text-sm text-white/80">
                    <div>Record: <span className="font-semibold">--</span></div>
                    <div>Streak: <span className="font-semibold">--</span></div>
                    <div>Rank: <span className="font-semibold">{standings?.find(s => s.entryName === userLabel)?.rank ?? '--'}</span></div>
                  </div>
                </Card>

                {/* Top Standings */}
                <Card title="Top Standings">
                  {standings && standings.length > 0 ? (
                    <ul className="space-y-2 text-sm">
                      {standings.slice(0, 5).map((s) => (
                        <li key={s.entryId} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                          <span>#{s.rank} {s.entryName}</span>
                          <span className="text-white/70">{s.points} pts</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <InlineNote text="No standings available yet." />
                  )}
                </Card>

                {/* Recent Activity (Placeholder) */}
                <Card title="Recent Activity">
                  <InlineNote text="Latest trades, waivers, and chat highlights." />
                  <ul className="mt-2 space-y-1 text-xs text-white/70">
                    {chatMessages && chatMessages.length > 0 ? (
                      chatMessages.slice(-5).reverse().map((msg) => (
                        <li key={msg.id}>
                          <span className="font-semibold">{msg.user?.displayName || 'User'}:</span> {msg.message}
                        </li>
                      ))
                    ) : (
                      <li>No recent activity.</li>
                    )}
                  </ul>
                </Card>

                {/* League News/Announcements (Placeholder) */}
                <Card title="League News">
                  <InlineNote text="Announcements and league news." />
                  <div className="mt-2 text-xs text-white/70">No announcements yet.</div>
                </Card>
              </div>
            )}

            {(activeTab === "Team" || activeTab === "Roster") && (
              <Card title={activeTab === "Team" ? "Team Context" : "Roster"}>
                {rosterData?.roster ? (
                  <div className="mode-panel-soft rounded-xl p-3">
                    {/* Render player list with clickable names */}
                    {Array.isArray((rosterData.roster as { players?: any[] })?.players) ? (
                      <ul className="divide-y divide-white/10">
                        {(rosterData.roster as { players: any[] }).players.map((player: any) => (
                          <li key={player.playerId || player.id} className="flex items-center gap-3 py-2">
                            <button
                              className="text-cyan-300 hover:underline text-left font-semibold"
                              onClick={() => {
                                setSelectedPlayer(player)
                                setPlayerModalOpen(true)
                              }}
                            >
                              {player.playerName || player.name}
                            </button>
                            <span className="ml-2 text-xs text-white/60">{player.position} {player.team ? `- ${player.team}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <SmartDataView data={rosterData.roster} />
                    )}
                  </div>
                ) : (
                  <InlineNote text="No imported roster found for this league/user yet." />
                )}
                {typeof rosterData?.faabRemaining === "number" && (
                  <p className="mt-2 text-xs text-white/60">FAAB Remaining: {rosterData.faabRemaining}</p>
                )}

                {/* Player modal dialog */}
                <Dialog open={playerModalOpen} onOpenChange={setPlayerModalOpen}>
                  <DialogContent className="max-w-2xl bg-slate-950 border-cyan-400/20">
                    {selectedPlayer && (
                      <PlayerDetailModal
                        isOpen={playerModalOpen}
                        onClose={() => setPlayerModalOpen(false)}
                        playerName={selectedPlayer.playerName || selectedPlayer.name}
                        playerId={selectedPlayer.playerId || selectedPlayer.id}
                        position={selectedPlayer.position}
                        team={selectedPlayer.team}
                        sport={selectedPlayer.sport || 'NFL'}
                      />
                    )}
                  </DialogContent>
                </Dialog>
              </Card>
            )}

            {activeTab === "Matchups" && (
              <Card title="Matchups">
                <InlineNote text="Entry progress and pressure board." />
                {standings && standings.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {standings.slice(0, 6).map((s) => (
                      <div key={s.entryId} className="rounded-lg border border-white/10 px-3 py-2">
                        <div className="text-sm font-medium">#{s.rank} {s.entryName}</div>
                        <div className="text-xs text-white/60">{s.ownerName}</div>
                        <div className="mt-1 text-xs text-white/70">{s.points} pts - {s.picksCount} picks</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-white/70">Current tracked entries: {entries?.length ?? 0}</p>
                )}
              </Card>
            )}
            {activeTab === "Players" && (
              <Card title="Players">
                <InlineNote text="Players tab will use imported roster/player pools. Showing roster source until league-wide player index is wired." />
                <div className="mt-3 mode-panel-soft rounded-xl p-3">
                  <SmartDataView data={rosterData?.roster ?? { message: "No roster data" }} />
                </div>
              </Card>
            )}

            {activeTab === "Waivers" && (
              <Card title="Waiver AI Panel (Legacy Market Refresh)">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void refreshWaiverPanel()}
                    className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/20"
                    disabled={!isAuthenticated || waiverLoading}
                  >
                    {waiverLoading ? "Refreshing..." : "Refresh Waiver Signals"}
                  </button>
                </div>

                {waiverRefresh?.status === "ok" && waiverRefresh.data ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-white/70">{waiverRefresh.data.coachingSummary.summary}</p>
                    <ul className="space-y-2 text-sm">
                      {(waiverRefresh.data.marketOpportunities?.waiverStashes || []).slice(0, 5).map((p) => (
                        <li key={p.playerId} className="rounded-lg border border-white/10 px-3 py-2">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-white/60">{p.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <InlineNote text="No waiver AI data yet. Refresh to pull live market/waiver signals." />
                )}
              </Card>
            )}

            {activeTab === "Trades" && (
              <Card title="Trade AI Panel (Legacy Trade Command Center)">
                {tradeTab.loading ? (
                  <InlineNote text="Loading trade command center..." />
                ) : tradeTab.insufficientData ? (
                  <InlineNote text={`Insufficient data: ${tradeTab.missingFields.join(", ") || "missing context"}`} />
                ) : tradeTab.error ? (
                  <InlineNote text={`Trade panel error: ${tradeTab.error}`} />
                ) : tradeTab.data ? (
                  <div className="space-y-3">
                    <p className="text-sm text-white/70">{tradeTab.data.coachingSummary.summary}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <h3 className="text-sm font-semibold">Win-now Targets</h3>
                        <ul className="mt-2 space-y-2 text-sm">
                          {tradeTab.data.recommendedTargets.winNowTargets.slice(0, 3).map((t) => (
                            <li key={t.playerId} className="rounded-lg border border-white/10 px-3 py-2">
                              <div>{t.name}</div>
                              <div className="text-xs text-white/60">{t.reason}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Renegotiation Board</h3>
                        <ul className="mt-2 space-y-2 text-sm">
                          {tradeTab.data.renegotiationBoard.slice(0, 3).map((r) => (
                            <li key={r.tradeId} className="rounded-lg border border-white/10 px-3 py-2">
                              <div>{r.action.toUpperCase()} {r.tradeId}</div>
                              <div className="text-xs text-white/60">{r.reason}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <InlineNote text="Trade command center unavailable." />
                )}
              </Card>
            )}

            {activeTab === "Draft" && (
              <Card title="Draft AI Panel (AF Legacy Draft)">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-white/70">Round</label>
                  <input
                    type="number"
                    min={1}
                    value={draftRound}
                    onChange={(e) => setDraftRound(Math.max(1, Number(e.target.value || 1)))}
                    className="w-20 rounded border border-white/20 bg-black/40 px-2 py-1 text-sm"
                  />
                  <label className="text-xs text-white/70">Pick</label>
                  <input
                    type="number"
                    min={1}
                    value={draftPick}
                    onChange={(e) => setDraftPick(Math.max(1, Number(e.target.value || 1)))}
                    className="w-24 rounded border border-white/20 bg-black/40 px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => void draftTab.refresh()}
                    className="rounded border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Refresh Draft View
                  </button>
                </div>

                {draftTab.loading ? (
                  <InlineNote text="Loading draft war room..." />
                ) : draftTab.insufficientData ? (
                  <InlineNote text={`Insufficient data: ${draftTab.missingFields.join(", ") || "missing context"}`} />
                ) : draftTab.error ? (
                  <InlineNote text={`Draft panel error: ${draftTab.error}`} />
                ) : draftTab.data ? (
                  <div className="space-y-3">
                    <p className="text-sm text-white/70">{draftTab.data.coachingSummary.summary}</p>
                    <div className="rounded-lg border border-white/10 p-3 text-sm">
                      <div className="font-semibold">Best Pick Now: {draftTab.data.bestPickNow.name}</div>
                      <div className="text-white/70">{draftTab.data.bestPickNow.reason}</div>
                    </div>
                    <ul className="space-y-2 text-sm">
                      {draftTab.data.playersLikelyTakenBeforeYou.slice(0, 4).map((p) => (
                        <li key={`${p.pickBeforeYou}-${p.teamId}`} className="rounded-lg border border-white/10 px-3 py-2">
                          <div>Pick {p.pickBeforeYou}: {p.predictedPick.name} ({Math.round(p.probability * 100)}%)</div>
                          <div className="text-xs text-white/60">{p.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <InlineNote text="Draft war room unavailable." />
                )}
              </Card>
            )}

            {activeTab === "Standings/Playoffs" && (
              <div className="space-y-6">
                <Card title="Standings">
                  {standings && standings.length > 0 ? (
                    <div>
                      <div className="space-y-2 sm:hidden">
                        {standings.map((s) => (
                          <div key={s.entryId} className="rounded-lg border border-white/10 px-3 py-2">
                            <div className="text-sm font-medium">#{s.rank} {s.entryName}</div>
                            <div className="text-xs text-white/60">{s.ownerName}</div>
                            <div className="mt-1 text-xs text-white/70">{s.points} pts - {s.picksCount} picks</div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full min-w-[640px] text-sm">
                          <thead className="text-white/60">
                            <tr>
                              <th className="px-2 py-2 text-left">Rank</th>
                              <th className="px-2 py-2 text-left">Entry</th>
                              <th className="px-2 py-2 text-left">Owner</th>
                              <th className="px-2 py-2 text-left">Points</th>
                              <th className="px-2 py-2 text-left">Picks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.map((s) => (
                              <tr key={s.entryId} className="border-t border-white/10">
                                <td className="px-2 py-2">{s.rank}</td>
                                <td className="px-2 py-2">{s.entryName}</td>
                                <td className="px-2 py-2">{s.ownerName}</td>
                                <td className="px-2 py-2">{s.points}</td>
                                <td className="px-2 py-2">{s.picksCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <InlineNote text="No standings yet." />
                  )}
                </Card>
                <Card title="Season & playoff forecast">
                  <LeagueForecastSection
                    leagueId={leagueId}
                    teamNames={Object.fromEntries(
                      (standings ?? []).map((s) => [s.entryId, s.entryName])
                    )}
                    teamRanks={Object.fromEntries(
                      (standings ?? []).map((s) => [s.entryId, s.rank])
                    )}
                  />
                </Card>
                <Card title="Dynasty projection engine">
                  <DynastyProjectionPanel
                    leagueId={leagueId}
                    teamNames={Object.fromEntries(
                      (standings ?? []).map((s) => [s.entryId, s.entryName])
                    )}
                    onBackToOverview={() => setActiveTab("Overview")}
                  />
                </Card>
              </div>
            )}

            {activeTab === "Intelligence" && (
              <Card title="League Intelligence Graph">
                <div className="mb-4">
                  <UnifiedRelationshipInsightsPanel leagueId={leagueId} />
                </div>
                <LeagueIntelligenceGraphPanel leagueId={leagueId} isDynasty={true} />
              </Card>
            )}

            {activeTab === "League" && (
              <Card title="League Info">
                {leagueSummary ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 px-3 py-2">
                      <div className="text-xs text-white/60">League Name</div>
                      <div className="text-sm font-medium">{leagueSummary.name}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 px-3 py-2">
                      <div className="text-xs text-white/60">League ID</div>
                      <div className="text-sm font-mono">{leagueSummary.id}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 px-3 py-2">
                      <div className="text-xs text-white/60">Members</div>
                      <div className="text-sm font-medium">{leagueSummary._count?.members ?? "-"}</div>
                    </div>
                    <div className="rounded-lg border border-white/10 px-3 py-2">
                      <div className="text-xs text-white/60">Entries</div>
                      <div className="text-sm font-medium">{leagueSummary._count?.entries ?? entries?.length ?? 0}</div>
                    </div>
                    {leagueSummary.joinCode && (
                      <div className="rounded-lg border border-white/10 px-3 py-2 sm:col-span-2">
                        <div className="text-xs text-white/60">Join Code</div>
                        <div className="text-sm font-mono">{leagueSummary.joinCode}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <InlineNote text="No league summary available." />
                )}
              </Card>
            )}

            {activeTab === "Chat" && (
              <Card title="League Chat">
                {chatMessages && chatMessages.length > 0 ? (
                  <ul className="space-y-2">
                    {chatMessages.map((m) => (
                      <li key={m.id} className="rounded-lg border border-white/10 p-3 text-sm">
                        <div className="text-xs text-white/50">{m.user?.displayName || m.user?.email || "Manager"}</div>
                        <div className="text-white/90">{m.message}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <InlineNote text="No chat messages available." />
                )}
              </Card>
            )}

            {activeTab === "Settings" && (
              <Card title="Settings">
                <InlineNote text="Commissioner setting controls are routed through bracket settings endpoints; UI editor wiring is the next patch." />
                <Link href={`/brackets/leagues/${leagueId}`} className="mt-3 inline-flex rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10">
                  Open Bracket League Settings
                </Link>
              </Card>
            )}

            {activeTab === "Previous Leagues" && (
              <Card title="Previous Leagues">
                <WarehouseHistoryPanel
                  leagueId={leagueId}
                  onBackToOverview={() => setActiveTab("Overview")}
                />
              </Card>
            )}
          </>
        )}
    </main>
  )
}
