'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tInterpolate } from '@/lib/i18n/tInterpolate'
import type { ImportAuditSummary } from '@/lib/devy/mergeExecutionEngine'
import type { SuggestedMatch } from '@/lib/devy/ai/devyChimmy'
import { formatImportAuditPlainText } from '@/app/devy/lib/formatImportAuditText'
import {
  buildMergePreview,
  conflictTypeKey,
  CONFIDENCE_ORDER,
  countByConfidence,
  isPlayerMergeable,
  localizeMergeMessage,
  stepForStatus,
  type ImportSessionRow,
  type ImportSourceSummary,
  type LeagueManagerOption,
  type ManagerMappingRow,
  type MatchPayload,
  type MergeConflictRow,
  type PlayerMappingRow,
} from '@/app/devy/lib/importWizardModel'

const STEP_KEYS = [
  'devyImport.step.source',
  'devyImport.step.matching',
  'devyImport.step.conflicts',
  'devyImport.step.preMerge',
  'devyImport.step.audit',
] as const

type Tr = (key: string, vars?: Record<string, string | number>) => string

function useTr(): Tr {
  const { t } = useOptionalLanguage()
  return useCallback((key: string, vars?: Record<string, string | number>) => tInterpolate(t, key, vars ?? {}), [t])
}

// ─── API ────────────────────────────────────────────────────────────────

class ImportApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`)
  }
}

async function importApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const hasBody = init?.body !== undefined
  const r = await fetch(url, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init!.body) : undefined,
  })
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) {
    throw new ImportApiError(r.status, typeof j.code === 'string' ? j.code : undefined, typeof j.error === 'string' ? j.error : undefined)
  }
  return j as T
}

function errorText(e: unknown, tr: Tr): string {
  if (e instanceof ImportApiError) {
    if (e.status === 401) return tr('devyImport.error.signIn')
    if (e.status === 403) return tr('devyImport.error.forbidden')
    if (e.status === 404) return tr('devyImport.error.notFound')
    if (e.status === 409 && e.code === 'already_merged') return tr('devyImport.error.alreadyMerged')
  }
  return tr('devyImport.error.generic')
}

const sessionQuery = (sessionId: string) => `sessionId=${encodeURIComponent(sessionId)}`

// ─── Shared bits ────────────────────────────────────────────────────────

function Loading({ tr }: { tr: Tr }) {
  return (
    <p className="text-[12px] text-white/50" role="status" data-testid="import-loading">
      {tr('devyImport.loading')}
    </p>
  )
}

function ErrorBox({ message, onRetry, tr }: { message: string; onRetry?: () => void; tr: Tr }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-200" role="alert" data-testid="import-error">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 min-h-[36px] font-semibold text-red-100 underline">
          {tr('devyImport.retry')}
        </button>
      ) : null}
    </div>
  )
}

function NoSession({ tr, onGoToStart }: { tr: Tr; onGoToStart: () => void }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4 text-[12px] text-white/60" data-testid="import-no-session">
      <p>{tr('devyImport.noSession')}</p>
      <button type="button" onClick={onGoToStart} className="mt-3 min-h-[44px] font-semibold text-cyan-200 underline">
        {tr('devyImport.noSession.cta')}
      </button>
    </div>
  )
}

/** Two-tap confirm for anything that rewrites data: the first tap shows what will change, the
 *  second runs it. */
function ConfirmButton({
  label,
  confirmLabel,
  busyLabel,
  busy,
  disabled,
  onConfirm,
  testId,
  tone = 'danger',
  tr,
}: {
  label: string
  confirmLabel: string
  busyLabel: string
  busy: boolean
  disabled?: boolean
  onConfirm: () => void
  testId: string
  tone?: 'danger' | 'neutral'
  tr: Tr
}) {
  const [armed, setArmed] = useState(false)
  const cls =
    tone === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-100'
      : 'border-white/[0.12] bg-white/[0.04] text-white/85'
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          if (!armed) {
            setArmed(true)
            return
          }
          setArmed(false)
          onConfirm()
        }}
        className={`min-h-[44px] flex-1 rounded-xl border px-4 py-2 text-[13px] font-semibold disabled:opacity-40 ${cls}`}
        data-testid={testId}
        data-armed={armed ? 'true' : 'false'}
      >
        {busy ? busyLabel : armed ? confirmLabel : label}
      </button>
      {armed && !busy ? (
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="min-h-[44px] rounded-xl border border-white/[0.1] px-4 py-2 text-[13px] text-white/70"
          data-testid={`${testId}-cancel`}
        >
          {tr('devyImport.cancel')}
        </button>
      ) : null}
    </div>
  )
}

// ─── Wizard ─────────────────────────────────────────────────────────────

export function ImportWizard({ leagueId, initialSessionId }: { leagueId: string; initialSessionId?: string }) {
  const tr = useTr()
  const [step, setStep] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId?.trim() || null)
  const [session, setSession] = useState<ImportSessionRow | null>(null)
  const [sessionErr, setSessionErr] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(Boolean(initialSessionId))

  const loadSession = useCallback(
    async (sid: string, jump: boolean) => {
      setSessionLoading(true)
      setSessionErr(null)
      try {
        const data = await importApi<{ session: ImportSessionRow }>(`/api/devy/import?${sessionQuery(sid)}`)
        setSession(data.session)
        if (jump) setStep(stepForStatus(data.session.status))
      } catch (e) {
        setSessionErr(errorText(e, tr))
      } finally {
        setSessionLoading(false)
      }
    },
    [tr],
  )

  useEffect(() => {
    if (initialSessionId?.trim()) void loadSession(initialSessionId.trim(), true)
    // Only the session the page was opened with; later sessions are loaded by the steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const adoptSession = useCallback(
    (row: ImportSessionRow) => {
      setSessionId(row.id)
      setSession(row)
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set('sessionId', row.id)
        window.history.replaceState(null, '', url.toString())
      }
    },
    [],
  )

  const refreshSession = useCallback(() => {
    if (sessionId) void loadSession(sessionId, false)
  }, [loadSession, sessionId])

  const goTo = (i: number) => setStep(Math.max(0, Math.min(STEP_KEYS.length - 1, i)))

  return (
    <div className="flex min-h-[70dvh] flex-col">
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {STEP_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => goTo(i)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                step === i ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/[0.04] text-white/45'
              }`}
              data-testid={`import-step-${i}`}
              aria-current={step === i ? 'step' : undefined}
            >
              {i + 1}. {tr(key)}
            </button>
          ))}
        </div>
        {sessionId ? (
          <p className="mt-1 text-[10px] text-white/35" data-testid="import-session-id">
            {tr('devyImport.sessionLabel', { id: sessionId })}
            {session ? ` · ${tr(`devyImport.status.${session.status}`)}` : ''}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {sessionLoading && !session ? (
          <Loading tr={tr} />
        ) : sessionErr && !session ? (
          <ErrorBox message={sessionErr} tr={tr} onRetry={sessionId ? () => void loadSession(sessionId, true) : undefined} />
        ) : step === 0 ? (
          <StepSource
            leagueId={leagueId}
            sessionId={sessionId}
            session={session}
            onSession={adoptSession}
            onMatched={() => {
              refreshSession()
              goTo(1)
            }}
            tr={tr}
          />
        ) : !sessionId ? (
          <NoSession tr={tr} onGoToStart={() => goTo(0)} />
        ) : step === 1 ? (
          <StepMatching sessionId={sessionId} merged={session?.status === 'merged'} tr={tr} />
        ) : step === 2 ? (
          <StepConflicts sessionId={sessionId} merged={session?.status === 'merged'} onDone={() => goTo(3)} tr={tr} />
        ) : step === 3 ? (
          <StepPreMerge
            sessionId={sessionId}
            merged={session?.status === 'merged'}
            onMerged={refreshSession}
            onGoTo={goTo}
            tr={tr}
          />
        ) : (
          <StepAudit leagueId={leagueId} sessionId={sessionId} tr={tr} />
        )}
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t border-white/[0.08] bg-[#040915] p-4">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => goTo(step - 1)}
          className="min-h-[44px] flex-1 rounded-xl border border-white/[0.1] py-2 text-[13px] font-semibold text-white/80 disabled:opacity-40"
          data-testid="import-back"
        >
          {tr('devyImport.back')}
        </button>
        <button
          type="button"
          disabled={step >= STEP_KEYS.length - 1 || !sessionId}
          onClick={() => goTo(step + 1)}
          className="min-h-[44px] flex-1 rounded-xl border border-cyan-500/40 bg-cyan-500/15 py-2 text-[13px] font-semibold text-cyan-100 disabled:opacity-40"
          data-testid="import-next"
        >
          {tr('devyImport.next')}
        </button>
      </div>
    </div>
  )
}

// ─── Step 1: sources ────────────────────────────────────────────────────

type SourceKind = 'sleeper' | 'csv'
const CLASSIFICATIONS = ['nfl_roster', 'devy_roster', 'history'] as const

function StepSource({
  leagueId,
  sessionId,
  session,
  onSession,
  onMatched,
  tr,
}: {
  leagueId: string
  sessionId: string | null
  session: ImportSessionRow | null
  onSession: (row: ImportSessionRow) => void
  onMatched: () => void
  tr: Tr
}) {
  const [sources, setSources] = useState<ImportSourceSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [kind, setKind] = useState<SourceKind>('sleeper')
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number]>('nfl_roster')
  const [externalLeagueId, setExternalLeagueId] = useState('')
  const [csvText, setCsvText] = useState('')
  const [adding, setAdding] = useState(false)
  const [lastAdded, setLastAdded] = useState<ImportSourceSummary | null>(null)
  const [matching, setMatching] = useState(false)
  const merged = session?.status === 'merged'

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setLoadErr(null)
    try {
      const data = await importApi<{ sources: ImportSourceSummary[] }>(`/api/devy/import/sources?${sessionQuery(sessionId)}`)
      setSources(data.sources)
    } catch (e) {
      setLoadErr(errorText(e, tr))
    } finally {
      setLoading(false)
    }
  }, [sessionId, tr])

  useEffect(() => {
    void load()
  }, [load])

  async function startSession() {
    setStarting(true)
    setActionErr(null)
    try {
      const data = await importApi<{ session: ImportSessionRow }>('/api/devy/import', { method: 'POST', body: { leagueId } })
      onSession(data.session)
      setSources([])
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setStarting(false)
    }
  }

  async function addSource() {
    if (!sessionId) return
    const body =
      kind === 'sleeper'
        ? { sessionId, sourceType: 'league_id_entry', platform: 'sleeper', classification, data: { leagueId: externalLeagueId.trim() } }
        : { sessionId, sourceType: 'csv_upload', platform: 'csv', classification, data: { csvText } }
    setAdding(true)
    setActionErr(null)
    setLastAdded(null)
    try {
      const data = await importApi<{ source: ImportSourceSummary }>('/api/devy/import/sources', { method: 'POST', body })
      setLastAdded(data.source)
      setSources(prev => [...(prev ?? []), data.source])
      setExternalLeagueId('')
      setCsvText('')
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setAdding(false)
    }
  }

  async function changeClassification(sourceId: string, next: string) {
    if (!sessionId) return
    setActionErr(null)
    try {
      const data = await importApi<{ source: ImportSourceSummary | null }>('/api/devy/import/sources', {
        method: 'PATCH',
        body: { sessionId, sourceId, classification: next },
      })
      if (data.source) setSources(prev => (prev ?? []).map(s => (s.id === sourceId ? data.source! : s)))
    } catch (e) {
      setActionErr(errorText(e, tr))
    }
  }

  async function runMatching() {
    if (!sessionId) return
    setMatching(true)
    setActionErr(null)
    try {
      await importApi('/api/devy/import/match', { method: 'POST', body: { sessionId, action: 'run_matching' } })
      onMatched()
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setMatching(false)
    }
  }

  const connected = (sources ?? []).filter(s => s.connectionStatus === 'connected')
  const canAdd = kind === 'sleeper' ? externalLeagueId.trim().length > 0 : csvText.trim().length > 0

  return (
    <div className="space-y-4 text-[13px] text-white/80" data-testid="import-step-source">
      <div>
        <h2 className="text-[18px] font-bold text-white">{tr('devyImport.source.title')}</h2>
        <p className="mt-1 text-[12px] text-white/45">{tr('devyImport.source.subtitle')}</p>
      </div>

      {!sessionId ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
          <p className="text-[12px] text-white/60">{tr('devyImport.source.startHint')}</p>
          <button
            type="button"
            disabled={starting}
            onClick={() => void startSession()}
            className="mt-3 min-h-[44px] w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-[13px] font-semibold text-cyan-100 disabled:opacity-50"
            data-testid="import-start-session"
          >
            {starting ? tr('devyImport.source.starting') : tr('devyImport.source.start')}
          </button>
          {actionErr ? <div className="mt-3"><ErrorBox message={actionErr} tr={tr} /></div> : null}
        </div>
      ) : (
        <>
          {merged ? (
            <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-[12px] text-emerald-100" data-testid="import-source-merged">
              {tr('devyImport.source.mergedNotice')}
            </p>
          ) : null}

          <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">{tr('devyImport.source.listTitle')}</h3>
            {loading && !sources ? (
              <div className="mt-2"><Loading tr={tr} /></div>
            ) : loadErr ? (
              <div className="mt-2"><ErrorBox message={loadErr} tr={tr} onRetry={() => void load()} /></div>
            ) : (sources ?? []).length === 0 ? (
              <p className="mt-2 text-[12px] text-white/50" data-testid="import-sources-empty">
                {tr('devyImport.source.empty')}
              </p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="import-sources-list">
                {(sources ?? []).map(s => (
                  <li key={s.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-3" data-testid={`import-source-${s.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {tr(`devyImport.platform.${s.sourcePlatform === 'sleeper' ? 'sleeper' : s.sourceType === 'csv_upload' ? 'csv' : 'other'}`)}
                      </span>
                      <span className={`text-[11px] font-semibold ${s.connectionStatus === 'connected' ? 'text-emerald-300' : s.connectionStatus === 'partial' ? 'text-amber-300' : 'text-red-300'}`}>
                        {tr(`devyImport.connection.${['connected', 'partial', 'failed'].includes(s.connectionStatus) ? s.connectionStatus : 'failed'}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/50">
                      {tr('devyImport.source.counts', { players: s.playerCount, managers: s.managerCount })}
                      {s.season ? ` · ${tr('devyImport.source.season', { season: s.season })}` : ''}
                    </p>
                    <label className="mt-2 block text-[11px] text-white/45">
                      {tr('devyImport.source.classification')}
                      <select
                        value={s.classification ?? 'nfl_roster'}
                        disabled={merged}
                        onChange={e => void changeClassification(s.id, e.target.value)}
                        className="mt-1 block min-h-[40px] w-full rounded-lg border border-white/[0.1] bg-black/30 px-2 text-[12px] text-white"
                      >
                        {CLASSIFICATIONS.map(c => (
                          <option key={c} value={c}>
                            {tr(`devyImport.classification.${c}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!merged ? (
            <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4" data-testid="import-add-source">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">{tr('devyImport.source.addTitle')}</h3>
              <div className="mt-2 flex gap-2" role="radiogroup">
                {(['sleeper', 'csv'] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={`min-h-[40px] flex-1 rounded-lg border px-3 text-[12px] font-semibold ${kind === k ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100' : 'border-white/[0.1] text-white/60'}`}
                    data-testid={`import-kind-${k}`}
                  >
                    {tr(`devyImport.source.kind.${k}`)}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-[11px] text-white/45">
                {tr('devyImport.source.classification')}
                <select
                  value={classification}
                  onChange={e => setClassification(e.target.value as (typeof CLASSIFICATIONS)[number])}
                  className="mt-1 block min-h-[40px] w-full rounded-lg border border-white/[0.1] bg-black/30 px-2 text-[12px] text-white"
                  data-testid="import-classification"
                >
                  {CLASSIFICATIONS.map(c => (
                    <option key={c} value={c}>
                      {tr(`devyImport.classification.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              {kind === 'sleeper' ? (
                <label className="mt-3 block text-[11px] text-white/45">
                  {tr('devyImport.source.sleeperLeagueId')}
                  <input
                    value={externalLeagueId}
                    onChange={e => setExternalLeagueId(e.target.value)}
                    inputMode="numeric"
                    className="mt-1 block min-h-[44px] w-full rounded-lg border border-white/[0.1] bg-black/30 px-3 text-[13px] text-white"
                    data-testid="import-sleeper-league-id"
                  />
                </label>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-white/45">{tr('devyImport.source.csvHint')}</p>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) void f.text().then(setCsvText)
                    }}
                    className="block w-full text-[12px] text-white/70"
                    data-testid="import-csv-file"
                  />
                  <textarea
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                    rows={5}
                    placeholder={tr('devyImport.source.csvPlaceholder')}
                    className="block w-full rounded-lg border border-white/[0.1] bg-black/30 px-3 py-2 font-mono text-[12px] text-white"
                    data-testid="import-csv-text"
                  />
                </div>
              )}
              <button
                type="button"
                disabled={!canAdd || adding}
                onClick={() => void addSource()}
                className="mt-3 min-h-[44px] w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-2 text-[13px] font-semibold text-cyan-100 disabled:opacity-40"
                data-testid="import-add-source-submit"
              >
                {adding ? tr('devyImport.source.adding') : tr('devyImport.source.add')}
              </button>
              {lastAdded ? (
                <p
                  className={`mt-2 text-[12px] ${lastAdded.connectionStatus === 'connected' ? 'text-emerald-200' : 'text-amber-200'}`}
                  data-testid="import-add-result"
                >
                  {tr(
                    lastAdded.connectionStatus === 'connected'
                      ? 'devyImport.source.added'
                      : lastAdded.connectionStatus === 'partial'
                        ? 'devyImport.source.addedPartial'
                        : 'devyImport.source.addFailed',
                    { players: lastAdded.playerCount },
                  )}
                </p>
              ) : null}
            </section>
          ) : null}

          {actionErr ? <ErrorBox message={actionErr} tr={tr} /> : null}

          {!merged ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
              <p className="text-[11px] text-white/45">{tr('devyImport.source.matchHint')}</p>
              <button
                type="button"
                disabled={connected.length === 0 || matching}
                onClick={() => void runMatching()}
                className="mt-3 min-h-[44px] w-full rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-[13px] font-semibold text-cyan-100 disabled:opacity-40"
                data-testid="import-run-matching"
              >
                {matching ? tr('devyImport.source.matching') : tr('devyImport.source.runMatching')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

// ─── Step 2: matching ───────────────────────────────────────────────────

const CONFIDENCE_CLASS: Record<string, string> = {
  exact: 'text-emerald-300',
  high: 'text-sky-300',
  medium: 'text-cyan-200',
  low: 'text-amber-300',
  unmatched: 'text-red-300',
}

function StepMatching({ sessionId, merged, tr }: { sessionId: string; merged: boolean; tr: Tr }) {
  const [data, setData] = useState<MatchPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [rejected, setRejected] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(25)
  const [suggestions, setSuggestions] = useState<Record<string, SuggestedMatch> | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [managerPick, setManagerPick] = useState<Record<string, string>>({})
  const { handleApiResponse } = useAfSubGate('commissioner_devy_scouting')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      setData(await importApi<MatchPayload>(`/api/devy/import/match?${sessionQuery(sessionId)}`))
    } catch (e) {
      setLoadErr(errorText(e, tr))
    } finally {
      setLoading(false)
    }
  }, [sessionId, tr])

  useEffect(() => {
    void load()
  }, [load])

  const replacePlayer = (row: PlayerMappingRow) =>
    setData(prev => (prev ? { ...prev, players: prev.players.map(p => (p.id === row.id ? row : p)) } : prev))
  const replaceManager = (row: ManagerMappingRow) =>
    setData(prev => (prev ? { ...prev, managers: prev.managers.map(m => (m.id === row.id ? row : m)) } : prev))

  async function patchPlayer(p: PlayerMappingRow, action: 'confirm' | 'reject', pick?: { id: string; name: string | null }) {
    const res = await importApi<{ playerMapping: PlayerMappingRow }>('/api/devy/import/mappings', {
      method: 'PATCH',
      body: {
        sessionId,
        mappingId: p.id,
        kind: 'player',
        action,
        ...(pick ? { internalPlayerId: pick.id, internalPlayerName: pick.name ?? undefined } : {}),
      },
    })
    replacePlayer(res.playerMapping)
    setRejected(prev => {
      const next = new Set(prev)
      if (action === 'reject') next.add(p.id)
      else next.delete(p.id)
      return next
    })
  }

  async function onPlayer(p: PlayerMappingRow, action: 'confirm' | 'reject', pick?: { id: string; name: string | null }) {
    setBusyId(p.id)
    setActionErr(null)
    try {
      await patchPlayer(p, action, pick)
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmAll(rows: PlayerMappingRow[]) {
    setActionErr(null)
    setBulk({ done: 0, total: rows.length })
    try {
      for (let i = 0; i < rows.length; i++) {
        await patchPlayer(rows[i]!, 'confirm')
        setBulk({ done: i + 1, total: rows.length })
      }
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setBulk(null)
    }
  }

  async function onManager(m: ManagerMappingRow, link: LeagueManagerOption | null) {
    setBusyId(m.id)
    setActionErr(null)
    try {
      const res = await importApi<{ managerMapping: ManagerMappingRow }>('/api/devy/import/mappings', {
        method: 'PATCH',
        body: {
          sessionId,
          mappingId: m.id,
          kind: 'manager',
          action: 'confirm',
          ...(link ? { internalUserId: link.userId, internalUsername: link.label } : {}),
        },
      })
      replaceManager(res.managerMapping)
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setBusyId(null)
    }
  }

  async function askChimmy() {
    setSuggesting(true)
    setActionErr(null)
    try {
      const r = await fetch('/api/devy/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'suggest_matches', sessionId }),
      })
      if (!(await handleApiResponse(r))) return
      if (!r.ok) throw new ImportApiError(r.status)
      const j = (await r.json()) as { suggestions?: SuggestedMatch[] }
      const map: Record<string, SuggestedMatch> = {}
      for (const s of j.suggestions ?? []) map[s.mappingId] = s
      setSuggestions(map)
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setSuggesting(false)
    }
  }

  async function rerun() {
    setRerunning(true)
    setActionErr(null)
    try {
      await importApi('/api/devy/import/match', { method: 'POST', body: { sessionId, action: 'run_matching' } })
      setRejected(new Set())
      setSuggestions(null)
      await load()
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setRerunning(false)
    }
  }

  if (loading && !data) return <Loading tr={tr} />
  if (loadErr && !data) return <ErrorBox message={loadErr} tr={tr} onRetry={() => void load()} />
  if (!data) return null

  if (data.players.length === 0 && data.managers.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4 text-[12px] text-white/60" data-testid="import-matching-empty">
        {tr('devyImport.matching.empty')}
      </div>
    )
  }

  const counts = countByConfidence(data.players)
  const ready = data.players.filter(isPlayerMergeable)
  const review = data.players.filter(p => !isPlayerMergeable(p))
  const confirmable = review.filter(p => p.internalPlayerId && !rejected.has(p.id))
  const leagueManagers = data.leagueManagers ?? []
  const locked = merged || Boolean(bulk)

  return (
    <div className="space-y-4 text-[13px] text-white/80" data-testid="import-step-matching">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="import-match-counts">
        {CONFIDENCE_ORDER.map(k => (
          <div key={k} className="rounded-lg border border-white/[0.06] bg-black/25 p-3 text-center">
            <p className={`text-[20px] font-bold ${CONFIDENCE_CLASS[k]}`} data-testid={`import-count-${k}`}>
              {counts[k] ?? 0}
            </p>
            <p className="text-[11px] uppercase text-white/45">{tr(`devyImport.confidence.${k}`)}</p>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-white/60" data-testid="import-ready-summary">
        {tr('devyImport.matching.readySummary', { ready: ready.length, review: review.length })}
      </p>

      {actionErr ? <ErrorBox message={actionErr} tr={tr} /> : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">{tr('devyImport.matching.reviewTitle')}</h3>
          <div className="flex flex-wrap gap-2">
            {!merged && confirmable.length > 0 ? (
              <button
                type="button"
                disabled={locked}
                onClick={() => void confirmAll(confirmable)}
                className="min-h-[36px] rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
                data-testid="import-confirm-all"
              >
                {bulk
                  ? tr('devyImport.matching.confirmingAll', { done: bulk.done, total: bulk.total })
                  : tr('devyImport.matching.confirmAll', { count: confirmable.length })}
              </button>
            ) : null}
            {!merged && review.some(p => !p.internalPlayerId) ? (
              <button
                type="button"
                disabled={suggesting || locked}
                onClick={() => void askChimmy()}
                className="min-h-[36px] rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 text-[11px] font-semibold text-cyan-100 disabled:opacity-40"
                data-testid="import-ask-chimmy"
              >
                {suggesting ? tr('devyImport.matching.chimmyBusy') : tr('devyImport.matching.askChimmy')}
              </button>
            ) : null}
          </div>
        </div>
        {review.length === 0 ? (
          <p className="text-[12px] text-emerald-200/80" data-testid="import-review-empty">
            {tr('devyImport.matching.reviewEmpty')}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="import-review-list">
            {review.slice(0, shown).map(p => {
              const s = suggestions?.[p.id]
              const isRejected = rejected.has(p.id)
              const detail = [p.externalPosition, p.externalTeam ?? p.externalSchool].filter(Boolean).join(' · ')
              return (
                <li key={p.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-3" data-testid={`import-player-${p.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      {p.externalName}
                      {detail ? <span className="ml-1 text-[11px] font-normal text-white/45">{detail}</span> : null}
                    </span>
                    <span className={`text-[11px] font-semibold ${CONFIDENCE_CLASS[p.internalPlayerId ? p.matchConfidence : 'unmatched'] ?? 'text-white/50'}`}>
                      {tr(`devyImport.confidence.${p.internalPlayerId && p.matchConfidence in CONFIDENCE_CLASS ? p.matchConfidence : 'unmatched'}`)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-white/60">
                    {p.internalPlayerId
                      ? tr('devyImport.matching.matchedTo', { name: p.internalPlayerName ?? p.internalPlayerId })
                      : tr('devyImport.matching.noMatch')}
                  </p>
                  {isRejected ? (
                    <p className="mt-1 text-[11px] text-amber-200/80" data-testid={`import-player-rejected-${p.id}`}>
                      {tr('devyImport.matching.leftOut')}
                    </p>
                  ) : null}
                  {s ? (
                    <p className="mt-1 text-[11px] text-cyan-200/80" data-testid={`import-suggestion-${p.id}`}>
                      {s.suggestedPlayerId && s.suggestedName
                        ? tr('devyImport.matching.chimmySuggests', { name: s.suggestedName, confidence: Math.round(s.confidence) })
                        : tr('devyImport.matching.chimmyNoMatch')}
                    </p>
                  ) : null}
                  {!merged ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.internalPlayerId ? (
                        <button
                          type="button"
                          disabled={busyId === p.id || locked}
                          onClick={() => void onPlayer(p, 'confirm')}
                          className="min-h-[36px] rounded-lg border border-emerald-500/35 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
                          data-testid={`import-player-confirm-${p.id}`}
                        >
                          {tr('devyImport.matching.confirm')}
                        </button>
                      ) : null}
                      {s?.suggestedPlayerId ? (
                        <button
                          type="button"
                          disabled={busyId === p.id || locked}
                          onClick={() => void onPlayer(p, 'confirm', { id: s.suggestedPlayerId!, name: s.suggestedName })}
                          className="min-h-[36px] rounded-lg border border-cyan-500/35 px-3 text-[11px] font-semibold text-cyan-100 disabled:opacity-40"
                          data-testid={`import-player-use-suggestion-${p.id}`}
                        >
                          {tr('devyImport.matching.useSuggestion')}
                        </button>
                      ) : null}
                      {!isRejected ? (
                        <button
                          type="button"
                          disabled={busyId === p.id || locked}
                          onClick={() => void onPlayer(p, 'reject')}
                          className="min-h-[36px] rounded-lg border border-white/[0.12] px-3 text-[11px] font-semibold text-white/70 disabled:opacity-40"
                          data-testid={`import-player-reject-${p.id}`}
                        >
                          {tr('devyImport.matching.leaveOut')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {review.length > shown ? (
          <button
            type="button"
            onClick={() => setShown(n => n + 50)}
            className="min-h-[40px] text-[12px] font-semibold text-cyan-200 underline"
            data-testid="import-review-more"
          >
            {tr('devyImport.matching.showMore', { count: review.length - shown })}
          </button>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">{tr('devyImport.matching.managersTitle')}</h3>
        {data.managers.length === 0 ? (
          <p className="text-[12px] text-white/50" data-testid="import-managers-empty">
            {tr('devyImport.matching.managersEmpty')}
          </p>
        ) : (
          <ul className="space-y-2" data-testid="import-managers-list">
            {data.managers.map(m => {
              const blocking = m.requiresReview && !m.internalUserId
              const pick = managerPick[m.id] ?? m.internalUserId ?? ''
              const option = leagueManagers.find(o => o.userId === pick) ?? null
              return (
                <li key={m.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-3" data-testid={`import-manager-${m.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">{m.externalDisplayName || m.externalUsername}</span>
                    <span className={`text-[11px] font-semibold ${m.internalUserId ? 'text-emerald-300' : blocking ? 'text-red-300' : 'text-white/50'}`}>
                      {m.internalUserId
                        ? tr('devyImport.matching.managerLinked', { name: m.internalUsername ?? m.internalUserId })
                        : blocking
                          ? tr('devyImport.matching.managerNeedsLink')
                          : tr('devyImport.matching.managerSkipped')}
                    </span>
                  </div>
                  {!merged ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <select
                        value={pick}
                        onChange={e => setManagerPick(prev => ({ ...prev, [m.id]: e.target.value }))}
                        className="min-h-[40px] flex-1 rounded-lg border border-white/[0.1] bg-black/30 px-2 text-[12px] text-white"
                        aria-label={tr('devyImport.matching.managerSelect')}
                        data-testid={`import-manager-select-${m.id}`}
                      >
                        <option value="">{tr('devyImport.matching.managerSelect')}</option>
                        {leagueManagers.map(o => (
                          <option key={o.userId} value={o.userId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!option || busyId === m.id || locked || option.userId === m.internalUserId}
                        onClick={() => void onManager(m, option)}
                        className="min-h-[40px] rounded-lg border border-emerald-500/35 px-3 text-[11px] font-semibold text-emerald-100 disabled:opacity-40"
                        data-testid={`import-manager-link-${m.id}`}
                      >
                        {tr('devyImport.matching.managerLink')}
                      </button>
                      {blocking ? (
                        <button
                          type="button"
                          disabled={busyId === m.id || locked}
                          onClick={() => void onManager(m, null)}
                          className="min-h-[40px] rounded-lg border border-white/[0.12] px-3 text-[11px] font-semibold text-white/70 disabled:opacity-40"
                          data-testid={`import-manager-skip-${m.id}`}
                        >
                          {tr('devyImport.matching.managerSkip')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {leagueManagers.length === 0 && data.managers.length > 0 ? (
          <p className="text-[11px] text-amber-200/80" data-testid="import-no-league-managers">
            {tr('devyImport.matching.noLeagueManagers')}
          </p>
        ) : null}
      </section>

      {!merged ? (
        <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
          <p className="mb-2 text-[11px] text-white/45">{tr('devyImport.matching.rerunHint')}</p>
          <ConfirmButton
            label={tr('devyImport.matching.rerun')}
            confirmLabel={tr('devyImport.matching.rerunConfirm')}
            busyLabel={tr('devyImport.matching.rerunning')}
            busy={rerunning}
            disabled={locked}
            onConfirm={() => void rerun()}
            testId="import-rerun-matching"
            tone="neutral"
            tr={tr}
          />
        </section>
      ) : null}
    </div>
  )
}

// ─── Step 3: conflicts ──────────────────────────────────────────────────

function StepConflicts({ sessionId, merged, onDone, tr }: { sessionId: string; merged: boolean; onDone: () => void; tr: Tr }) {
  const [conflicts, setConflicts] = useState<MergeConflictRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resolvedCount, setResolvedCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const data = await importApi<{ conflicts: MergeConflictRow[] }>(`/api/devy/import/conflicts?${sessionQuery(sessionId)}`)
      setConflicts(data.conflicts)
    } catch (e) {
      setLoadErr(errorText(e, tr))
    } finally {
      setLoading(false)
    }
  }, [sessionId, tr])

  useEffect(() => {
    void load()
  }, [load])

  async function save(c: MergeConflictRow) {
    const resolution = choice[c.id]
    if (!resolution) return
    setBusyId(c.id)
    setActionErr(null)
    try {
      await importApi('/api/devy/import/conflicts', {
        method: 'PATCH',
        body: { conflictId: c.id, resolution, note: notes[c.id]?.trim() || undefined },
      })
      setConflicts(prev => (prev ?? []).filter(x => x.id !== c.id))
      setResolvedCount(n => n + 1)
    } catch (e) {
      setActionErr(errorText(e, tr))
    } finally {
      setBusyId(null)
    }
  }

  const types = useMemo(() => [...new Set((conflicts ?? []).map(c => c.conflictType))], [conflicts])

  if (loading && !conflicts) return <Loading tr={tr} />
  if (loadErr && !conflicts) return <ErrorBox message={loadErr} tr={tr} onRetry={() => void load()} />
  if (!conflicts) return null

  if (conflicts.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-[12px] text-emerald-100" data-testid="import-conflicts-empty">
        <p>{resolvedCount > 0 ? tr('devyImport.conflicts.allResolved', { count: resolvedCount }) : tr('devyImport.conflicts.none')}</p>
        {!merged ? (
          <button type="button" onClick={onDone} className="min-h-[44px] font-semibold text-emerald-50 underline" data-testid="import-conflicts-continue">
            {tr('devyImport.conflicts.continue')}
          </button>
        ) : null}
      </div>
    )
  }

  const visible = filter === 'all' ? conflicts : conflicts.filter(c => c.conflictType === filter)

  return (
    <div className="space-y-3 text-[13px] text-white/80" data-testid="import-step-conflicts">
      <p className="text-[12px] text-white/60" data-testid="import-conflicts-remaining">
        {tr('devyImport.conflicts.remaining', { count: conflicts.length })}
      </p>
      <div className="flex flex-wrap gap-2">
        {['all', ...types].map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-[32px] rounded-full border px-3 text-[11px] ${filter === f ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-100' : 'border-white/[0.08] text-white/55'}`}
            data-testid={`import-conflict-filter-${f}`}
          >
            {f === 'all' ? tr('devyImport.conflicts.filterAll') : tr(`devyImport.conflictType.${conflictTypeKey(f)}`)}
          </button>
        ))}
      </div>
      {actionErr ? <ErrorBox message={actionErr} tr={tr} /> : null}
      <ul className="space-y-3">
        {visible.map(c => {
          const key = conflictTypeKey(c.conflictType)
          return (
            <li key={c.id} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4" data-testid={`import-conflict-${c.id}`}>
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-100">
                {tr(`devyImport.conflictType.${key}`)}
              </span>
              <p className="mt-2 text-[12px] text-white/75">{tr(`devyImport.conflictHint.${key}`)}</p>
              <p className="mt-1 text-[11px] text-white/40">{c.description}</p>
              {!merged ? (
                <>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row" role="radiogroup">
                    {(['commissioner_resolved', 'skipped'] as const).map(r => (
                      <label key={r} className="flex min-h-[40px] items-center gap-2 text-[12px] text-white/80">
                        <input
                          type="radio"
                          name={`conflict-${c.id}`}
                          checked={choice[c.id] === r}
                          onChange={() => setChoice(prev => ({ ...prev, [c.id]: r }))}
                          data-testid={`import-conflict-${c.id}-${r}`}
                        />
                        {tr(`devyImport.resolution.${r}`)}
                      </label>
                    ))}
                  </div>
                  <textarea
                    value={notes[c.id] ?? ''}
                    onChange={e => setNotes(prev => ({ ...prev, [c.id]: e.target.value }))}
                    rows={2}
                    placeholder={tr('devyImport.conflicts.notePlaceholder')}
                    className="mt-2 block w-full rounded-lg border border-white/[0.1] bg-black/30 px-3 py-2 text-[12px] text-white"
                    data-testid={`import-conflict-note-${c.id}`}
                  />
                  <button
                    type="button"
                    disabled={!choice[c.id] || busyId === c.id}
                    onClick={() => void save(c)}
                    className="mt-2 min-h-[40px] rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-4 text-[12px] font-semibold text-cyan-100 disabled:opacity-40"
                    data-testid={`import-conflict-save-${c.id}`}
                  >
                    {busyId === c.id ? tr('devyImport.saving') : tr('devyImport.conflicts.save')}
                  </button>
                </>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Step 4: pre-merge review ───────────────────────────────────────────

type MergeResult = { ok: boolean; playersWritten: number; seasonsWritten: number; picksWritten: number; errors: string[] }

function StepPreMerge({
  sessionId,
  merged,
  onMerged,
  onGoTo,
  tr,
}: {
  sessionId: string
  merged: boolean
  onMerged: () => void
  onGoTo: (step: number) => void
  tr: Tr
}) {
  const [match, setMatch] = useState<MatchPayload | null>(null)
  const [sources, setSources] = useState<ImportSourceSummary[] | null>(null)
  const [pending, setPending] = useState<MergeConflictRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [execErr, setExecErr] = useState<string | null>(null)
  const [result, setResult] = useState<MergeResult | null>(null)
  const [mergedNow, setMergedNow] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const [m, s, c] = await Promise.all([
        importApi<MatchPayload>(`/api/devy/import/match?${sessionQuery(sessionId)}`),
        importApi<{ sources: ImportSourceSummary[] }>(`/api/devy/import/sources?${sessionQuery(sessionId)}`),
        importApi<{ conflicts: MergeConflictRow[] }>(`/api/devy/import/conflicts?${sessionQuery(sessionId)}`),
      ])
      setMatch(m)
      setSources(s.sources)
      setPending(c.conflicts)
    } catch (e) {
      setLoadErr(errorText(e, tr))
    } finally {
      setLoading(false)
    }
  }, [sessionId, tr])

  useEffect(() => {
    void load()
  }, [load])

  async function execute() {
    setExecuting(true)
    setExecErr(null)
    try {
      const data = await importApi<{ result: MergeResult }>('/api/devy/import/execute', { method: 'POST', body: { sessionId } })
      // The engine marks the session merged once it is past its pre-checks, even when it skipped
      // some players; an early refusal leaves it unmerged. Ask the session rather than guessing
      // from the counts.
      const after = await importApi<{ session: ImportSessionRow }>(`/api/devy/import?${sessionQuery(sessionId)}`).catch(() => null)
      setMergedNow(after?.session.status === 'merged')
      setResult(data.result)
      onMerged()
    } catch (e) {
      setExecErr(errorText(e, tr))
    } finally {
      setExecuting(false)
    }
  }

  if (loading && !match) return <Loading tr={tr} />
  if (loadErr && !match) return <ErrorBox message={loadErr} tr={tr} onRetry={() => void load()} />
  if (!match || !sources || !pending) return null

  // The conflicts route lists only pending rows; the match route lists all of them.
  const preview = buildMergePreview(match.players, match.managers, pending, sources)
  const total = preview.nflPlayers + preview.devyPlayers

  return (
    <div className="space-y-4 text-[13px] text-white/80" data-testid="import-step-premerge">
      {merged && !result ? (
        <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-[12px] text-emerald-100" data-testid="import-premerge-merged">
          {tr('devyImport.preMerge.alreadyMerged')}
        </p>
      ) : null}
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <p className="font-semibold text-white">{tr('devyImport.preMerge.title')}</p>
        <ul className="mt-2 space-y-1 text-[12px] text-white/70" data-testid="import-premerge-summary">
          <li data-testid="import-premerge-nfl">{tr('devyImport.preMerge.nflPlayers', { count: preview.nflPlayers })}</li>
          <li data-testid="import-premerge-devy">{tr('devyImport.preMerge.devyPlayers', { count: preview.devyPlayers })}</li>
          <li data-testid="import-premerge-seasons">
            {preview.historySeasons.length > 0
              ? tr('devyImport.preMerge.seasons', { count: preview.historySeasons.length, seasons: preview.historySeasons.join(', ') })
              : tr('devyImport.preMerge.noSeasons')}
          </li>
          <li data-testid="import-premerge-skipped">
            {tr('devyImport.preMerge.skipped', { count: preview.skippedPlayers, confirm: preview.needsConfirmation, unmatched: preview.unmatchedPlayers })}
          </li>
          <li>{tr('devyImport.preMerge.managers', { linked: preview.managersLinked, unlinked: preview.managersUnlinked })}</li>
        </ul>
        <p className="mt-3 text-[11px] text-white/45">{tr('devyImport.preMerge.whatChanges')}</p>
      </div>

      {preview.pendingConflicts > 0 || preview.blockingManagers > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-[12px] text-amber-100" data-testid="import-premerge-blockers">
          <p className="font-semibold">{tr('devyImport.preMerge.blockedTitle')}</p>
          {preview.pendingConflicts > 0 ? (
            <button type="button" onClick={() => onGoTo(2)} className="block min-h-[36px] text-left underline">
              {tr('devyImport.preMerge.blockedConflicts', { count: preview.pendingConflicts })}
            </button>
          ) : null}
          {preview.blockingManagers > 0 ? (
            <button type="button" onClick={() => onGoTo(1)} className="block min-h-[36px] text-left underline">
              {tr('devyImport.preMerge.blockedManagers', { count: preview.blockingManagers })}
            </button>
          ) : null}
        </div>
      ) : null}

      {!merged && !result ? (
        <>
          {!preview.canMerge && preview.pendingConflicts === 0 && preview.blockingManagers === 0 ? (
            <p className="text-[12px] text-white/55" data-testid="import-premerge-nothing">
              {tr('devyImport.preMerge.nothingToMerge')}
            </p>
          ) : null}
          <ConfirmButton
            label={tr('devyImport.preMerge.merge')}
            confirmLabel={tr('devyImport.preMerge.mergeConfirm', { count: total })}
            busyLabel={tr('devyImport.preMerge.merging')}
            busy={executing}
            disabled={!preview.canMerge}
            onConfirm={() => void execute()}
            testId="import-execute"
            tr={tr}
          />
        </>
      ) : null}

      {execErr ? <ErrorBox message={execErr} tr={tr} /> : null}

      {result ? (
        <div
          className={`rounded-xl border p-4 text-[12px] ${result.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100' : 'border-amber-500/30 bg-amber-500/5 text-amber-100'}`}
          data-testid="import-execute-result"
        >
          <p className="font-semibold">
            {result.ok
              ? tr('devyImport.preMerge.resultOk', { players: result.playersWritten, seasons: result.seasonsWritten })
              : mergedNow
                ? tr('devyImport.preMerge.resultPartial', { players: result.playersWritten, seasons: result.seasonsWritten })
                : tr('devyImport.preMerge.resultRefused')}
          </p>
          {result.errors.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4" data-testid="import-execute-errors">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>{localizeMergeMessage(e, tr)}</li>
              ))}
              {result.errors.length > 20 ? <li>{tr('devyImport.preMerge.moreErrors', { count: result.errors.length - 20 })}</li> : null}
            </ul>
          ) : null}
          {!result.ok && !mergedNow ? (
            <button
              type="button"
              onClick={() => {
                setResult(null)
                void load()
              }}
              className="mt-2 min-h-[36px] font-semibold underline"
            >
              {tr('devyImport.retry')}
            </button>
          ) : (
            <button type="button" onClick={() => onGoTo(4)} className="mt-2 min-h-[36px] font-semibold underline">
              {tr('devyImport.preMerge.viewAudit')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ─── Step 5: audit ──────────────────────────────────────────────────────

type AuditSession = { id: string; status: string; mergedAt: string | null; summary?: unknown }

function StepAudit({ leagueId, sessionId, tr }: { leagueId: string; sessionId: string; tr: Tr }) {
  const [audit, setAudit] = useState<ImportAuditSummary | null>(null)
  const [session, setSession] = useState<AuditSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryErr, setSummaryErr] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_devy_scouting')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const data = await importApi<{ audit: ImportAuditSummary; session: AuditSession }>(`/api/devy/import/audit?${sessionQuery(sessionId)}`)
      setAudit(data.audit)
      setSession(data.session)
    } catch (e) {
      setLoadErr(errorText(e, tr))
    } finally {
      setLoading(false)
    }
  }, [sessionId, tr])

  useEffect(() => {
    void load()
  }, [load])

  function download() {
    if (!audit || !session) return
    const text = formatImportAuditPlainText(audit, session)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `devy-import-audit-${sessionId.slice(0, 12)}.txt`
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runSummary() {
    setSummaryBusy(true)
    setSummaryErr(null)
    setSummaryText(null)
    try {
      const r = await fetch('/api/devy/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'import_summary', sessionId }),
      })
      if (!(await handleApiResponse(r))) return
      if (!r.ok) throw new ImportApiError(r.status)
      const data = (await r.json()) as { narrative: string; auditConfidence: string }
      setSummaryText(data.narrative)
    } catch (e) {
      setSummaryErr(errorText(e, tr))
    } finally {
      setSummaryBusy(false)
    }
  }

  if (loading && !audit) return <Loading tr={tr} />
  if (loadErr && !audit) return <ErrorBox message={loadErr} tr={tr} onRetry={() => void load()} />
  if (!audit || !session) return null

  const merged = session.status === 'merged'

  return (
    <div className="space-y-4 text-[13px] text-white/80" data-testid="import-step-audit">
      {merged ? (
        <p className="text-[16px] font-bold text-emerald-200" data-testid="import-audit-merged">
          {tr('devyImport.audit.mergedTitle')}
        </p>
      ) : (
        <p className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-3 text-[12px] text-white/60" data-testid="import-audit-not-merged">
          {tr('devyImport.audit.notMerged')}
        </p>
      )}
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <ul className="space-y-1 text-[12px] text-white/70" data-testid="import-audit-summary">
          <li>{tr('devyImport.audit.confidence', { level: tr(`devyImport.audit.level.${audit.dataConfidenceScore}`) })}</li>
          <li data-testid="import-audit-players">{tr('devyImport.audit.players', { count: audit.playersImported })}</li>
          <li>{tr('devyImport.audit.conflicts', { resolved: audit.conflictsResolved, pending: audit.conflictsPending })}</li>
          <li>{tr('devyImport.audit.managers', { count: audit.managersMatched })}</li>
          <li>{tr('devyImport.audit.seasons', { count: audit.historySeasonsImported })}</li>
          <li>{tr('devyImport.audit.picks', { count: audit.picksImported })}</li>
        </ul>
        {audit.unmatchedPlayers.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase text-white/55">
              {tr('devyImport.audit.unmatchedTitle', { count: audit.unmatchedPlayers.length })}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-white/55" data-testid="import-audit-unmatched">
              {audit.unmatchedPlayers.slice(0, 20).map(p => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {audit.managersUnmatched.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase text-white/55">
              {tr('devyImport.audit.managersUnmatchedTitle', { count: audit.managersUnmatched.length })}
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-white/55">
              {audit.managersUnmatched.slice(0, 20).map(m => (
                <li key={m.id}>{m.label}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {audit.notes.length > 0 ? (
          <ul className="mt-3 list-disc space-y-0.5 pl-4 text-[11px] text-amber-200/80" data-testid="import-audit-notes">
            {audit.notes.map((n, i) => (
              <li key={i}>{localizeMergeMessage(n, tr)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={download}
          className="min-h-[44px] rounded-xl border border-white/[0.1] px-4 py-3 text-[12px] font-semibold text-white/90"
          data-testid="import-audit-download"
        >
          {tr('devyImport.audit.download')}
        </button>
        <button
          type="button"
          disabled={summaryBusy}
          onClick={() => void runSummary()}
          className="min-h-[44px] rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-3 text-[12px] font-semibold text-violet-100 disabled:opacity-50"
          data-testid="import-chimmy-summary"
        >
          {summaryBusy ? tr('devyImport.audit.summaryBusy') : tr('devyImport.audit.summary')}
        </button>
        <a
          href={`/league/${leagueId}`}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-3 text-[12px] font-semibold text-cyan-100"
          data-testid="import-audit-view-league"
        >
          {tr('devyImport.audit.viewLeague')}
        </a>
      </div>
      <p className="text-[11px] text-white/40">{tr('devyImport.audit.downloadNote')}</p>
      {summaryErr ? <ErrorBox message={summaryErr} tr={tr} /> : null}
      {summaryText ? (
        <div className="whitespace-pre-wrap rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 text-[12px] text-white/80" data-testid="import-chimmy-summary-text">
          {summaryText}
        </div>
      ) : null}
    </div>
  )
}
