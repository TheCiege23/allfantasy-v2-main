'use client'

/**
 * DecisionInbox — cross-league pending AF trades with ONE-TAP accept/reject
 * from the dashboard. Actions call the EXISTING per-trade endpoints
 * (/api/leagues/{leagueId}/trades/{tradeId}/accept|reject) so every engine
 * rule (vetoes, commissioner review, processing) applies unchanged — this is
 * a remote control, not a second trade engine. Honest footer: Sleeper-native
 * offers aren't visible to a read-only import, with deep links out.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { WarRoomCard } from './warroom/WarRoomCard'
import { SectionHeading } from './warroom/SectionHeading'
import '@/components/decide/broadcast-deck.css'

type InboxTrade = {
  tradeId: string
  leagueId: string
  leagueName: string
  partnerName: string
  createdAt: string
  youSend: string[]
  youReceive: string[]
}
type ApiResponse = {
  inbox: InboxTrade[]
  sleeperLeagues: { leagueId: string; leagueName: string; sleeperLeagueId: string }[]
  note: string
}

export function DecisionInbox() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, 'accepted' | 'rejected' | 'failed'>>({})

  const load = useCallback(() => {
    void fetch('/api/dashboard/decision-inbox', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<ApiResponse>) : null))
      .then((payload) => setData(payload ?? null))
      .catch(() => {
        /* additive */
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const act = useCallback(
    async (t: InboxTrade, action: 'accept' | 'reject') => {
      setBusyId(t.tradeId)
      try {
        const res = await fetch(
          `/api/leagues/${encodeURIComponent(t.leagueId)}/trades/${encodeURIComponent(t.tradeId)}/${action}`,
          { method: 'POST', credentials: 'same-origin' },
        )
        setDone((prev) => ({
          ...prev,
          [t.tradeId]: res.ok ? (action === 'accept' ? 'accepted' : 'rejected') : 'failed',
        }))
        if (res.ok) setTimeout(load, 800)
      } catch {
        setDone((prev) => ({ ...prev, [t.tradeId]: 'failed' }))
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  // Nothing pending and nothing to say → stay out of the way.
  if (!loading && (!data || data.inbox.length === 0)) return null

  return (
    <WarRoomCard className="p-4 sm:p-5" data-testid="decision-inbox">
      <SectionHeading
        trailing={
          data ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
              {data.inbox.length} awaiting you
            </span>
          ) : undefined
        }
      >
        Decision inbox — trades awaiting your call
      </SectionHeading>
      {loading || !data ? (
        <div className="bdx-skel" style={{ height: 56, marginTop: 12 }} />
      ) : (
        <div className="bdx mt-3 space-y-2" style={{ background: 'transparent', padding: 0 }}>
          {data.inbox.map((t) => {
            const state = done[t.tradeId]
            return (
              <div
                key={t.tradeId}
                className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3.5 py-3"
                style={{ borderLeft: '3px solid #ff6b8b' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-extrabold text-[#f0f2ff]">
                    {t.partnerName} → you
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#5d64a3]">
                    {t.leagueName} · {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] text-[#8b93cf]">
                  <span className="text-[#5d64a3]">You get:</span>{' '}
                  {t.youReceive.join(', ') || 'nothing'}{' '}
                  <span className="text-[#5d64a3]">· You send:</span>{' '}
                  {t.youSend.join(', ') || 'nothing'}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {state === 'accepted' ? (
                    <span className="bdx-sev ok">✓ accepted</span>
                  ) : state === 'rejected' ? (
                    <span className="bdx-sev info">rejected</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="bdx-btn pri"
                        style={{ padding: '5px 14px', fontSize: 11.5 }}
                        disabled={busyId === t.tradeId}
                        onClick={() => void act(t, 'accept')}
                      >
                        {busyId === t.tradeId ? 'Working…' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        className="bdx-btn sec"
                        style={{ padding: '5px 14px', fontSize: 11.5 }}
                        disabled={busyId === t.tradeId}
                        onClick={() => void act(t, 'reject')}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {state === 'failed' ? (
                    <span className="bdx-sev warn">action failed — nothing changed, try again</span>
                  ) : null}
                  <Link
                    href={`/league/${t.leagueId}?view=trades`}
                    className="ml-auto text-[11px] font-semibold text-[#7fb3ff] hover:underline"
                  >
                    Review with market values →
                  </Link>
                </div>
              </div>
            )
          })}
          <p className="text-[10px] leading-snug text-[#5d64a3]">
            {data.note}
            {data.sleeperLeagues.length > 0 ? (
              <>
                {' '}
                {data.sleeperLeagues.slice(0, 4).map((l, i) => (
                  <a
                    key={l.leagueId}
                    href={`https://sleeper.com/leagues/${l.sleeperLeagueId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#7fb3ff] hover:underline"
                  >
                    {i > 0 ? ' · ' : ''}
                    {l.leagueName} on Sleeper ↗
                  </a>
                ))}
              </>
            ) : null}
          </p>
        </div>
      )}
    </WarRoomCard>
  )
}

export default DecisionInbox
