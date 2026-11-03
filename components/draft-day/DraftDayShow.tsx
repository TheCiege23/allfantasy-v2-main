'use client'

import { useEffect, useRef, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { progress, viewerShowEntry, type DraftShow, type ShowEntry } from '@/lib/draft-day/draftShow'
import type { DraftDayView } from '@/lib/draft-day/draftDayService'

/**
 * Draft-day kit: the order reveal / lottery show, played in sync for everyone in the pre-draft room.
 * The commissioner starts it from Draft settings; this overlay polls for it while the draft has not
 * started and reads the timeline from the server's clock (see lib/draft-day/draftShow.ts).
 */

const POLL_MS = 5000
const PRE_DRAFT = new Set(['pre_draft', 'configuring', 'configured'])

type Copy = (en: string, es: string) => string

export function DraftDayShow({ leagueId, sessionStatus, viewerRosterId }: { leagueId: string; sessionStatus: string | null | undefined; viewerRosterId?: string | null }) {
  const { language } = useOptionalLanguage()
  const t: Copy = (en, es) => (language === 'es' ? es : en)
  const [show, setShow] = useState<DraftShow | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const skew = useRef(0)
  const waiting = PRE_DRAFT.has(String(sessionStatus ?? ''))

  useEffect(() => {
    if (!waiting) return
    let live = true
    const load = () => {
      // Never rejects: a failed poll keeps whatever is on screen and tries again.
      fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-day`, { credentials: 'same-origin', cache: 'no-store' })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as DraftDayView | null
          if (!live || !res.ok || !body) return
          const server = Date.parse(body.serverNow)
          if (Number.isFinite(server)) skew.current = server - Date.now()
          setShow(body.show)
        })
        .catch(() => {})
    }
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [leagueId, waiting])

  const active = waiting && show && dismissed !== show.startedAt
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [active])

  if (!active || !show) return null
  const p = progress(show, now + skew.current)
  if (p.over) return null
  const up = show.entries.slice(0, p.revealed)
  const latest = up[up.length - 1] ?? null
  const viewer = viewerShowEntry(show, p.revealed, viewerRosterId)
  const title = show.kind === 'lottery' ? t('Draft lottery', 'Lotería del draft') : t('Draft order reveal', 'Revelación del orden del draft')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title} data-testid="draft-day-show">
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0a1228] p-5 text-white shadow-2xl">
        <button
          type="button"
          onClick={() => setDismissed(show.startedAt)}
          className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-white/50 hover:bg-white/10 hover:text-white"
        >
          {t('Close', 'Cerrar')}
        </button>
        <h2 className="text-lg font-bold">{title}</h2>
        {p.introLeftMs > 0 ? (
          <p className="mt-6 text-center text-5xl font-black tabular-nums" aria-live="polite">
            {Math.ceil(p.introLeftMs / 1000)}
          </p>
        ) : (
          <>
            {latest && (
              <div key={latest.slot} className="mt-4 rounded-xl border border-cyan-400/40 bg-cyan-400/10 p-4 text-center" aria-live="polite" style={{ animation: 'afDraftShowIn 600ms ease-out' }}>
                <p className="text-xs uppercase tracking-widest text-cyan-200/80">{t(`Pick ${latest.slot}`, `Selección ${latest.slot}`)}</p>
                <p className="mt-1 text-2xl font-black">{latest.displayName}</p>
                <MoveLine t={t} entry={latest} kind={show.kind} />
              </div>
            )}
            {viewer && (
              <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-center" aria-live="polite" data-testid="draft-day-your-team">
                {viewer.state === 'waiting' ? (
                  <p className="text-sm font-semibold text-amber-100">{t('Your team is waiting to be revealed', 'Tu equipo aún espera su revelación')}</p>
                ) : (
                  <>
                    <p className="text-sm font-bold text-amber-100">{t(`Your team · Pick ${viewer.entry.slot}`, `Tu equipo · Selección ${viewer.entry.slot}`)}</p>
                    <MoveLine t={t} entry={viewer.entry} kind={show.kind} />
                  </>
                )}
              </div>
            )}
            <ol className="mt-4 space-y-1 text-sm">
              {[...show.entries].sort((a, b) => a.slot - b.slot).map((e) => {
                const isUp = up.some((u) => u.slot === e.slot)
                return (
                  <li key={e.slot} className={`flex items-center justify-between rounded-lg px-3 py-1.5 ${isUp && e.rosterId === viewerRosterId ? 'bg-amber-300/15 ring-1 ring-amber-300/30' : 'bg-white/[0.04]'}`}>
                    <span className="tabular-nums text-white/50">{e.slot}</span>
                    <span className={isUp ? 'font-semibold' : 'text-white/30'}>{isUp ? e.displayName : '• • •'}{isUp && e.rosterId === viewerRosterId ? ` (${t('you', 'tú')})` : ''}</span>
                    <span className="w-14 text-right text-xs text-white/40">{show.kind === 'lottery' && e.oddsPct != null && isUp ? `${Math.round(e.oddsPct)}%` : ''}</span>
                  </li>
                )
              })}
            </ol>
            <p className="mt-3 text-center text-xs text-white/50">
              {p.complete ? t('That is the order. Good luck!', 'Ese es el orden. ¡Suerte!') : t(`${show.entries.length - p.revealed} to go`, `Faltan ${show.entries.length - p.revealed}`)}
            </p>
          </>
        )}
      </div>
      <style>{'@keyframes afDraftShowIn{from{opacity:0;transform:scale(.92) rotateX(70deg)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}

function MoveLine({ t, entry, kind }: { t: Copy; entry: ShowEntry; kind: DraftShow['kind'] }) {
  if (kind !== 'lottery') return null
  const odds = entry.oddsPct != null ? t(`${Math.round(entry.oddsPct)}% odds at #1`, `${Math.round(entry.oddsPct)}% de opciones al #1`) : null
  const moved = entry.preLotterySlot != null ? entry.preLotterySlot - entry.slot : 0
  const move =
    moved > 0
      ? t(`Jumped ${moved} from odds rank ${entry.preLotterySlot}`, `Subió ${moved} desde el puesto ${entry.preLotterySlot} por probabilidades`)
      : moved < 0
        ? t(`Fell ${-moved} from odds rank ${entry.preLotterySlot}`, `Bajó ${-moved} desde el puesto ${entry.preLotterySlot} por probabilidades`)
        : null
  if (!odds && !move) return null
  return <p className="mt-1 text-xs text-white/60">{[odds, move].filter(Boolean).join(' · ')}</p>
}
