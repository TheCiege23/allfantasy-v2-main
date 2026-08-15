'use client'

import { useMemo, useState } from 'react'
import WaiverFilters from '@/components/waiver-wire/WaiverFilters'
import WaiverPlayerRow from '@/components/waiver-wire/WaiverPlayerRow'
import WaiverClaimDrawer from '@/components/waiver-wire/WaiverClaimDrawer'
import { waiverPositionMatches } from '@/lib/waiver-wire/SportWaiverResolver'
import { getTabLabel, WAIVER_EMPTY_HISTORY_TITLE, WAIVER_EMPTY_PENDING_TITLE, WAIVER_EMPTY_PLAYERS_HINT, WAIVER_EMPTY_PLAYERS_TITLE } from '@/lib/waiver-wire/WaiverWireViewService'
import { buildWaiverSummaryForAI, getWaiverAIChatUrl } from '@/lib/waiver-wire/WaiverToAIContextBridge'

type Player = { id: string; name: string; position: string | null; team: string | null }
type Claim = { id: string; addPlayerId: string; dropPlayerId: string | null; faabBid: number | null; priorityOrder: number; status: string }
type Tx = { id: string; addPlayerId: string; dropPlayerId: string | null; faabSpent: number | null; processedAt: string }
type EngineSuggestion = { playerId: string; playerName: string; position: string; compositeScore: number; recommendation: string; faabBid: number | null }

const MOCK_PLAYERS: Player[] = [
  { id: 'player-1', name: 'Alpha Runner', position: 'RB', team: 'KC' },
  { id: 'player-2', name: 'Bravo Receiver', position: 'WR', team: 'BUF' },
  { id: 'player-3', name: 'Charlie Defender', position: 'LB', team: 'NE' },
]

const MOCK_TX: Tx[] = [
  { id: 'tx-1', addPlayerId: 'player-1', dropPlayerId: 'roster-1', faabSpent: 7, processedAt: new Date('2026-01-02T12:00:00.000Z').toISOString() },
  { id: 'tx-2', addPlayerId: 'player-3', dropPlayerId: null, faabSpent: 0, processedAt: new Date('2026-01-03T12:00:00.000Z').toISOString() },
]

export function WaiverWireHarnessClient() {
  const [wireOpen, setWireOpen] = useState(true)
  const [players] = useState<Player[]>(MOCK_PLAYERS)
  const [claims, setClaims] = useState<Claim[]>([
    {
      id: 'claim-1',
      addPlayerId: 'player-2',
      dropPlayerId: 'roster-1',
      faabBid: 9,
      priorityOrder: 2,
      status: 'pending',
    },
  ])
  const [transactions] = useState<Tx[]>(MOCK_TX)
  const [activeTab, setActiveTab] = useState<'available' | 'trending' | 'claimed' | 'dropped' | 'pending' | 'history'>('available')
  const [search, setSearch] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('')
  const [sort, setSort] = useState('name')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerPlayer, setDrawerPlayer] = useState<Player | null>(null)
  const [pendingEdits, setPendingEdits] = useState<Record<string, { faabBid: string; priority: string }>>({})
  const [watchlistPlayerIds, setWatchlistPlayerIds] = useState<string[]>([])
  const [waiverAiIncludeExplanation, setWaiverAiIncludeExplanation] = useState(false)
  const [waiverAiResult, setWaiverAiResult] = useState<{ explanation: string; source: 'deterministic' | 'ai'; suggestions: EngineSuggestion[] } | null>(null)

  const rosterPlayers = [{ id: 'roster-1', name: 'Existing Player' }]
  const rosterPlayerIds = ['roster-1']
  const teams = useMemo(
    () => Array.from(new Set(players.map((p) => (p.team || '').trim()).filter(Boolean))).sort(),
    [players]
  )

  const trendScoreByPlayerId = useMemo(() => {
    const score = new Map<string, number>()
    for (const tx of transactions) score.set(tx.addPlayerId, (score.get(tx.addPlayerId) ?? 0) + 2)
    for (const c of claims) score.set(c.addPlayerId, (score.get(c.addPlayerId) ?? 0) + 1)
    return score
  }, [transactions, claims])

  const filteredPlayers = useMemo(() => {
    let list = [...players]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q))
    }
    if (positionFilter !== 'ALL') list = list.filter((p) => waiverPositionMatches(p.position, positionFilter))
    if (statusFilter === 'available') {
      const claimedIds = new Set(claims.map((c) => c.addPlayerId))
      list = list.filter((p) => !claimedIds.has(p.id))
    }
    if (statusFilter === 'watchlist') {
      const watchlist = new Set(watchlistPlayerIds)
      list = list.filter((p) => watchlist.has(p.id))
    }
    if (teamFilter) list = list.filter((p) => (p.team || '').toLowerCase() === teamFilter.toLowerCase())
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'position') list.sort((a, b) => (a.position || '').localeCompare(b.position || ''))
    if (sort === 'team') list.sort((a, b) => (a.team || '').localeCompare(b.team || ''))
    if (sort === 'trend') {
      list.sort((a, b) => (trendScoreByPlayerId.get(b.id) ?? 0) - (trendScoreByPlayerId.get(a.id) ?? 0))
    }
    return list
  }, [players, search, positionFilter, statusFilter, teamFilter, sort, claims, trendScoreByPlayerId, watchlistPlayerIds])

  const trendingPlayers = useMemo(
    () => [...filteredPlayers].sort((a, b) => (trendScoreByPlayerId.get(b.id) ?? 0) - (trendScoreByPlayerId.get(a.id) ?? 0)),
    [filteredPlayers, trendScoreByPlayerId]
  )

  const claimedTransactions = useMemo(() => transactions.filter((tx) => Boolean(tx.addPlayerId)), [transactions])
  const droppedTransactions = useMemo(() => transactions.filter((tx) => Boolean(tx.dropPlayerId)), [transactions])

  const analyzeWaiverEngine = () => {
    const ranked = [...players]
      .sort((a, b) => (trendScoreByPlayerId.get(b.id) ?? 0) - (trendScoreByPlayerId.get(a.id) ?? 0))
      .slice(0, 5)
      .map((player, index) => ({
        playerId: player.id,
        playerName: player.name,
        position: String(player.position ?? 'UTIL'),
        compositeScore: Math.max(30, 85 - index * 8),
        recommendation: index === 0 ? 'Must Add' : index <= 2 ? 'Strong Add' : 'Add',
        faabBid: Math.max(3, 20 - index * 3),
      }))
    setWaiverAiResult({
      source: waiverAiIncludeExplanation ? 'ai' : 'deterministic',
      explanation: waiverAiIncludeExplanation
        ? 'AI explanation enabled: prioritize early claims where trend score and roster need intersect.'
        : 'Deterministic ranking: players are prioritized by trend score and waiver context.',
      suggestions: ranked,
    })
  }

  if (!wireOpen) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
        <h1 className="mb-4 text-xl font-semibold">Waiver Wire Harness</h1>
        <button
          type="button"
          data-testid="waiver-open-button"
          onClick={() => setWireOpen(true)}
          className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
        >
          Open Waiver Wire
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Waiver Wire</h1>
        <button
          type="button"
          data-testid="waiver-back-button"
          onClick={() => setWireOpen(false)}
          className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs text-white/80"
        >
          Back
        </button>
      </div>

      <WaiverFilters
        search={search}
        onSearchChange={setSearch}
        position={positionFilter}
        onPositionChange={setPositionFilter}
        team={teamFilter}
        onTeamChange={setTeamFilter}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        sort={sort}
        onSortChange={setSort}
        onResetFilters={() => {
          setSearch('')
          setPositionFilter('ALL')
          setTeamFilter('')
          setStatusFilter('all')
          setSort('name')
        }}
        teams={teams}
        sport="NFL"
        formatType="IDP"
      />

      <div className="mb-3 mt-3 flex flex-wrap gap-2 text-sm">
        {(['available', 'trending', 'claimed', 'dropped', 'pending', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            data-testid={`waiver-tab-${tab}`}
            className={`rounded-full px-3 py-1.5 ${activeTab === tab ? 'bg-cyan-500 text-black' : 'bg-black/40 text-white/80'}`}
          >
            {tab === 'trending'
              ? 'Trending'
              : tab === 'claimed'
                ? 'Claimed'
                : tab === 'dropped'
                  ? 'Dropped'
                  : tab === 'pending'
                    ? getTabLabel('pending', claims.length)
                    : getTabLabel(tab === 'available' ? 'available' : 'history')}
          </button>
        ))}
      </div>

      {(activeTab === 'available' || activeTab === 'trending') && (
        <>
          {((activeTab === 'trending' ? trendingPlayers : filteredPlayers).length === 0) ? (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
              <div className="font-semibold text-white/90">{WAIVER_EMPTY_PLAYERS_TITLE}</div>
              <div>{WAIVER_EMPTY_PLAYERS_HINT}</div>
            </div>
          ) : (
            <ul className="space-y-2">
              {(activeTab === 'trending' ? trendingPlayers : filteredPlayers).map((p) => {
                const alreadyClaimed = claims.some((c) => c.addPlayerId === p.id)
                return (
                  <WaiverPlayerRow
                    key={p.id}
                    player={p}
                    alreadyClaimed={alreadyClaimed}
                    trendScore={trendScoreByPlayerId.get(p.id) ?? 0}
                    watchlisted={watchlistPlayerIds.includes(p.id)}
                    onToggleWatchlist={() =>
                      setWatchlistPlayerIds((prev) =>
                        prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                      )
                    }
                    onRowClick={() => {
                      if (alreadyClaimed) return
                      setDrawerPlayer(p)
                      setDrawerOpen(true)
                    }}
                    onAddClick={() => {
                      if (alreadyClaimed) return
                      setDrawerPlayer(p)
                      setDrawerOpen(true)
                    }}
                  />
                )
              })}
            </ul>
          )}
        </>
      )}

      {activeTab === 'pending' && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
          {claims.length === 0 ? (
            <div className="text-white/60">{WAIVER_EMPTY_PENDING_TITLE}</div>
          ) : (
            <div className="space-y-3">
              {claims.map((c) => {
                const edit = pendingEdits[c.id] ?? {
                  faabBid: c.faabBid != null ? String(c.faabBid) : '',
                  priority: String(c.priorityOrder),
                }
                return (
                  <div key={c.id} className="rounded-lg border border-white/10 p-3">
                    <div className="text-xs text-white/60">Add {c.addPlayerId} · Drop {c.dropPlayerId ?? 'none'}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        value={edit.priority}
                        onChange={(e) => setPendingEdits((prev) => ({ ...prev, [c.id]: { ...edit, priority: e.target.value } }))}
                        className="w-20 rounded border border-white/20 bg-black/50 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        data-testid={`waiver-claim-save-${c.id}`}
                        onClick={() =>
                          setClaims((prev) =>
                            prev.map((row) =>
                              row.id === c.id
                                ? {
                                    ...row,
                                    priorityOrder: Number(edit.priority) || row.priorityOrder,
                                    faabBid: edit.faabBid === '' ? null : Number(edit.faabBid) || 0,
                                  }
                                : row
                            )
                          )
                        }
                        className="rounded border border-cyan-400/60 px-2 py-1 text-xs text-cyan-200"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        data-testid={`waiver-claim-cancel-${c.id}`}
                        onClick={() => setClaims((prev) => prev.filter((row) => row.id !== c.id))}
                        className="rounded border border-red-400/40 px-2 py-1 text-xs text-red-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
          {transactions.length === 0 ? (
            <div className="text-white/60">{WAIVER_EMPTY_HISTORY_TITLE}</div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="rounded-lg border border-white/10 p-3 text-xs">
                  Add {tx.addPlayerId} · Drop {tx.dropPlayerId ?? 'none'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'claimed' && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
          {claimedTransactions.map((tx) => (
            <div key={tx.id} className="rounded-lg border border-white/10 p-3 text-xs">
              Add {tx.addPlayerId}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'dropped' && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/80">
          {droppedTransactions.map((tx) => (
            <div key={tx.id} className="rounded-lg border border-white/10 p-3 text-xs">
              Drop {tx.dropPlayerId}
            </div>
          ))}
        </div>
      )}

      <section className="mt-4 rounded-xl border border-cyan-500/20 bg-black/30 p-4" data-testid="waiver-ai-engine-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-cyan-200">Waiver AI Engine</h2>
          <label className="inline-flex items-center gap-2 text-xs text-white/75">
            <input
              type="checkbox"
              checked={waiverAiIncludeExplanation}
              onChange={(event) => setWaiverAiIncludeExplanation(event.target.checked)}
              data-testid="waiver-ai-engine-explanation-toggle"
            />
            AI explanation
          </label>
        </div>
        <button
          type="button"
          data-testid="waiver-ai-engine-analyze"
          onClick={analyzeWaiverEngine}
          className="mt-2 rounded border border-cyan-400/60 px-3 py-1.5 text-xs text-cyan-200"
        >
          Analyze waivers
        </button>
        {waiverAiResult && (
          <div className="mt-3 space-y-2" data-testid="waiver-ai-engine-results">
            <p className="text-xs text-white/80">
              Source: <span className="text-cyan-200">{waiverAiResult.source}</span> · {waiverAiResult.explanation}
            </p>
            {waiverAiResult.suggestions.map((s, index) => (
              <div key={s.playerId} className="rounded border border-white/10 px-2 py-1 text-xs" data-testid={`waiver-ai-engine-suggestion-${index + 1}`}>
                #{index + 1} {s.playerName} ({s.position}) · {s.recommendation} · Score {s.compositeScore}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 border-t border-white/10 pt-3">
        <a
          data-testid="waiver-ai-help-link"
          href={getWaiverAIChatUrl(buildWaiverSummaryForAI(undefined, "NFL", {
            waiverType: "FAAB",
            pendingClaims: claims.length,
            watchlistCount: watchlistPlayerIds.length,
            topTargets: players.filter((p) => watchlistPlayerIds.includes(p.id)).map((p) => p.name),
          }), {
            leagueId: "e2e-league",
            insightType: "waiver",
            sport: "NFL",
          })}
          className="text-xs text-cyan-300 underline"
        >
          Get AI waiver help
        </a>
      </div>

      <WaiverClaimDrawer
        open={drawerOpen}
        player={drawerPlayer}
        faabMode
        faabRemaining={74}
        hasOpenRosterSpot={false}
        rosterPlayers={rosterPlayers}
        rosterPlayerIds={rosterPlayerIds}
        onClose={() => {
          setDrawerOpen(false)
          setDrawerPlayer(null)
        }}
        onSubmit={(opts) => {
          if (!drawerPlayer) return
          setClaims((prev) => [
            ...prev,
            {
              id: `claim-${prev.length + 1}`,
              addPlayerId: drawerPlayer.id,
              dropPlayerId: opts.dropPlayerId,
              faabBid: opts.faabBid,
              priorityOrder: opts.priorityOrder ?? (prev.length + 1),
              status: 'pending',
            },
          ])
          setDrawerOpen(false)
          setDrawerPlayer(null)
        }}
      />
    </main>
  )
}
