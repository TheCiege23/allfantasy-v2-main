'use client'

/**
 * Shared scoring (2026-11-16): use this league's saved scoring in the commissioner's other leagues of the same sport.
 *
 * Lists each league with whether it can take the change now, as the server decides it
 * (`/api/commissioner/leagues/[leagueId]/shared-scoring`, lib/league/sharedScoring.ts). Every league is saved through
 * its own scoring save, so a locked league, a league mid-draft, or a format that keeps its own scoring is reported, not
 * changed. A league already in season is changed only after the commissioner confirms it here, the same question its
 * own scoring tab asks.
 */
import { useCallback, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Status = 'ready' | 'matches' | 'mid_season' | 'locked' | 'refused' | 'incompatible'
type Incompatibility = 'imported' | 'tournament' | 'survivor_guillotine' | 'past_season' | 'devy' | 'category' | 'carried_over'
type Outcome =
  | 'saved'
  | 'not_found'
  | 'forbidden'
  | 'locked'
  | 'wrong_sport'
  | 'incompatible'
  | 'needs_confirmation'
  | 'refused'
  | 'premium_required'

type View = {
  source: { id: string; name: string; sport: string; presetKey: string; customTable: boolean; needsPremium: boolean }
  leagues: Array<{ id: string; name: string; status: Status; incompatibility: Incompatibility | null }>
  hasPremium: boolean
}
type Result = { leagueId: string; name: string; outcome: Outcome; incompatibility?: Incompatibility; message: string | null }

const SELECTABLE: ReadonlySet<Status> = new Set(['ready', 'mid_season'])

export function SharedScoringCard({ leagueId }: { leagueId: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[] | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/shared-scoring`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as Partial<View> & { error?: string }
      if (!res.ok || !data.source || !data.leagues) {
        setView(null)
        setUnavailable(data.error ?? t('sharedScoring.loadFailed'))
        return
      }
      setUnavailable(null)
      setView({ source: data.source, leagues: data.leagues, hasPremium: data.hasPremium !== false })
      setPicked(new Set())
    } catch {
      setUnavailable(t('sharedScoring.loadFailed'))
    }
  }, [leagueId, t])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    setResults(null)
    if (next) void load()
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const statusLabel = (status: Status, why: Incompatibility | null): string =>
    status === 'incompatible' && why ? t(`sharedScoring.why.${why}`) : t(`sharedScoring.status.${status}`)

  const outcomeLabel = (r: Result): string => {
    if (r.outcome === 'incompatible' && r.incompatibility) return t(`sharedScoring.why.${r.incompatibility}`)
    return t(`sharedScoring.outcome.${r.outcome}`)
  }

  const inSeasonPicked = view ? view.leagues.filter((l) => picked.has(l.id) && l.status === 'mid_season').length : 0
  const blockedByPremium = Boolean(view?.source.needsPremium && !view.hasPremium)

  const apply = async () => {
    if (!view || picked.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/shared-scoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // In-season leagues are only in the request because the commissioner ticked them after reading the notice.
        body: JSON.stringify({ leagueIds: [...picked], confirmMidSeasonChange: inSeasonPicked > 0 }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; results?: Result[] }
      if (!res.ok || !data.results) {
        setError(data.error ?? t('sharedScoring.applyFailed'))
        return
      }
      setResults(data.results)
      await load()
    } catch {
      setError(t('sharedScoring.applyFailed'))
    } finally {
      setBusy(false)
    }
  }

  const button = 'rounded-lg px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide border border-white/10 disabled:opacity-50'
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" data-testid="shared-scoring-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-white">{t('sharedScoring.title')}</p>
          <p className="text-[11px] text-white/50">{t('sharedScoring.help')}</p>
        </div>
        <button
          type="button"
          data-testid="shared-scoring-toggle"
          onClick={toggleOpen}
          aria-expanded={open}
          className={`shrink-0 bg-[#1a2744] text-white ${button}`}
        >
          {open ? t('sharedScoring.close') : t('sharedScoring.open')}
        </button>
      </div>

      {open && unavailable ? <p className="text-[11px] text-white/55" data-testid="shared-scoring-unavailable">{unavailable}</p> : null}

      {open && view ? (
        <div className="space-y-3">
          {view.leagues.length === 0 ? (
            <p className="text-[11px] text-white/55" data-testid="shared-scoring-none">{t('sharedScoring.none')}</p>
          ) : (
            <ul className="space-y-1.5" data-testid="shared-scoring-leagues">
              {view.leagues.map((l) => {
                const selectable = SELECTABLE.has(l.status)
                return (
                  <li key={l.id} className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={l.name}
                      data-testid={`shared-scoring-pick-${l.id}`}
                      disabled={!selectable || busy}
                      checked={picked.has(l.id)}
                      onChange={() => toggle(l.id)}
                      className="h-4 w-4 accent-cyan-500 disabled:opacity-40"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-white/85">{l.name}</p>
                      {l.status !== 'ready' ? (
                        <p className={`text-[11px] ${l.status === 'mid_season' ? 'text-amber-300/80' : 'text-white/45'}`}>
                          {statusLabel(l.status, l.incompatibility)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {view.source.customTable ? <p className="text-[11px] text-white/45">{t('sharedScoring.customTable')}</p> : null}
          {blockedByPremium ? (
            <p className="text-[11px] text-amber-300/80" data-testid="shared-scoring-premium">{t('sharedScoring.premium')}</p>
          ) : null}
          {inSeasonPicked > 0 ? (
            <p className="text-[11px] text-amber-300/80" data-testid="shared-scoring-in-season">
              {t('sharedScoring.inSeasonNotice').replace('{{n}}', String(inSeasonPicked))}
            </p>
          ) : null}

          {view.leagues.some((l) => SELECTABLE.has(l.status)) ? (
            <button
              type="button"
              data-testid="shared-scoring-apply"
              disabled={busy || picked.size === 0 || blockedByPremium}
              onClick={() => void apply()}
              className={`w-full bg-cyan-600/30 text-cyan-50 ${button}`}
            >
              {busy
                ? t('sharedScoring.applying')
                : (inSeasonPicked > 0 ? t('sharedScoring.applyConfirm') : t('sharedScoring.apply')).replace('{{n}}', String(picked.size))}
            </button>
          ) : null}

          {error ? (
            <p className="text-[11px] text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          {results ? (
            <ul className="space-y-1" data-testid="shared-scoring-results">
              {results.map((r) => (
                <li key={r.leagueId} className="text-[11px]">
                  <span className="text-white/80">{r.name}</span>
                  <span className={r.outcome === 'saved' ? ' text-emerald-300' : ' text-amber-300/80'}> — {outcomeLabel(r)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
