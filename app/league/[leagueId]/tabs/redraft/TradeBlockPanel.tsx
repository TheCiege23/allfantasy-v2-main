'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  fetchLeagueTradeBlock,
  fetchMyInterests,
  fetchRedraftRoster,
  addTradeBlockItem,
  removeTradeBlockItem,
  addTradeInterest,
  removeTradeInterest,
  type TradeBlockItem,
  type TradeInterestItem,
  type RedraftRosterPlayerClient,
} from '@/lib/redraft/client'

/**
 * T8 native Trade Block UI: My Trade Block (publish/unpublish owned players), League Trade Block
 * (league-visible cards with Mark interest / Build proposal), My Interests. No auto-submit; "Build
 * proposal" only opens the existing modal preselected.
 */
export function TradeBlockPanel({
  leagueId,
  myRosterId,
  currentWeek,
  onBuildProposal,
}: {
  leagueId: string
  myRosterId: string
  currentWeek: number
  onBuildProposal: (partnerRosterId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [leagueBlock, setLeagueBlock] = useState<TradeBlockItem[]>([])
  const [myInterests, setMyInterests] = useState<TradeInterestItem[]>([])
  const [myPlayers, setMyPlayers] = useState<RedraftRosterPlayerClient[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [block, interests, roster] = await Promise.all([
        fetchLeagueTradeBlock(leagueId),
        fetchMyInterests(leagueId),
        fetchRedraftRoster(myRosterId, currentWeek).catch(() => null),
      ])
      setLeagueBlock(block.items)
      setMyInterests(interests.interests)
      setMyPlayers(roster?.players ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trade block')
    } finally {
      setLoading(false)
    }
  }, [leagueId, myRosterId, currentWeek])

  useEffect(() => {
    if (open && !loading && leagueBlock.length === 0 && myInterests.length === 0 && myPlayers.length === 0) void load()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const myBlockPlayerIds = new Set(leagueBlock.filter((i) => i.rosterId === myRosterId).map((i) => i.playerId))

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-violet-300/15 bg-violet-400/[0.05]" data-testid="trade-block-panel">
      <button
        type="button"
        data-testid="trade-block-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-violet-100"
      >
        <span>Trade Block &amp; Interests</span>
        <span className="text-violet-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-violet-300/15 px-3 py-2 text-[11px]">
          {loading ? <p className="text-white/50">Loading…</p> : null}
          {error ? <p className="text-rose-300">{error}</p> : null}

          <section>
            <p className="text-[11px] font-semibold text-white">My Trade Block</p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {myPlayers.map((p) => {
                const on = myBlockPlayerIds.has(p.playerId)
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                    <span className="truncate text-white/80">
                      {p.playerName} <span className="text-white/40">{p.position}</span>
                    </span>
                    <button
                      type="button"
                      data-testid={`block-toggle-${p.playerId}`}
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          on
                            ? removeTradeBlockItem(leagueBlock.find((i) => i.rosterId === myRosterId && i.playerId === p.playerId)!.id)
                            : addTradeBlockItem({ leagueId, playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.team }),
                        )
                      }
                      className={`rounded px-1.5 py-0.5 text-[10px] ${on ? 'border border-rose-400/40 text-rose-200' : 'bg-violet-500/80 text-black'}`}
                    >
                      {on ? 'Remove' : 'Add to block'}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <p className="text-[11px] font-semibold text-white">League Trade Block</p>
            {leagueBlock.filter((i) => i.rosterId !== myRosterId).length === 0 ? (
              <p className="mt-0.5 text-white/45">No players listed by other managers yet.</p>
            ) : (
              <div className="mt-1 space-y-1">
                {leagueBlock.filter((i) => i.rosterId !== myRosterId).map((i) => (
                  <div key={i.id} className="rounded border border-white/10 bg-black/20 p-2" data-testid="league-block-card">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {i.playerName} <span className="text-white/40">{i.position}</span>
                      </span>
                      <div className="flex gap-1">
                        <button type="button" disabled={busy} data-testid={`mark-interest-${i.playerId}`}
                          onClick={() => act(() => addTradeInterest({ leagueId, interestType: 'player_interest', targetRosterId: i.rosterId, playerId: i.playerId, playerName: i.playerName, position: i.position }))}
                          className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/80">Mark interest</button>
                        <button type="button" data-testid={`block-build-${i.rosterId}`}
                          onClick={() => onBuildProposal(i.rosterId)}
                          className="rounded bg-[#ff3d81]/85 px-1.5 py-0.5 text-[10px] font-semibold text-black">Build proposal</button>
                      </div>
                    </div>
                    {i.note ? <p className="mt-0.5 text-[10px] text-white/55">“{i.note}”</p> : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="text-[11px] font-semibold text-white">My Interests</p>
            {myInterests.length === 0 ? (
              <p className="mt-0.5 text-white/45">You haven’t marked any interests yet.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {myInterests.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 text-[10px] text-white/70">
                    <span>{it.playerName ?? it.position ?? it.interestType} <span className="text-white/40">({it.visibility})</span></span>
                    <button type="button" disabled={busy} onClick={() => act(() => removeTradeInterest(it.id))} className="text-rose-300/80">remove</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
