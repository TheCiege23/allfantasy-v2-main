'use client'

import './af-manager-record.css'

import { useEffect, useRef, useState, type RefObject } from 'react'

import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { draftFactText, draftReasonText } from '@/components/core-app/screens/DraftCompetitiveEdge'
import { useOverlayContainment } from '@/components/core-app/useOverlayContainment'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { lockSubjectText } from '@/lib/core-app/coreDepthLockCopy'
import { waiverFactText } from '@/lib/core-app/playerCardCopy'
import { tradeVisualCopy } from '@/lib/core-app/tradeVisualCopy'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { ManagerRecord } from '@/lib/competitive-edge/managerRecord'

/**
 * THE MANAGER CARD — one leaguemate's whole record, as facts (2026-11-16, re-score item 11: Manager
 * Psychology as facts only, paid). Their trades by position, their waiver claims and FAAB this season,
 * their past drafts. The same record Chimmy and the commissioner's screen read, so the three agree.
 *
 * ⚠ NO NEW SENTENCE. Every line is a Competitive Edge builder's own, translated by the translators the
 * Trade Center, Waivers screen and Draft HQ already use. Nothing here says what kind of manager this
 * is, or what they will do.
 *
 * ⚠ THE SERVER WITHHOLDS. Without the plan the route returns the lock and no record; this draws the
 * lock card (iOS-safe), it does not hide data it was sent.
 */

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'locked'; access: CoreDepthAccess }
  | { state: 'ready'; record: ManagerRecord }

const COPY = {
  en: {
    loading: 'Reading their record…',
    close: 'Close',
    basis: 'Competitive Edge · what they have done, as counts. It says nothing about what they will do.',
    trades: 'Trades',
    waivers: 'Waivers this season',
    drafts: 'Past drafts',
    stale: 'This history may be out of date.',
    unattributed: (seasons: string) => `Picks from ${seasons} are not matched to managers yet, so this count may be low.`,
    failed: 'This record could not be read just now.',
    subject: 'A manager’s full record',
  },
  es: {
    loading: 'Leyendo su historial…',
    close: 'Cerrar',
    basis: 'Competitive Edge · lo que ha hecho, en números. No dice nada de lo que hará.',
    trades: 'Intercambios',
    waivers: 'Reclamos esta temporada',
    drafts: 'Drafts anteriores',
    stale: 'Este historial puede estar desactualizado.',
    unattributed: (seasons: string) => `Las selecciones de ${seasons} todavía no están asignadas a mánagers, así que este número puede ser bajo.`,
    failed: 'No se pudo leer este historial ahora.',
    subject: 'El historial completo de un mánager',
  },
} as const

function Section({ title, reason, children }: { title: string; reason: string | null; children?: React.ReactNode }) {
  return (
    <section className="af-mr-section">
      <h3>{title}</h3>
      {reason ? <p className="af-mr-reason">{reason}</p> : children}
    </section>
  )
}

export function ManagerRecordView({ record, language }: { record: ManagerRecord; language: string }) {
  const c = language === 'es' ? COPY.es : COPY.en
  // The draft reason translator falls back to the shared /core copy for every other reason.
  const reason = (r: string) => draftReasonText(r, language)
  const { trades, waivers, drafts } = record
  return (
    <>
      <Section title={c.trades} reason={trades.available ? null : reason(trades.reason)}>
        {trades.available ? (
          <>
            <ul>
              {trades.data.facts.map((f) => (
                <li key={f.key}>{tradeVisualCopy(f.text, language)}</li>
              ))}
            </ul>
            {trades.data.coverage.shortfall ? <p className="af-mr-note">{tradeVisualCopy(trades.data.coverage.shortfall, language)}</p> : null}
            {trades.data.coverage.stale ? <p className="af-mr-note">{c.stale}</p> : null}
          </>
        ) : null}
      </Section>
      <Section title={c.waivers} reason={waivers.available ? null : reason(waivers.reason)}>
        {waivers.available ? (
          <>
            <ul>
              {waivers.data.facts.map((f) => (
                <li key={f.key}>{waiverFactText(f, language)}</li>
              ))}
            </ul>
            {waivers.data.stale ? <p className="af-mr-note">{c.stale}</p> : null}
          </>
        ) : null}
      </Section>
      <Section title={c.drafts} reason={drafts.available ? null : reason(drafts.reason)}>
        {drafts.available ? (
          <>
            <ul>
              {drafts.data.facts.map((f) => (
                <li key={f.key}>{draftFactText(f, language)}</li>
              ))}
            </ul>
            {drafts.data.unattributedSeasons.length ? (
              <p className="af-mr-note">{c.unattributed(drafts.data.unattributedSeasons.join(', '))}</p>
            ) : null}
          </>
        ) : null}
      </Section>
    </>
  )
}

export function ManagerRecordSheet(props: {
  leagueId: string
  teamExternalId: string
  managerName: string
  onClose: () => void
  openerRef: RefObject<HTMLElement | null>
  /** Injected in tests; the browser's fetch otherwise. */
  fetcher?: typeof fetch
}) {
  const { language } = useOptionalLanguage()
  const c = language === 'es' ? COPY.es : COPY.en
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const panelRef = useRef<HTMLDivElement | null>(null)
  useOverlayContainment({ active: true, containerRef: panelRef, onClose: props.onClose, restoreFallbackRef: props.openerRef })

  const { leagueId, teamExternalId, fetcher } = props
  useEffect(() => {
    const ctrl = new AbortController()
    const f = fetcher ?? fetch
    f(`/api/leagues/${encodeURIComponent(leagueId)}/manager-record?team=${encodeURIComponent(teamExternalId)}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as
          | { locked?: boolean; access?: CoreDepthAccess; record?: ManagerRecord; error?: string }
          | null
        if (ctrl.signal.aborted) return
        if (res.ok && body?.locked && body.access) setLoaded({ state: 'locked', access: body.access })
        else if (res.ok && body?.record) setLoaded({ state: 'ready', record: body.record })
        else setLoaded({ state: 'error', message: body?.error ?? '' })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLoaded({ state: 'error', message: '' })
      })
    return () => ctrl.abort()
  }, [leagueId, teamExternalId, fetcher])

  return (
    <div
      className="af-mr-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div ref={panelRef} className="af-mr-sheet" role="dialog" aria-modal="true" aria-label={props.managerName} data-testid="manager-record-sheet">
        <span className="af-mr-grip" aria-hidden />
        <header className="af-mr-head">
          <h2 className="af-mr-name">{props.managerName}</h2>
          <button type="button" className="af-mr-close" onClick={props.onClose}>
            {c.close}
          </button>
        </header>
        {loaded.state === 'loading' ? <p className="af-mr-note">{c.loading}</p> : null}
        {loaded.state === 'error' ? (
          <p className="af-mr-reason" role="alert">
            {loaded.message ? coreUiCopy(loaded.message, language) : c.failed}
          </p>
        ) : null}
        {loaded.state === 'locked' ? <CoreDepthLock access={loaded.access} what={lockSubjectText(c.subject, language)} lang={language} /> : null}
        {loaded.state === 'ready' ? (
          <>
            <p className="af-mr-basis">{c.basis}</p>
            <ManagerRecordView record={loaded.record} language={language} />
          </>
        ) : null}
      </div>
    </div>
  )
}

/** The control that opens the card — a button, so it works from any list of managers. */
export function ManagerRecordButton(props: { leagueId: string; teamExternalId: string; managerName: string; label?: string }) {
  const { language } = useOptionalLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={ref} type="button" className="af-mr-open" onClick={() => setOpen(true)} data-testid="manager-record-open">
        {props.label ?? (language === 'es' ? 'Historial completo' : 'Full record')}
      </button>
      {open ? (
        <ManagerRecordSheet
          leagueId={props.leagueId}
          teamExternalId={props.teamExternalId}
          managerName={props.managerName}
          onClose={() => setOpen(false)}
          openerRef={ref}
        />
      ) : null}
    </>
  )
}
