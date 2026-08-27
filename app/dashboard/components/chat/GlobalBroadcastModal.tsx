'use client'

import React from 'react'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { PollComposer } from './PollComposer'
import type { PollDraft } from './AttachmentPreview'

export type GlobalBroadcastPayload = {
  messageType: 'text' | 'event' | 'poll'
  text: string
  gifUrl?: string
  gifId?: string
  imageUrl?: string
  event?: {
    title: string
    date: string
    time: string
    description: string
    eventType: 'draft' | 'trade_deadline' | 'playoff' | 'custom'
  }
  poll?: {
    question: string
    options: string[]
    closeAt: Date
    allowMultiple: boolean
  }
  selectedLeagueIds: string[]
}

type Props = {
  isOpen: boolean
  onClose: () => void
  commissionerLeagues: { id: string; name: string; teamCount: number }[]
  onSend: (payload: GlobalBroadcastPayload) => Promise<void>
}

type Tab = 'message' | 'event' | 'poll'

export function GlobalBroadcastModal({ isOpen, onClose, commissionerLeagues, onSend }: Props) {
  const [tab, setTab] = useState<Tab>('message')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [pollDraft, setPollDraft] = useState<PollDraft | null>(null)
  const [eventType, setEventType] = useState<NonNullable<GlobalBroadcastPayload['event']>['eventType']>('custom')
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [eventDesc, setEventDesc] = useState('')

  const selectedIds = useMemo(
    () => commissionerLeagues.filter((l) => selected[l.id]).map((l) => l.id),
    [commissionerLeagues, selected]
  )

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = {}
    for (const l of commissionerLeagues) next[l.id] = on
    setSelected(next)
  }

  if (!isOpen) return null

  const canSend =
    selectedIds.length > 0 &&
    (tab === 'message'
      ? text.trim().length > 0
      : tab === 'poll'
        ? Boolean(pollDraft?.question?.trim() && (pollDraft.options?.filter(Boolean).length ?? 0) >= 2)
        : eventTitle.trim().length > 0 && eventDate.trim().length > 0)

  const submit = async () => {
    if (!canSend || sending) return
    setSending(true)
    try {
      const payload: GlobalBroadcastPayload = {
        messageType: tab === 'poll' ? 'poll' : tab === 'event' ? 'event' : 'text',
        text: tab === 'message' ? text.trim() : tab === 'event' ? `📅 ${eventTitle.trim()}` : pollDraft?.question ?? '',
        selectedLeagueIds: selectedIds,
        ...(tab === 'event'
          ? {
              event: {
                title: eventTitle.trim(),
                date: eventDate,
                time: eventTime,
                description: eventDesc.trim(),
                eventType,
              },
            }
          : {}),
        ...(tab === 'poll' && pollDraft
          ? {
              poll: {
                question: pollDraft.question,
                options: pollDraft.options.map((o) => o.trim()).filter(Boolean),
                closeAt: pollDraft.closeAt,
                allowMultiple: pollDraft.allowMultiple,
              },
            }
          : {}),
      }
      const res = await fetch('/api/chat/global-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof data?.error === 'string' ? data.error : 'Broadcast failed')
        return
      }
      /*
       * A partial send is the dangerous outcome: the endpoint only accepts
       * leagues you OWN, while this picker also offers ones you co-commission,
       * so picking three and owning one used to report plain success. Name the
       * shortfall — a sender who is not told will assume the reminder landed.
       */
      const skipped = Array.isArray(data?.skippedLeagueIds) ? (data.skippedLeagueIds as string[]) : []
      const sent = Number(data?.sentToLeagues ?? selectedIds.length)
      if (skipped.length > 0) {
        const names = skipped
          .map((id) => commissionerLeagues.find((l) => l.id === id)?.name ?? id)
          .join(', ')
        toast.error(
          `Sent to ${sent} of ${selectedIds.length}. Not sent to ${names} — you do not own those leagues.`,
          { duration: 8000 },
        )
      } else {
        toast.success(`Broadcast sent to ${sent} league${sent === 1 ? '' : 's'}`)
      }
      onClose()
      await onSend(payload)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0f1521] shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-2 text-white/40 hover:bg-white/[0.06] hover:text-white/80"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="border-b border-white/[0.06] px-5 pb-3 pt-5 pr-12">
          <h2 className="text-lg font-bold text-white">📡 Global Broadcast</h2>
          <p className="mt-1 text-xs text-white/45">Send to multiple leagues you commission</p>
        </div>

        <div className="flex border-b border-white/[0.06] px-2">
          {(['message', 'event', 'poll'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-2.5 text-xs font-semibold capitalize transition ${
                tab === t ? 'border-b-2 border-cyan-500 text-cyan-300' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-5 py-4">
          {tab === 'message' ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Your announcement..."
              rows={4}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
            />
          ) : null}

          {tab === 'event' ? (
            <div className="space-y-2">
              <label className="block text-xs text-white/55">
                Event type
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as typeof eventType)}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="trade_deadline">Trade deadline</option>
                  <option value="playoff">Playoff</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <input
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-sm text-white"
                />
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-sm text-white"
                />
              </div>
              <textarea
                value={eventDesc}
                onChange={(e) => setEventDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white"
              />
            </div>
          ) : null}

          {tab === 'poll' ? (
            <PollComposer
              initial={pollDraft ?? undefined}
              onCreatePoll={(p) => setPollDraft(p)}
              onCancel={() => setPollDraft(null)}
            />
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/45">Send to leagues</p>
              <label className="flex items-center gap-1.5 text-[11px] text-white/55">
                <input
                  type="checkbox"
                  checked={
                    commissionerLeagues.length > 0 && commissionerLeagues.every((l) => selected[l.id])
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                Select all
              </label>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/[0.06] p-2">
              {commissionerLeagues.length === 0 ? (
                <p className="text-xs text-white/40">No commissioner leagues in your list.</p>
              ) : (
                commissionerLeagues.map((l) => (
                  <label
                    key={l.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[l.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [l.id]: e.target.checked }))}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-white/85">{l.name}</span>
                    <span className="text-[10px] text-white/35">{l.teamCount} teams</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-5 py-3">
          <p className="text-[11px] text-white/40">
            {text.length} chars · {selectedIds.length} leagues
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.06]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSend || sending}
              onClick={() => void submit()}
              className="rounded-lg bg-gradient-to-r from-cyan-600 to-violet-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              {sending ? 'Sending…' : `📡 Broadcast`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
