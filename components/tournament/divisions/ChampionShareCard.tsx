'use client'
/**
 * TournamentChampion: the share card, drawn in the app from tournament data and
 * exported as a PNG at its exact size (1080 × 1350 / 1920 / 1080). The export
 * renders an unscaled copy off screen, so the PNG is pixel-exact rather than a
 * screenshot of the preview.
 *
 * "Post to league chat" sends the same PNG, a caption and the trophy link into the viewer's own
 * conference league chat (`/api/tournament/divisions/share-to-chat`). It is shown only when the
 * server says the viewer is a member of one of the tournament's leagues; the route checks again.
 */
import { useRef, useState } from 'react'
import { crestFor } from '@/lib/tournament/divisions/identity'
import { SHARE_SIZES, type ShareCard, type ShareSize } from '@/lib/tournament/divisions/shareCard'
import type { HubView } from '@/lib/tournament/divisions/hubView'
import { DivisionCrest } from './DivisionArt'

const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }

export function ShareCardFace({ card, view, size, showPath, showStats }: { card: ShareCard; view: HubView; size: ShareSize; showPath: boolean; showStats: boolean }) {
  const { width, height } = SHARE_SIZES[size]
  const division = view.identity.divisions[card.divisionIndex]
  const conference = view.identity.conferences[card.conferenceIndex] ?? view.identity.conferences[0]!
  const crestSize = size === 'story' ? 420 : size === 'post' ? 300 : 190
  // The story fits the whole road; shorter cards keep its last rounds.
  const rows = showPath ? card.path.slice(size === 'story' ? 0 : size === 'post' ? -3 : -1) : []
  return (
    <div className="relative flex flex-col items-center overflow-hidden text-white" style={{ width, height, padding: 64, background: 'radial-gradient(ellipse at 50% 22%, #8a7a45 0%, #3a3320 35%, #0b0d14 75%)', fontFamily: "'Archivo', ui-sans-serif, sans-serif" }}>
      <p style={{ fontSize: 30, letterSpacing: 10, fontWeight: 800, color: '#ffd98a' }}>{card.eyebrow.toUpperCase()}</p>
      <div style={{ marginTop: 24 }}><DivisionCrest art={crestFor(division, conference)} size={crestSize} /></div>
      {/* Solid gold, not background-clip text: the PNG export cannot render clipped gradients. */}
      <p style={{ fontSize: (card.champion ? 120 : 84) * (size === 'square' ? 0.8 : 1), fontWeight: 900, letterSpacing: 8, lineHeight: 1.15, marginTop: 16, color: '#f2c75c', textShadow: '0 4px 0 #8a6420' }}>{card.headline}</p>
      <p style={{ fontSize: 60, fontWeight: 800, marginTop: 8 }}>{card.team}</p>
      <p style={{ fontSize: 30, color: '#c7cbe0', marginTop: 8 }}>{card.subtitle}</p>
      {showStats && (
        <div style={{ display: 'flex', gap: 24, marginTop: 36, width: '100%' }}>
          {card.stats.map(s => (
            <div key={s.label} style={{ flex: 1, background: 'rgba(11,13,20,0.75)', borderRadius: 22, padding: '22px 12px', textAlign: 'center' }}>
              <p style={{ ...mono, fontSize: 52, fontWeight: 700 }}>{s.value}</p>
              <p style={{ fontSize: 24, letterSpacing: 4, color: '#c7cbe0', fontWeight: 700 }}>{s.label.toUpperCase()}</p>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <ol style={{ width: '100%', marginTop: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <li key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 20, background: 'rgba(11,13,20,0.7)', borderRadius: 14, padding: '14px 22px', fontSize: 28, lineHeight: 1.35 }}>
              <span style={{ width: 300, letterSpacing: 3, fontWeight: 800, color: '#aeb4cc' }}>{r.label.toUpperCase()}</span>
              <span style={{ flex: 1, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.opponent.length > 26 ? r.opponent.slice(0, 25) + '…' : r.opponent}</span>
              <span style={{ ...mono, color: r.won === false ? '#ff9a9a' : '#ffd98a' }}>{r.score}</span>
            </li>
          ))}
        </ol>
      )}
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 48, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <span style={{ fontSize: 28, letterSpacing: 4, fontWeight: 800, color: '#c7cbe0' }}>ALLFANTASY.AI</span>
        <span style={{ fontSize: 40, color: '#e8b84a', fontFamily: 'Caveat, cursive' }}>created by KB</span>
      </div>
    </div>
  )
}

export type ChatShareTarget = { tournamentId: string; entryId: string }

export function ChampionShareStudio({ card, view, shareUrl, chatShare }: { card: ShareCard; view: HubView; shareUrl: string; chatShare?: ChatShareTarget | null }) {
  const [size, setSize] = useState<ShareSize>('story')
  const [showPath, setShowPath] = useState(true)
  const [showStats, setShowStats] = useState(true)
  const [notice, setNotice] = useState('')
  const exportRef = useRef<HTMLDivElement>(null)
  const { width, height } = SHARE_SIZES[size]
  const scale = 560 / height

  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState(false)

  async function renderCanvas(): Promise<HTMLCanvasElement | null> {
    const el = exportRef.current?.firstElementChild as HTMLElement | null
    if (!el) return null
    const html2canvas = (await import('html2canvas')).default
    return html2canvas(el, { scale: 1, width, height, backgroundColor: '#0b0d14', useCORS: true, logging: false })
  }

  async function postToChat() {
    if (!chatShare || posting) return
    setPosting(true)
    try {
      const form = new FormData()
      form.set('tournamentId', chatShare.tournamentId)
      form.set('entryId', chatShare.entryId)
      // The card image is best effort: without it the caption and link still post.
      const canvas = await renderCanvas().catch(() => null)
      const blob = canvas ? await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')) : null
      if (blob) form.set('file', blob, `allfantasy-tournament-${size}.png`)
      const res = await fetch('/api/tournament/divisions/share-to-chat', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { error?: string; leagueName?: string }
      if (res.ok) { setPosted(true); setNotice(`Posted to ${data.leagueName ?? 'your league'} chat.`) }
      else { if (res.status === 409) setPosted(true); setNotice(data.error ?? 'Could not post to league chat. Try again.') }
    } catch { setNotice('Could not post to league chat. Try again.') }
    setPosting(false)
  }

  async function download() {
    try {
      const canvas = await renderCanvas()
      if (!canvas) return
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `allfantasy-${card.champion ? 'champion' : 'tournament'}-${size}-${width}x${height}.png`
      a.click()
      setNotice(`Saved a ${width} × ${height} PNG.`)
    } catch { setNotice('Could not create the image. Try again.') }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setNotice('Link copied.') } catch { setNotice(shareUrl) }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid min-h-[600px] place-items-center overflow-hidden rounded-2xl border border-white/10 bg-[repeating-linear-gradient(135deg,#0b0d14_0_14px,#0e1018_14px_28px)] p-5" aria-label="Share card preview">
        <div style={{ width: width * scale, height: height * scale }} className="overflow-hidden rounded-3xl border border-[#e8b84a]/40">
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width, height }}>
            <ShareCardFace card={card} view={view} size={size} showPath={showPath} showStats={showStats} />
          </div>
        </div>
      </section>
      <aside className="space-y-4">
        <section className="rounded-2xl border border-white/10 bg-[#0b0d14] p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Size</h2>
          <div role="radiogroup" aria-label="Card size" className="mt-2 inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
            {(Object.keys(SHARE_SIZES) as ShareSize[]).map(k => <button key={k} type="button" role="radio" aria-checked={size === k} onClick={() => setSize(k)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 aria-checked:bg-[#1a1c26] aria-checked:text-[#ffd98a]">{SHARE_SIZES[k].label}</button>)}
          </div>
          <p className="mt-2 text-sm text-slate-400">Exports at {width} × {height} · {SHARE_SIZES[size].use}.</p>
          <h2 className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">On the card</h2>
          {([['Road to the title', showPath, setShowPath], ['Final score and record', showStats, setShowStats]] as const).map(([label, on, set]) => (
            <div key={label} className="mt-2 flex min-h-11 items-center justify-between gap-3 border-b border-white/5 text-white">
              <span id={`sw-${label.replace(/\W+/g, '-')}`}>{label}</span>
              <button type="button" role="switch" aria-checked={on} aria-labelledby={`sw-${label.replace(/\W+/g, '-')}`} onClick={() => set(!on)}
                className={'relative h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none ' + (on ? 'bg-[#e8b84a]' : 'bg-[#2a2d3a]')}>
                <span aria-hidden="true" className={'absolute top-1 h-5 w-5 rounded-full bg-[#1a1204] transition-all motion-reduce:transition-none ' + (on ? 'left-6' : 'left-1 bg-slate-300')} />
              </button>
            </div>
          ))}
          <button type="button" onClick={download} className="mt-4 min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204]">Download image</button>
          <button type="button" onClick={copy} className="mt-3 min-h-11 w-full rounded-xl border border-white/15 bg-[#0e1018] font-bold text-white">Copy link</button>
          {chatShare && (
            <button type="button" onClick={postToChat} disabled={posting || posted} className="mt-3 min-h-11 w-full rounded-xl border border-[#e8b84a]/50 bg-[#0e1018] font-bold text-[#ffd98a] disabled:opacity-60">
              {posted ? 'Posted to league chat' : posting ? 'Posting…' : 'Post to league chat'}
            </button>
          )}
          <p role="status" className="mt-2 text-sm text-slate-300">{notice}</p>
        </section>
      </aside>
      {/* Unscaled copy for the PNG export. Off screen, not hidden, so the browser lays it out. */}
      <div ref={exportRef} aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
        <ShareCardFace card={card} view={view} size={size} showPath={showPath} showStats={showStats} />
      </div>
    </div>
  )
}
