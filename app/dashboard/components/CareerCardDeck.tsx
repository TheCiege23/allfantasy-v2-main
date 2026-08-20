'use client'

/**
 * CareerCardDeck — the Manager Career Card on the dashboard: aggregated
 * all-time record, titles, trade/draft grade résumés, and league records held,
 * with one-tap sharing (PNG via the share pipeline). Every number is the same
 * number the Legacy tabs show — this card aggregates, never re-derives.
 */

import { useEffect, useState } from 'react'
import type { CareerCardPayload } from '@/lib/dashboard-intel/careerCardService'
import { sleeperAvatarThumb } from '@/lib/sports-data/headshots'
import { shareCardImage } from '@/components/decide/shareCard'
import { WarRoomCard } from './warroom/WarRoomCard'
import { SectionHeading } from './warroom/SectionHeading'
import '@/components/decide/broadcast-deck.css'

function gradeLine(grades: Record<string, number>): string {
  return (['A', 'B', 'C', 'D', 'F'] as const)
    .filter((g) => grades[g] > 0)
    .map((g) => `${grades[g]}×${g}`)
    .join('  ')
}

export function CareerCardDeck() {
  const [card, setCard] = useState<CareerCardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareState, setShareState] = useState<'idle' | 'working' | 'shared' | 'downloaded' | 'failed'>('idle')

  useEffect(() => {
    let cancelled = false
    void fetch('/api/user/career-card', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ card: CareerCardPayload | null }>) : null))
      .then((payload) => {
        if (!cancelled) setCard(payload?.card ?? null)
      })
      .catch(() => {
        /* additive card */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && !card) return null
  const av = card ? sleeperAvatarThumb(card.avatar) : null

  return (
    <WarRoomCard className="p-4 sm:p-5" data-testid="career-card-deck">
      <SectionHeading
        trailing={
          card ? (
            <button
              type="button"
              className="bdx-btn sec"
              style={{ padding: '4px 10px', fontSize: 11 }}
              disabled={shareState === 'working'}
              onClick={() => {
                setShareState('working')
                void shareCardImage('/api/share/career-card', 'career-card.png', 'My AllFantasy career').then(setShareState)
              }}
            >
              {shareState === 'working'
                ? 'Building…'
                : shareState === 'shared'
                  ? 'Shared ✓'
                  : shareState === 'downloaded'
                    ? 'Saved ✓'
                    : shareState === 'failed'
                      ? 'Retry share'
                      : 'Share card'}
            </button>
          ) : undefined
        }
      >
        Your career — all leagues
      </SectionHeading>
      {loading || !card ? (
        <div className="bdx-skel" style={{ height: 64, marginTop: 12 }} />
      ) : (
        <div className="bdx" style={{ background: 'transparent', padding: 0 }}>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {av ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={av} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : null}
            <span className="text-[15px] font-black italic text-[#f0f2ff]">{card.managerName}</span>
            <span className="text-[11px] text-[#5d64a3]">
              {card.leaguesIncluded} leagues · {card.allTime.seasons} seasons synced
            </span>
          </div>
          {/* ── This season — the year you're playing right now, isolated ── */}
          {(() => {
            const seasons = card.seasonTotals ?? []
            const nowYear = new Date().getFullYear()
            const thisSeason = seasons.find((s) => s.season === nowYear) ?? null
            return (
              <div className="mt-3">
                <div className="text-[9.5px] font-black uppercase italic tracking-wide text-[#ff8a3d]">
                  This season · {nowYear}
                </div>
                {thisSeason ? (
                  <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { l: 'Record', v: `${thisSeason.wins}–${thisSeason.losses}${thisSeason.ties > 0 ? `–${thisSeason.ties}` : ''}` },
                      { l: 'Titles', v: `${thisSeason.titles > 0 ? '🏆 ' : ''}${thisSeason.titles}` },
                      { l: 'Points for', v: thisSeason.pointsFor.toLocaleString() },
                      { l: 'Leagues', v: `${thisSeason.leagues}` },
                    ].map((k) => (
                      <div key={k.l} className="rounded-xl border border-[#3a2a5e] bg-[#171c4d]/80 px-3 py-2.5" style={{ borderColor: 'rgba(255,138,61,0.35)' }}>
                        <div className="text-[18px] font-black italic tabular-nums text-[#f0f2ff]">{k.v}</div>
                        <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5d64a3]">{k.l}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1.5 rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3 py-2.5 text-[11px] text-[#5d64a3]">
                    No synced {nowYear} games yet — this fills in as your leagues play.
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Total overall — every synced season combined ── */}
          <div className="mt-3 text-[9.5px] font-black uppercase italic tracking-wide text-[#ff3d81]">
            Total overall · {card.allTime.seasons} seasons
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: 'All-time record', v: `${card.allTime.wins}–${card.allTime.losses}${card.allTime.ties > 0 ? `–${card.allTime.ties}` : ''}` },
              { l: 'Titles', v: `${card.allTime.titles > 0 ? '🏆 ' : ''}${card.allTime.titles}` },
              { l: 'Points for', v: card.allTime.pointsFor.toLocaleString() },
              { l: 'Records held', v: `${card.recordsHeld.length}` },
            ].map((k) => (
              <div key={k.l} className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3 py-2.5">
                <div className="text-[18px] font-black italic tabular-nums text-[#f0f2ff]">{k.v}</div>
                <div className="mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5d64a3]">{k.l}</div>
              </div>
            ))}
          </div>

          {/* ── Past seasons — year-by-year, newest first, same rows the totals sum ── */}
          {(() => {
            const nowYear = new Date().getFullYear()
            const past = (card.seasonTotals ?? []).filter((s) => s.season !== nowYear)
            if (past.length === 0) return null
            return (
              <details className="mt-3 rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3 py-2.5" open={past.length <= 6}>
                <summary className="cursor-pointer text-[9.5px] font-black uppercase italic tracking-wide text-[#5d64a3]">
                  Past seasons by year · {past.length}
                </summary>
                <div className="mt-2 max-h-56 overflow-y-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[9px] font-bold uppercase tracking-wide text-[#5d64a3]">
                        <th className="py-1 pr-2">Year</th>
                        <th className="py-1 pr-2">Record</th>
                        <th className="py-1 pr-2">Points for</th>
                        <th className="py-1 pr-2">Titles</th>
                        <th className="py-1">Leagues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {past.map((s) => (
                        <tr key={s.season} className="border-t border-[#1c2158] text-[12px] tabular-nums text-[#c6cbf5]">
                          <td className="py-1.5 pr-2 font-extrabold text-[#f0f2ff]">{s.season}</td>
                          <td className="py-1.5 pr-2">{s.wins}–{s.losses}{s.ties > 0 ? `–${s.ties}` : ''}</td>
                          <td className="py-1.5 pr-2">{s.pointsFor.toLocaleString()}</td>
                          <td className="py-1.5 pr-2">{s.titles > 0 ? `🏆 ${s.titles}` : '—'}</td>
                          <td className="py-1.5">{s.leagues}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })()}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3 py-2.5">
              <div className="text-[9.5px] font-bold uppercase tracking-wide text-[#5d64a3]">
                Trade résumé · {card.trades.graded} graded{card.trades.ties > 0 ? ` · ${card.trades.ties} ties` : ''}
              </div>
              <div className="mt-1 text-[13px] font-extrabold text-[#c6cbf5]">{gradeLine(card.trades.grades) || '—'}</div>
              <div className={`text-[11px] font-bold tabular-nums ${card.trades.totalNet >= 0 ? 'text-[#3ddc97]' : 'text-[#ff6b8b]'}`}>
                net {card.trades.totalNet > 0 ? '+' : ''}
                {card.trades.totalNet.toFixed(0)} pts while assets held
              </div>
            </div>
            <div className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3 py-2.5">
              <div className="text-[9.5px] font-bold uppercase tracking-wide text-[#5d64a3]">
                Draft résumé · {card.drafts.graded} graded
              </div>
              <div className="mt-1 text-[13px] font-extrabold text-[#c6cbf5]">{gradeLine(card.drafts.grades) || '—'}</div>
              <div className={`text-[11px] font-bold tabular-nums ${card.drafts.totalValueOver >= 0 ? 'text-[#3ddc97]' : 'text-[#ff6b8b]'}`}>
                {card.drafts.totalValueOver > 0 ? '+' : ''}
                {card.drafts.totalValueOver} value over round medians
              </div>
            </div>
          </div>
          {card.recordsHeld.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.recordsHeld.map((r) => (
                <span key={r} className="bdx-sev ok">🏅 {r}</span>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-[10px] leading-snug text-[#5d64a3]">
            Aggregated from the same Legacy engines each league renders — history chains, graded trades, graded drafts, records book.
            {card.missing.length > 0 ? ` Couldn't sync: ${card.missing.join(', ')}.` : ''}
          </p>
        </div>
      )}
    </WarRoomCard>
  )
}

export default CareerCardDeck
