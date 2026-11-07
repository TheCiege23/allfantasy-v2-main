'use client'

/**
 * `/league/[leagueId]/tanking-flag/[flagId]` — the flagged manager's view of a tanking case.
 *
 * The private warning a manager gets when the monitor flags their lineup links here. They see exactly
 * what was flagged and can explain it before the commissioner rules (lib/integrity/managerReply.ts).
 * Only the manager the flag names can open it; anyone else gets "not found".
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import '@/components/core-app/af-core.css'
import '@/components/core-app/af-commish.css'
import { LineupScoreStrip } from '@/components/commish/IntegrityFlagCard'

const MAX = 1000

type FlagView = {
  id: string
  status: string
  summary: string
  createdAt: string
  starts: { week: number | null; slot: string; player: string; status: string; bench: string | null }[]
  weeksFlagged: number[]
  reply: { text: string; submittedAt: string } | null
  canReply: boolean
  lineupIntegrity?: {
    weeks: { week: number; ratio: number | null; startedTopCount: number | null; starterCount: number | null }[]
    below: number | null
    run: number[]
    pickNote: string | null
  } | null
}

function startLine(s: FlagView['starts'][number]): string {
  const head = [s.week != null ? `Week ${s.week}` : null, s.slot ? `Slot ${s.slot}` : null].filter(Boolean).join(' · ')
  const started = `started ${s.player || 'a player'}${s.status ? ` (${s.status})` : ''}`
  const bench = s.bench ? ` with ${s.bench} available on the bench` : ''
  return `${head ? `${head} · ` : ''}${started}${bench}.`
}

export default function TankingFlagReplyPage() {
  const params = useParams<{ leagueId: string; flagId: string }>() ?? ({} as { leagueId: string; flagId: string })
  const { leagueId, flagId } = params
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/integrity/flags/${encodeURIComponent(flagId)}/reply`

  const [flag, setFlag] = useState<FlagView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null)
    if (!res || !res.ok) return setState('missing')
    const json = (await res.json().catch(() => ({}))) as { flag?: FlagView }
    if (!json.flag) return setState('missing')
    setFlag(json.flag)
    setText(json.flag.reply?.text ?? '')
    setState('ready')
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    setSending(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const json = (await res.json().catch(() => ({}))) as { flag?: FlagView; error?: string }
      if (!res.ok || !json.flag) {
        throw new Error(
          json.error === 'closed'
            ? 'Your commissioner has already ruled on this case.'
            : json.error === 'too_long'
              ? `Keep it under ${MAX} characters.`
              : 'Could not send your reply.',
        )
      }
      setFlag(json.flag)
      toast.success('Sent to your commissioner.')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not send your reply.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="af-core af-cm-shell af-cm-integrity">
      <div className="af-cm" style={{ maxWidth: 640 }}>
        <header className="af-cm-head">
          <div className="af-cm-head-titles">
            <h1 className="af-cm-title">Lineup review</h1>
            <span className="af-cm-sub">Private to you and your commissioner</span>
          </div>
          <Link href={`/league/${leagueId}`} className="af-cm-sub">
            ← Back to league
          </Link>
        </header>

        {state === 'loading' ? <p className="af-cm-sub">Loading…</p> : null}
        {state === 'missing' ? (
          <p className="af-cm-empty" data-testid="tanking-flag-missing">
            This lineup review was not found. It may have been closed, or it belongs to another team.
          </p>
        ) : null}

        {state === 'ready' && flag ? (
          <article className="af-cm-flagcard" data-testid="tanking-flag-view">
            <div className="af-cm-flagcard-top">
              <div className="af-cm-flagcard-tags">
                <span className="af-cm-sev af-num" data-sev="medium">
                  Lineup flagged
                </span>
                <span className="af-cm-state af-num">{flag.status === 'open' ? 'under review' : flag.status}</span>
              </div>
            </div>
            <h3 className="af-cm-flagcard-lead">{flag.summary}</h3>
            {flag.starts.length > 0 ? (
              <ul className="af-cm-evidence">
                {flag.starts.map((s, i) => (
                  <li key={i}>{startLine(s)}</li>
                ))}
              </ul>
            ) : null}
            {flag.lineupIntegrity ? <LineupScoreStrip li={{ ...flag.lineupIntegrity, below: flag.lineupIntegrity.below ?? undefined }} /> : null}

            <p className="af-cm-threshold">
              Nothing has been taken from your team. If there is a reason — a late scratch, a player ruled out after you set
              your lineup — tell your commissioner here. They will read it before they decide.
            </p>

            {flag.canReply ? (
              <div className="af-cm-reply-form">
                <label className="af-label" htmlFor="tanking-reply">
                  Your explanation
                </label>
                <textarea
                  id="tanking-reply"
                  className="af-cm-reply-input"
                  data-testid="tanking-reply-input"
                  maxLength={MAX}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="e.g. My QB was ruled out an hour before kickoff and I was at work."
                />
                <div className="af-cm-reply-foot">
                  <span className="af-cm-sub af-num">
                    {text.length}/{MAX}
                  </span>
                  <button type="button" className="af-btn" disabled={sending || text.trim().length === 0} onClick={() => void send()}>
                    {sending ? 'Sending…' : flag.reply ? 'Update reply' : 'Send to commissioner'}
                  </button>
                </div>
                {flag.reply ? (
                  <p className="af-cm-sub" data-testid="tanking-reply-sent">
                    Sent {new Date(flag.reply.submittedAt).toLocaleString()}. You can update it until your commissioner rules.
                  </p>
                ) : null}
              </div>
            ) : flag.reply ? (
              <p className="af-cm-sub">Your reply: “{flag.reply.text}”</p>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  )
}
