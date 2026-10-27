'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PollDraft } from './AttachmentPreview'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { predictionCopy } from '@/lib/league-chat/predictionCopy'

/** A poll takes 2 to 6 answers. */
export const POLL_MAX_OPTIONS = 6

const DURATIONS: Array<{ label: string; ms: number }> = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '12h', ms: 12 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '3d', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
]

type PollComposerProps = {
  initial?: PollDraft | null
  onCreatePoll: (poll: PollDraft) => void
  onCancel: () => void
  /** Offer "No deadline" — a poll that stays open until its author or a commissioner closes it. */
  allowNoDeadline?: boolean
  /** League chat: offer "Predict a matchup" (posted straight to the server, not through the draft). */
  predictions?: { leagueId: string } | null
  onPredictionPosted?: () => void
}

type PredictableMatchup = {
  id: string
  week: number
  home: { name: string }
  away: { name: string }
  pollMessageId: string | null
}

export function PollComposer({
  initial,
  onCreatePoll,
  onCancel,
  allowNoDeadline = false,
  predictions = null,
  onPredictionPosted,
}: PollComposerProps) {
  const { language } = useOptionalLanguage()
  const t = (english: string) => predictionCopy(english, language)
  const [mode, setMode] = useState<'question' | 'prediction'>('question')
  const [resultsVisibility, setResultsVisibility] = useState<'live' | 'after_close'>(
    initial?.resultsVisibility ?? 'live',
  )
  const defaultClose = useMemo(() => new Date(Date.now() + 24 * 60 * 60 * 1000), [])
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [options, setOptions] = useState<string[]>(initial?.options?.length ? initial.options : ['', ''])
  const [allowMultiple, setAllowMultiple] = useState(initial?.allowMultiple ?? false)
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false)
  const [closeAt, setCloseAt] = useState<Date | null>(initial ? initial.closeAt : defaultClose)
  const [activeDur, setActiveDur] = useState(initial && initial.closeAt === null ? 'none' : '24h')

  const applyDuration = (label: string, ms: number | null) => {
    setActiveDur(label)
    setCloseAt(ms == null ? null : new Date(Date.now() + ms))
  }

  /*
   * Which matchups can be predicted. Asked once, and only in a league chat; an imported league or a
   * week with every game started answers with none, and the tab says so instead of vanishing.
   */
  const [matchups, setMatchups] = useState<PredictableMatchup[] | null>(null)
  const [native, setNative] = useState<boolean | null>(null)
  const [posting, setPosting] = useState<string | null>(null)
  const [predictError, setPredictError] = useState<string | null>(null)
  useEffect(() => {
    if (!predictions?.leagueId) return
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(predictions.leagueId)}/predictions`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { native?: boolean; matchups?: PredictableMatchup[] } | null) => {
        if (cancelled) return
        setNative(data?.native === true)
        setMatchups(Array.isArray(data?.matchups) ? data!.matchups! : [])
      })
      .catch(() => {
        if (!cancelled) setMatchups([])
      })
    return () => {
      cancelled = true
    }
  }, [predictions?.leagueId])

  const postPrediction = async (matchupId: string) => {
    if (!predictions?.leagueId || posting) return
    setPosting(matchupId)
    setPredictError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(predictions.leagueId)}/predictions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchupId, resultsVisibility }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || t('Could not post the prediction.'))
      onPredictionPosted?.()
    } catch (e) {
      setPredictError(e instanceof Error ? e.message : t('Could not post the prediction.'))
    } finally {
      setPosting(null)
    }
  }

  const submit = () => {
    const q = question.trim()
    const opts = options.map((o) => o.trim()).filter(Boolean)
    if (!q || opts.length < 2) return
    onCreatePoll({
      question: q,
      options: opts,
      closeAt,
      allowMultiple,
      anonymous,
      resultsVisibility,
    })
  }

  const resultsToggle = (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t('Show results')}>
      <span className="text-[11px] text-white/35">{t('Show results')}:</span>
      {(['live', 'after_close'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={resultsVisibility === v}
          onClick={() => setResultsVisibility(v)}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            resultsVisibility === v
              ? 'border-cyan-500/30 bg-cyan-500/20 text-cyan-400'
              : 'border-white/[0.08] text-white/45 hover:bg-white/[0.06] hover:text-white/70'
          }`}
          data-testid={`poll-composer-results-${v}`}
        >
          {v === 'live' ? t('Live') : t('After it closes')}
        </button>
      ))}
    </div>
  )

  const tabs = predictions ? (
    <div className="mb-3 flex gap-1.5" role="tablist">
      {(['question', 'prediction'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
            mode === m ? 'border-cyan-500/30 bg-cyan-500/20 text-cyan-300' : 'border-white/[0.08] text-white/50'
          }`}
          data-testid={`poll-composer-mode-${m}`}
        >
          {m === 'question' ? t('Ask a question') : t('Predict a matchup')}
        </button>
      ))}
    </div>
  ) : null

  if (predictions && mode === 'prediction') {
    return (
      <div className="mb-2 rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4" data-testid="poll-composer-prediction">
        {tabs}
        <p className="mb-3 text-[11px] text-white/55">
          {t('Pick a matchup — the poll closes at kickoff and settles itself when the game is final.')}
        </p>
        {matchups == null ? (
          <p className="text-[11px] text-white/45">{t('Loading matchups…')}</p>
        ) : native === false ? (
          <p className="text-[11px] text-white/45">{t('Prediction polls are available in AllFantasy leagues.')}</p>
        ) : matchups.length === 0 ? (
          <p className="text-[11px] text-white/45">{t('No matchups left to predict this week.')}</p>
        ) : (
          <ul className="space-y-2">
            {matchups.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-white">
                  {m.home.name} <span className="text-white/40">vs</span> {m.away.name}
                </span>
                {m.pollMessageId ? (
                  <span className="shrink-0 text-[11px] text-white/40">{t('Already posted')}</span>
                ) : (
                  <button
                    type="button"
                    disabled={posting != null}
                    onClick={() => void postPrediction(m.id)}
                    className="shrink-0 rounded-lg bg-cyan-500/20 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    {posting === m.id ? `${t('Posting')}…` : t('Post prediction')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">{resultsToggle}</div>
        {predictError ? (
          <p className="mt-2 text-[11px] text-red-300" role="alert">
            {predictError}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2 rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4">
      {tabs}
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask the league a question..."
        className="mb-3 w-full rounded-xl bg-white/[0.06] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-white/35"
        data-testid="poll-composer-question"
      />

      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={opt}
              onChange={(e) => {
                const next = [...options]
                next[i] = e.target.value
                setOptions(next)
              }}
              placeholder={`Option ${i + 1}...`}
              className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-[12px] text-white outline-none placeholder:text-white/35"
            />
            {i >= 2 ? (
              <button
                type="button"
                onClick={() => setOptions(options.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg px-2 text-white/40 hover:bg-white/[0.06] hover:text-white"
                aria-label="Remove option"
              >
                ×
              </button>
            ) : (
              <span className="w-7 shrink-0" />
            )}
          </div>
        ))}
      </div>

      {options.length < POLL_MAX_OPTIONS ? (
        <button
          type="button"
          onClick={() => setOptions([...options, ''])}
          className="mt-2 text-[11px] font-semibold text-cyan-400/90 hover:text-cyan-300"
        >
          + Add option
        </button>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/55">
          <input
            type="checkbox"
            checked={allowMultiple}
            onChange={(e) => setAllowMultiple(e.target.checked)}
            className="rounded border-white/20 bg-white/10"
          />
          Allow multiple answers
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/55">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="rounded border-white/20 bg-white/10"
          />
          Hide who voted
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-white/35">Closes in:</span>
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => applyDuration(d.label, d.ms)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                activeDur === d.label
                  ? 'border-cyan-500/30 bg-cyan-500/20 text-cyan-400'
                  : 'border-white/[0.08] text-white/45 hover:bg-white/[0.06] hover:text-white/70'
              }`}
            >
              {d.label}
            </button>
          ))}
          {allowNoDeadline ? (
            <button
              type="button"
              onClick={() => applyDuration('none', null)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                activeDur === 'none'
                  ? 'border-cyan-500/30 bg-cyan-500/20 text-cyan-400'
                  : 'border-white/[0.08] text-white/45 hover:bg-white/[0.06] hover:text-white/70'
              }`}
              data-testid="poll-composer-no-deadline"
            >
              {t('No deadline')}
            </button>
          ) : null}
        </div>
        {resultsToggle}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-cyan-500/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/30"
        >
          Create Poll
        </button>
      </div>
    </div>
  )
}
