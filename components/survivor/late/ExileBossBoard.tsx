'use client'

import { useEffect, useState } from 'react'
import type { ExileBossBoardView } from '@/lib/survivor/exileBossBoard'
import type { ExileBoardRow } from '@/lib/survivor/exileBoss'
import { LateAvatar, fmt1 } from './lateUi'
import './late-season.css'

const GOLD = 'linear-gradient(90deg,#5a4a20,#d9b45a)'
const GREEN = 'linear-gradient(90deg,#2f8f5a,#7ad68c)'
const RED = 'linear-gradient(90deg,#6b2a22,#a3463a)'

function stampFor(row: ExileBoardRow, final: boolean): { text: string; color: string } {
  if (!final) return row.liveStatus === 'ahead' ? { text: 'Ahead', color: '#c9cde0' } : { text: 'Behind', color: '#6f7590' }
  if (row.finalStatus === 'won_week') return { text: 'Won the week', color: '#7ad68c' }
  if (row.finalStatus === 'safe') return { text: 'Safe', color: '#7ad68c' }
  if (row.finalStatus === 'wiped') return { text: 'Wiped', color: '#ff4a2f' }
  return { text: 'No entry', color: '#6f7590' }
}

function Coins({ row, final }: { row: ExileBoardRow; final: boolean }) {
  const wiped = final && row.finalStatus === 'wiped' && row.wipedTokens > 0
  const shown = Math.min(row.tokens, 8)
  return (
    <span style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      {Array.from({ length: shown }, (_, i) => (
        <img key={`t${i}`} src="/survivor/exile/token-icon.svg" alt="" width={16} height={16} />
      ))}
      {/* One wiped coin marks a manager the boss wiped this week (exile handoff, Exile board). */}
      {wiped ? <img src="/survivor/exile/token-coin-wiped.svg" alt="" width={16} height={16} /> : null}
      <span className="svl-t3" style={{ fontSize: 11.5, marginLeft: 4 }}>
        {wiped ? `${row.wipedTokens} wiped` : `${row.tokens} token${row.tokens === 1 ? '' : 's'}`}
      </span>
    </span>
  )
}

export function ExileBossBoardView({ board }: { board: ExileBossBoardView }) {
  const final = board.status === 'final'
  const boss = board.boss
  const max = Math.max(1, (boss ?? 0) * 1.3, ...board.rows.map((r) => Math.max(r.score, r.projected ?? 0)))
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100)).toFixed(1)}%`
  const outcome = board.myOutcome
  return (
    <div className="svl" style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
      <section className="svl-card svl-boss-card" aria-label="The Exile boss">
        <img className="svl-boss-mask" src="/survivor/late/exile-boss.svg" alt="The Exile boss" />
        <span className="svl-lbl" style={{ color: '#ff8a6a' }}>
          {final ? 'Final boss score' : 'Boss score so far'} · Week {board.week}
        </span>
        <span className="svl-num svl-boss-score" aria-live="polite">{boss == null ? '—' : fmt1(boss)}</span>
        <p className="svl-t2" style={{ maxWidth: 360 }}>
          {board.wipeOnLoss
            ? 'Anyone on Exile Island who finishes below the boss loses every token they hold. Finish above it and your tokens are safe.'
            : 'Finish above the boss to stay in the running. This league does not wipe tokens when the boss wins.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span className="svl-chip">Boss score: {board.modeLabel}</span>
          <span className="svl-chip">Set in Survivor settings</span>
        </div>
      </section>

      <div style={{ flex: '1 1 560px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="svl-lbl" style={{ flex: 1 }}>Exile Island vs the boss</span>
          <span className="svl-t3">{final ? 'All games final' : 'Games in progress'}</span>
        </div>
        {board.rows.length === 0 ? <p className="svl-t2">Nobody is on Exile Island this week.</p> : null}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {board.rows.map((row) => {
            const stamp = stampFor(row, final)
            const above = boss != null && row.score >= boss
            const fill = final ? (row.finalStatus === 'wiped' ? RED : GREEN) : GOLD
            const border = final && row.finalStatus === 'wiped' ? 'rgba(255,74,47,.35)' : final && row.finalStatus === 'won_week' ? 'rgba(122,214,140,.35)' : undefined
            return (
              <li key={row.userId} className="svl-eb-row" style={border ? { borderColor: border } : undefined}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span className="svl-num svl-t3" aria-label={`Rank ${row.rank}`} style={{ width: 18, textAlign: 'right' }}>{row.rank}</span>
                  <LateAvatar id={row.userId} name={row.displayName} size="sm" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{row.displayName}</span>
                    <Coins row={row} final={final} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="svl-eb-track" role="img" aria-label={`${fmt1(row.score)} points${boss != null ? ` against a boss score of ${fmt1(boss)}` : ''}`}>
                    <div className="svl-eb-fill" style={{ width: pct(row.score), background: fill }} />
                    {boss != null ? <div className="svl-eb-line" style={{ left: pct(boss) }} title="Boss score" /> : null}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5 }}>
                    <span className="svl-num">{fmt1(row.score)}{!final && row.projected != null ? ` · proj ${Math.round(row.projected)}` : ''}</span>
                    {row.margin != null ? (
                      <span className="svl-num" style={{ color: above ? '#9be3a8' : '#ff8a6a' }}>
                        {row.margin > 0 ? '+' : ''}{fmt1(row.margin)} vs boss
                      </span>
                    ) : null}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="svl-stamp" style={{ color: stamp.color, borderColor: stamp.color }}>{stamp.text}</span>
                </div>
              </li>
            )
          })}
        </ol>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 2px' }}>
          <span aria-hidden="true" style={{ width: 18, height: 3, background: '#ff4a2f', boxShadow: '0 0 8px rgba(255,74,47,.7)' }} />
          <span className="svl-t3">The red line is the boss score. Bars fill as games finish.</span>
        </div>
        {/* Exile board footer: the boss score for the week (exile handoff). */}
        <p className="svl-t3" style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 8 }}>
          Boss score, week {board.week}: <span className="svl-num" style={{ color: '#ffd0c0' }}>{boss == null ? 'not set yet' : fmt1(boss)}</span>
          {boss == null && board.mode !== 'fixed' ? ' — it appears once main-island scores come in.' : ''}
        </p>

        {outcome ? (
          <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
            {outcome.kind === 'beat' ? (
              <div className="svl-toast" style={{ borderColor: 'rgba(122,214,140,.3)' }}>
                <img src="/survivor/exile/token-coin.svg" alt="" width={54} height={54} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontWeight: 700, color: '#9be3a8' }}>You beat the boss</span>
                  <span className="svl-t2" style={{ fontSize: 12.5 }}>
                    {fmt1(outcome.score)} to {fmt1(outcome.boss)}. Your tokens are safe{outcome.earnedToken ? ', and you won the week: +1 token.' : '.'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="svl-toast" style={{ borderColor: 'rgba(255,74,47,.3)' }}>
                <img src="/survivor/late/exile-boss-icon.svg" alt="" width={54} height={54} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontWeight: 700, color: '#ff8a6a' }}>The boss wins</span>
                  <span className="svl-t2" style={{ fontSize: 12.5 }}>
                    {fmt1(outcome.score)} to {fmt1(outcome.boss)}.{' '}
                    {outcome.tokensWiped > 0 ? `Your ${outcome.tokensWiped} token${outcome.tokensWiped === 1 ? ' is' : 's are'} wiped. Start again next week.` : 'You had no tokens to lose. Start again next week.'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Loads the board from /api/survivor/exile?view=boss and refreshes every 60s while live. */
export function ExileBossBoard({ leagueId }: { leagueId: string }) {
  const [board, setBoard] = useState<ExileBossBoardView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading')
  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async () => {
      try {
        const res = await fetch(`/api/survivor/exile?leagueId=${encodeURIComponent(leagueId)}&view=boss`, { credentials: 'include' })
        if (cancelled) return
        if (res.status === 403) return setState('hidden')
        const data = (await res.json()) as { board?: ExileBossBoardView | null }
        if (cancelled) return
        setBoard(data.board ?? null)
        setState(data.board ? 'ready' : 'hidden')
        if (data.board?.status === 'live') timer = setTimeout(load, 60_000)
      } catch {
        if (!cancelled) setState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [leagueId])
  if (state === 'hidden') return null
  if (state === 'error') return <p className="text-[12px] text-red-300">The Exile board could not load.</p>
  if (!board) return <p className="text-[13px] text-white/50">Loading the Exile board…</p>
  return <ExileBossBoardView board={board} />
}
