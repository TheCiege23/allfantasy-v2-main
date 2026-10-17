'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftPickRecord, DraftStatePayload } from '../types'
import { slotIndexForOverallPick } from '@/lib/draft/snake'

const QUICK_ACTIONS = [
  { key: 'best-pick', label: 'Best Pick Available', path: '/api/draft/ai/best-pick' },
  { key: 'roster-fit', label: 'Who Fits My Roster', path: '/api/draft/ai/roster-fit' },
  { key: 'scarcity', label: 'Scarcity Alert', path: '/api/draft/ai/scarcity' },
  { key: 'pick-survival', label: 'Will They Be There?', path: '/api/draft/ai/pick-survival' },
  { key: 'grade', label: 'Grade My Draft', path: '/api/draft/ai/grade' },
] as const

type Recommendation = {
  player?: string
  position?: string
  reason?: string
  team?: string
}

type StructuredResult = {
  recommendations?: Recommendation[]
  queue?: Recommendation[]
  summary?: string
  alert?: string
  grade?: string
  notes?: string
} | null

type Message = {
  id: string
  role: 'chimmy' | 'user' | 'system'
  text?: string
  result?: StructuredResult
  source?: string
  timestamp: number
}

type ContextShape = {
  userName?: string
  state?: DraftStatePayload | null
  picks?: DraftPickRecord[]
  userId?: string
}

type Props = {
  sessionId: string
  context: ContextShape
}

function genId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function parseJsonish(raw: unknown): StructuredResult {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as StructuredResult
  if (typeof raw !== 'string') return null
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(cleaned) as StructuredResult
  } catch {
    return null
  }
}

export function ChimmyDraftChat({ sessionId, context }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      text: 'Chimmy will surface picks proactively as you approach the clock. Use a quick action below or ask anything.',
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoSuggest, setAutoSuggest] = useState(true)
  const lastAutoForOverallRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Compute "user is on the clock or within 2 picks" — used to gate proactive DMs.
  const state = context.state ?? null
  const order = state?.pickOrder ?? []
  const numTeams = state?.numTeams ?? order.length ?? 12
  const currentOverall = state?.currentPick ?? 0
  const userId = context.userId ?? null

  const userSlotIdx = userId ? order.findIndex((s) => s.id === userId) : -1
  const currentSlotIdx = currentOverall ? slotIndexForOverallPick(currentOverall, numTeams) : -1

  // How many picks until it's the viewer's turn (0 = OTC, undefined when unknown).
  let picksUntilUser: number | null = null
  if (state?.status === 'active' && userSlotIdx >= 0 && currentSlotIdx >= 0 && currentOverall > 0) {
    const numRounds = state.numRounds ?? 0
    const overallEnd = numTeams * numRounds
    for (let probe = currentOverall; probe <= overallEnd; probe++) {
      if (slotIndexForOverallPick(probe, numTeams) === userSlotIdx) {
        picksUntilUser = probe - currentOverall
        break
      }
    }
  }

  const append = useCallback((m: Omit<Message, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => {
    setMessages((prev) => [
      ...prev,
      { id: m.id ?? genId(), timestamp: m.timestamp ?? Date.now(), ...m },
    ])
  }, [])

  const callAi = useCallback(
    async (path: string, opts: { auto?: boolean; question?: string; quickKey?: string } = {}) => {
      setLoading(true)
      try {
        const r = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            userName: context.userName,
            state,
            picks: context.picks,
            ...(opts.question ? { question: opts.question } : {}),
          }),
        })
        const j = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string }
        if (j.error) {
          append({ role: 'chimmy', text: j.error, source: opts.auto ? 'auto' : opts.quickKey ?? 'ask' })
        } else {
          append({
            role: 'chimmy',
            result: parseJsonish(j.result),
            text:
              parseJsonish(j.result) == null
                ? typeof j.result === 'string'
                  ? j.result
                  : JSON.stringify(j.result)
                : undefined,
            source: opts.auto ? 'Heads-up' : opts.quickKey ?? 'ask',
          })
        }
      } catch (e) {
        append({ role: 'chimmy', text: e instanceof Error ? e.message : String(e) })
      } finally {
        setLoading(false)
      }
    },
    [sessionId, context.userName, context.picks, state, append],
  )

  // Proactive DM: when user is OTC or 1 pick away, fetch best-pick automatically (once per overall).
  useEffect(() => {
    if (!autoSuggest) return
    if (!state || state.status !== 'active') return
    if (picksUntilUser == null || picksUntilUser > 1) return
    if (lastAutoForOverallRef.current === currentOverall) return
    lastAutoForOverallRef.current = currentOverall
    append({
      role: 'system',
      text:
        picksUntilUser === 0
          ? `You're on the clock — Chimmy is pulling top recommendations…`
          : `You're up next (1 pick away) — Chimmy is scouting…`,
    })
    void callAi('/api/draft/ai/best-pick', { auto: true })
  }, [autoSuggest, state, picksUntilUser, currentOverall, append, callAi])

  // Autoscroll to newest.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  const sendCustom = async () => {
    const t = input.trim()
    if (!t) return
    setInput('')
    append({ role: 'user', text: t })
    await callAi('/api/draft/ai/best-pick', { question: t })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-cyan-500/20 bg-[#0d1117]"
      data-testid="chimmy-draft-chat"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300/85">
            Chimmy ✨ {picksUntilUser === 0 ? '· On the clock' : picksUntilUser === 1 ? '· Up next' : ''}
          </p>
          <p className="text-[11px] text-white/40">Private suggestions — only you see this.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/55">
          <input
            type="checkbox"
            checked={autoSuggest}
            onChange={(e) => setAutoSuggest(e.target.checked)}
            className="h-3 w-3 cursor-pointer"
            data-testid="chimmy-auto-toggle"
          />
          Auto-suggest
        </label>
      </div>
      <div className="border-b border-white/[0.06] px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((b) => (
            <button
              key={b.path}
              type="button"
              disabled={loading}
              onClick={() => void callAi(b.path, { quickKey: b.key })}
              className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-200/90 hover:bg-cyan-500/20 disabled:opacity-50"
              data-testid={`chimmy-quick-${b.key}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 text-[11px]">
        {messages.map((m) => (
          <ChimmyMessageView key={m.id} msg={m} />
        ))}
        {loading ? (
          <p className="px-1 text-[11px] italic text-cyan-300/70">Chimmy is thinking…</p>
        ) : null}
      </div>
      <div className="flex gap-1 border-t border-white/[0.06] p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendCustom()
            }
          }}
          placeholder="Ask Chimmy a question…"
          className="min-w-0 flex-1 rounded border border-white/[0.08] bg-black/30 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-cyan-500/40 focus:outline-none"
          data-testid="chimmy-input"
        />
        <button
          type="button"
          onClick={() => void sendCustom()}
          disabled={loading || !input.trim()}
          className="rounded bg-cyan-500/80 px-3 py-1 text-[11px] font-bold text-black hover:bg-cyan-400 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  )
}

function ChimmyMessageView({ msg }: { msg: Message }) {
  if (msg.role === 'user') {
    return (
      <div className="ml-6 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-white/90" data-testid="chimmy-msg-user">
        {msg.text}
      </div>
    )
  }
  if (msg.role === 'system') {
    return (
      <div className="text-center text-[11px] italic text-white/35" data-testid="chimmy-msg-system">
        {msg.text}
      </div>
    )
  }
  // assistant / chimmy
  const recs = msg.result?.recommendations ?? msg.result?.queue ?? []
  return (
    <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] px-2.5 py-2 text-white/85" data-testid="chimmy-msg-assistant">
      {msg.source ? (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/65">
          {msg.source}
        </p>
      ) : null}
      {msg.result?.summary ? (
        <p className="mb-1.5 text-[11px] text-white/85">{msg.result.summary}</p>
      ) : null}
      {msg.result?.alert ? (
        <p className="mb-1.5 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100">
          ⚠ {msg.result.alert}
        </p>
      ) : null}
      {msg.result?.grade ? (
        <p className="mb-1.5 text-[11px] text-cyan-200">Grade: <span className="font-bold">{msg.result.grade}</span></p>
      ) : null}
      {recs.length > 0 ? (
        <ol className="space-y-1">
          {recs.slice(0, 5).map((r, i) => (
            <li key={i} className="rounded border border-white/[0.06] bg-black/20 px-2 py-1">
              <p className="text-[11px] font-semibold text-white">
                {i + 1}. {r.player ?? '—'}
                {r.position ? <span className="ml-1 text-[11px] text-white/45">({r.position}{r.team ? `, ${r.team}` : ''})</span> : null}
              </p>
              {r.reason ? <p className="mt-0.5 text-[11px] text-white/60">{r.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {msg.result?.notes ? <p className="mt-1.5 text-[11px] text-white/55">{msg.result.notes}</p> : null}
      {!msg.result && msg.text ? (
        <pre className="whitespace-pre-wrap break-words text-[11px] text-white/65">{msg.text}</pre>
      ) : null}
    </div>
  )
}
