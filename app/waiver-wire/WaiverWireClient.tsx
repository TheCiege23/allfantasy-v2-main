"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"

interface Player {
  id: string
  name: string
  position: string
  team: string
  projectedPoints: number
  rostered: number
  imageUrl?: string
  injuryStatus?: string
  byeWeek?: number
  isRookie?: boolean
  adpValue?: number
}

interface WaiverClaim {
  id: string
  playerId: string
  playerName: string
  bidAmount: number
  status: string
}

interface WaiverWireClientProps {
  leagueId: string
  /** Slice 7 (Player Command Center deep-link): auto-open the claim panel for this player once the pool loads. */
  preselectPlayerId?: string | null
}

type TabType = "available" | "myClaims" | "recommendations" | "watchlist"

export function WaiverWireClient({ leagueId, preselectPlayerId = null }: WaiverWireClientProps) {
  const router = useRouter()
  const [players, setPlayers] = useState<Player[]>([])
  const [claims, setClaims] = useState<WaiverClaim[]>([])
  // Honesty pass: FAAB starts UNKNOWN, not at an invented $100. A fabricated
  // budget let a broke manager see a full bar and submit claims the server
  // rejects — and `||` swallowed a real $0 as "no value, use the default".
  const [faabBalance, setFaabBalance] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [bidAmount, setBidAmount] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>("available")
  const [searchQuery, setSearchQuery] = useState("")
  const [positionFilter, setPositionFilter] = useState<string>("ALL")
  const [showRookiesOnly, setShowRookiesOnly] = useState<boolean>(false)

  // Load all data
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true)
        setError(null)

        const [playersRes, claimsRes, stateRes] = await Promise.all([
          fetch(`/api/waiver-wire/leagues/${leagueId}/players`),
          fetch(`/api/waiver-wire/leagues/${leagueId}/claims`),
          fetch(`/api/waiver-wire/leagues/${leagueId}/state`),
        ])

        if (!playersRes.ok) {
          const errorData = await playersRes.text()
          console.error("Players API error:", playersRes.status, errorData)
          throw new Error(`Players API returned ${playersRes.status}`)
        }

        const playersData = await playersRes.json()
        const claimsData = await claimsRes.ok ? await claimsRes.json() : { claims: [] }
        const stateData = await stateRes.ok ? await stateRes.json() : { faabBudget: 100 }

        let availablePlayers = []
        if (playersData.players && Array.isArray(playersData.players)) {
          availablePlayers = playersData.players
        } else if (Array.isArray(playersData)) {
          availablePlayers = playersData
        }

        const safePlayers = availablePlayers.map((p: any) => ({
          id: p.id || `player-${Math.random()}`,
          name: p.name || "Unknown",
          position: p.position || "N/A",
          team: p.team || "FA",
          projectedPoints: p.projectedPoints || 0,
          rostered: p.rostered || 0,
          imageUrl: p.imageUrl || null,
          injuryStatus: p.injuryStatus || null,
          byeWeek: p.byeWeek || null,
          isRookie: p.isRookie || false,
          adpValue: p.adpValue || 999,
        }))

        console.log(`Loaded ${safePlayers.length} players`)
        setPlayers(safePlayers)

        // Slice 7 — Command Center deep-link: auto-open the claim panel for
        // the linked player when they're actually in this league's pool.
        if (preselectPlayerId) {
          const match = safePlayers.find((p: { id: string }) => p.id === preselectPlayerId)
          if (match) {
            setSelectedPlayer(match)
            setActiveTab("available")
          }
        }

        const userClaims = claimsData.claims || []
        setClaims(userClaims)
        // Nullish coalescing (not ||) so a real $0 balance survives.
        const resolvedFaab =
          typeof stateData.faabBudget === 'number'
            ? stateData.faabBudget
            : typeof stateData.balance === 'number'
              ? stateData.balance
              : null
        setFaabBalance(resolvedFaab)
      } catch (error) {
        console.error("Failed to load waiver data:", error)
        setError(error instanceof Error ? error.message : "Failed to load waiver wire")
      } finally {
        setIsLoading(false)
      }
    }

    if (leagueId) {
      loadData()
    }
  }, [leagueId])

  // Filter players based on search, position, and rookie toggle
  const filteredPlayers = useMemo(() => {
    let filtered = players

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((p) =>
        p.name.toLowerCase().includes(query) ||
        p.team.toLowerCase().includes(query)
      )
    }

    if (positionFilter !== "ALL") {
      filtered = filtered.filter((p) => p.position === positionFilter)
    }

    if (showRookiesOnly) {
      filtered = filtered.filter((p) => p.isRookie === true)
    }

    return filtered
  }, [players, searchQuery, positionFilter, showRookiesOnly])

  // Submit a claim
  const handleSubmitClaim = async () => {
    if (!selectedPlayer) return
    const bid = parseInt(bidAmount) || 0
    
    if (isNaN(bid) || bid < 0) {
      setError("Please enter a valid bid amount")
      return
    }
    
    // Client-side budget check only when the real balance is known. When it
    // isn't, we let the server be the authority rather than validating against
    // an invented number.
    if (faabBalance != null && bid > faabBalance) {
      setError(`You only have $${faabBalance} remaining`)
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: selectedPlayer.id,
          bidAmount: bid,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit claim")
      }

      const claimsRes = await fetch(`/api/waiver-wire/leagues/${leagueId}/claims`)
      if (claimsRes.ok) {
        const claimsData = await claimsRes.json()
        setClaims(claimsData.claims || [])
      }
      
      setSelectedPlayer(null)
      setBidAmount("")
      setSuccess(`Claim submitted for ${selectedPlayer.name} with $${bid} bid`)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to submit claim")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="text-white/60">Loading waiver wire...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/5 bg-[#0a0a0a]/95 px-4 py-4 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Waiver Wire</h1>
              <p className="text-sm text-white/50">
                {faabBalance != null ? `FAAB Budget: $${faabBalance}` : 'FAAB Budget: unavailable'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-white/50">
                {claims.filter((c) => c.status === "pending").length} pending
              </span>
              <button
                onClick={() => router.push(`/league/${leagueId}`)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/5"
              >
                Back to League
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/20 p-4 text-red-400">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-lg bg-green-500/20 p-4 text-green-400">
            {success}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-b border-white/5">
          {[
            { id: "available", label: "Available Players" },
            { id: "myClaims", label: "My Claims" },
            { id: "recommendations", label: "AI Recommendations" },
            { id: "watchlist", label: "Watchlist" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 text-sm transition ${
                activeTab === tab.id
                  ? "border-b-2 border-cyan-500 text-white"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {tab.label}
              {tab.id === "myClaims" && claims.length > 0 && (
                <span className="ml-2 rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-400">
                  {claims.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search and Filters */}
        {activeTab === "available" && (
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search players..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">All Positions</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
              <option value="K">K</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60 cursor-pointer hover:bg-white/10 transition">
              <input
                type="checkbox"
                checked={showRookiesOnly}
                onChange={(e) => setShowRookiesOnly(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/50 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
              />
              Rookies Only
            </label>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {/* Available Players */}
            {activeTab === "available" && (
              <div className="rounded-lg border border-white/10 bg-white/5">
                <div className="border-b border-white/5 p-3">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium uppercase tracking-wider text-white/30">
                    <div className="col-span-5">Player</div>
                    <div className="col-span-3">Pos • Team</div>
                    <div className="col-span-2 text-right">Pts</div>
                    <div className="col-span-2 text-right">Action</div>
                  </div>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {filteredPlayers.length === 0 ? (
                    <div className="p-8 text-center text-white/30">
                      {showRookiesOnly ? "No rookies available" : "No available players matching your filters"}
                    </div>
                  ) : (
                    filteredPlayers.map((player) => (
                      <div
                        key={player.id}
                        className={`group flex cursor-pointer items-center border-b border-white/5 p-3 transition hover:bg-white/5 ${
                          selectedPlayer?.id === player.id ? "bg-cyan-500/10" : ""
                        }`}
                        onClick={() => setSelectedPlayer(player)}
                      >
                        <div className="grid w-full grid-cols-12 items-center gap-2">
                          <div className="col-span-5 flex items-center gap-3">
                            {player.imageUrl ? (
                              <img
                                src={player.imageUrl}
                                alt={player.name}
                                className="h-8 w-8 rounded-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = "/images/player-placeholder.svg"
                                }}
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                                {player.name?.charAt(0) || "?"}
                              </div>
                            )}
                            <span className="font-medium">{player.name}</span>
                            {player.isRookie && (
                              <span className="ml-1 rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                                Rookie
                              </span>
                            )}
                          </div>
                          <div className="col-span-3 text-sm text-white/60">
                            {player.position} • {player.team || "FA"}
                          </div>
                          <div className="col-span-2 text-right text-sm text-white/60">
                            {player.projectedPoints?.toFixed(1) || "0"}
                          </div>
                          <div className="col-span-2 flex justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedPlayer(player)
                              }}
                              className="rounded border border-white/10 px-3 py-1 text-xs text-cyan-400 transition hover:bg-white/10"
                            >
                              Bid
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* My Claims */}
            {activeTab === "myClaims" && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                {claims.length === 0 ? (
                  <div className="text-center text-white/30">No claims submitted</div>
                ) : (
                  <div className="space-y-2">
                    {claims.map((claim) => (
                      <div key={claim.id} className="flex items-center justify-between border-b border-white/5 pb-2">
                        <span>{claim.playerName}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-white/50">${claim.bidAmount}</span>
                          <span
                            className={`text-xs ${
                              claim.status === "pending"
                                ? "text-yellow-400"
                                : claim.status === "won"
                                ? "text-green-400"
                                : "text-red-400"
                            }`}
                          >
                            {claim.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* AI Recommendations */}
            {activeTab === "recommendations" && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 text-sm font-medium text-cyan-400">AI-Powered Recommendations</h3>
                <p className="mb-4 text-sm text-white/40">
                  Based on your roster needs, scoring settings, and player availability
                </p>
                <div className="text-center text-white/30">Coming soon</div>
              </div>
            )}

            {/* Watchlist */}
            {activeTab === "watchlist" && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="text-center text-white/30">No players on watchlist</div>
              </div>
            )}
          </div>

          {/* Bid Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-white/50">
                {selectedPlayer ? "Place Bid" : "Select a Player"}
              </h2>
              {selectedPlayer ? (
                <div>
                  <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-3">
                      {selectedPlayer.imageUrl ? (
                        <img
                          src={selectedPlayer.imageUrl}
                          alt={selectedPlayer.name}
                          className="h-12 w-12 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "/images/player-placeholder.svg"
                          }}
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold">
                          {selectedPlayer.name?.charAt(0) || "?"}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{selectedPlayer.name}</div>
                        <div className="text-sm text-white/40">
                          {selectedPlayer.position} • {selectedPlayer.team || "FA"}
                        </div>
                        {selectedPlayer.isRookie && (
                          <div className="text-xs text-yellow-400">Rookie</div>
                        )}
                        {selectedPlayer.injuryStatus && (
                          <div className="text-xs text-red-400">{selectedPlayer.injuryStatus}</div>
                        )}
                      </div>
                    </div>
                    {selectedPlayer.byeWeek && (
                      <div className="mt-2 text-xs text-white/40">Bye Week: {selectedPlayer.byeWeek}</div>
                    )}
                  </div>

                  <div className="mb-4">
                    <label className="mb-1 block text-sm text-white/60">Bid Amount ($)</label>
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      min="0"
                      max={faabBalance ?? undefined}
                      className="w-full rounded-lg border border-white/10 bg-black/50 px-4 py-2 text-white focus:border-cyan-500 focus:outline-none"
                      placeholder="Enter bid..."
                    />
                    <div className="mt-1 flex justify-between text-xs text-white/30">
                      <span>{faabBalance != null ? `Remaining: $${faabBalance}` : 'Remaining: unavailable'}</span>
                      <button
                        onClick={() => setBidAmount("0")}
                        className="text-cyan-400 hover:underline"
                      >
                        $0
                      </button>
                      {faabBalance != null && (
                        <button
                          onClick={() => setBidAmount(faabBalance.toString())}
                          className="text-cyan-400 hover:underline"
                        >
                          ${faabBalance}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSubmitClaim}
                      disabled={isSubmitting}
                      className="flex-1 rounded-lg bg-cyan-500 py-2 font-medium text-black transition hover:bg-cyan-400 disabled:opacity-50"
                    >
                      {isSubmitting ? "Submitting..." : "Submit Claim"}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedPlayer(null)
                        setBidAmount("")
                      }}
                      className="rounded-lg border border-white/10 px-4 py-2 text-white/60 transition hover:bg-white/5"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-white/30">
                  Click a player to place a bid
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}