'use client'

import { useMemo, useState } from 'react'
import type { PollDraft } from './AttachmentPreview'

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
}

export function PollComposer({ initial, onCreatePoll, onCancel }: PollComposerProps) {
  const defaultClose = useMemo(() => new Date(Date.now() + 24 * 60 * 60 * 1000), [])
  const [question, setQuestion] = useState(initial?.question ?? '')
  const [options, setOptions] = useState<string[]>(initial?.options?.length ? initial.options : ['', ''])
  const [allowMultiple, setAllowMultiple] = useState(initial?.allowMultiple ?? false)
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? false)
  const [closeAt, setCloseAt] = useState(initial?.closeAt ?? defaultClose)
  const [activeDur, setActiveDur] = useState('24h')

  const applyDuration = (label: string, ms: number) => {
    setActiveDur(label)
    setCloseAt(new Date(Date.now() + ms))
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
    })
  }

  return (
    <div className="mb-2 rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-4">
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

      {options.length < 5 ? (
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
          <span className="text-[10px] text-white/35">Closes in:</span>
          {DURATIONS.map((d) => (
            <button
              key={d.label}
              type="button"
              onClick={() => applyDuration(d.label, d.ms)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                activeDur === d.label
                  ? 'border-cyan-500/30 bg-cyan-500/20 text-cyan-400'
                  : 'border-white/[0.08] text-white/45 hover:bg-white/[0.06] hover:text-white/70'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
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
