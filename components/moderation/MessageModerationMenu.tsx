'use client'

/**
 * Report / Block for one chat message — for the chats that do not use ChatMessageList
 * (the app/draft shell's chat, bracket pool chat, the mock draft simulator's chat).
 *
 * App Store guideline 1.2: every place users post must let a person report a message and block
 * its author. ChatMessageList carries its own sheet for league chat, DMs and the live draft room;
 * this is the same two actions, the same routes and the same reason list for the simpler lists.
 *
 * Renders NOTHING on your own message, on a message with no author (system rows, picks, AI
 * notes), or when the viewer is unknown — so a panel can drop it on every row unconditionally.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from '@/lib/moderation/shared'
import { chatFailure } from '@/components/core-app/comms/chatFailure'

export type MessageModerationMenuProps = {
  /** The report room: a platform thread id, "league:<id>", "draftroom:<session>" or "mockdraft:<id>". */
  threadId: string
  messageId: string
  authorId: string | null | undefined
  authorName: string | null | undefined
  viewerId: string | null | undefined
  /** Called after a block succeeds, with the blocked author — hide their messages at once. */
  onBlocked?: (authorId: string) => void
}

type Step = 'menu' | 'report' | 'block' | 'reported'

export function MessageModerationMenu({
  threadId,
  messageId,
  authorId,
  authorName,
  viewerId,
  onBlocked,
}: MessageModerationMenuProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('menu')
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setStep('menu')
    setError(null)
    setBusy(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!authorId || !viewerId || authorId === viewerId) return null
  const name = authorName?.trim() || 'this person'

  const sendReport = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/shared/chat/report/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, threadId, reason }),
      })
      if (!res.ok) throw await chatFailure(res, 'Report not sent', 'Report not sent. Try again in a moment.')
      setStep('reported')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report not sent. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const sendBlock = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/shared/chat/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedUserId: authorId }),
      })
      if (!res.ok) throw await chatFailure(res, 'Not blocked', 'Not blocked. Try again in a moment.')
      onBlocked?.(authorId)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Not blocked. Try again in a moment.')
      setBusy(false)
    }
  }

  const btn =
    'w-full rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white/85 hover:bg-white/10 disabled:opacity-50 min-h-[44px]'

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Message options for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white/80 after:absolute after:-inset-2.5 after:content-['']"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={close} tabIndex={-1} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute right-0 top-7 z-50 w-64 rounded-xl border border-white/15 bg-[#0d1117] p-1.5 text-white shadow-2xl"
          >
            <p id={titleId} className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/45">
              {step === 'report' ? 'Why report this?' : step === 'block' ? `Block ${name}?` : 'Message'}
            </p>
            {step === 'menu' ? (
              <>
                <button type="button" className={btn} onClick={() => setStep('report')}>
                  Report message
                </button>
                <button type="button" className={btn} onClick={() => setStep('block')}>
                  Block {name}
                </button>
              </>
            ) : null}
            {step === 'report' ? (
              <div className="space-y-1 px-1 pb-1">
                <fieldset>
                  <legend className="sr-only">Reason</legend>
                  {REPORT_REASONS.map((r) => (
                    <label key={r} className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-white/80 hover:bg-white/5">
                      <input type="radio" name={`reason-${messageId}`} checked={reason === r} onChange={() => setReason(r)} />
                      {REPORT_REASON_LABELS[r]}
                    </label>
                  ))}
                </fieldset>
                <button type="button" className={`${btn} text-center text-rose-200`} disabled={busy} onClick={() => void sendReport()}>
                  Send report
                </button>
              </div>
            ) : null}
            {step === 'block' ? (
              <div className="space-y-1 px-1 pb-1">
                <p className="px-2 text-[11px] leading-4 text-white/55">You won&apos;t see their messages. They aren&apos;t told.</p>
                <button type="button" className={`${btn} text-center text-rose-200`} disabled={busy} onClick={() => void sendBlock()}>
                  Block
                </button>
              </div>
            ) : null}
            {step === 'reported' ? (
              <p className="px-3 pb-2 text-[11px] leading-4 text-white/70" role="status">
                Reported. We review reports within 24 hours.
              </p>
            ) : null}
            {error ? (
              <p className="px-3 pb-2 text-[11px] leading-4 text-rose-300" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className={`${btn} text-center text-white/55`} onClick={close}>
              {step === 'reported' ? 'Done' : 'Cancel'}
            </button>
          </div>
        </>
      ) : null}
    </span>
  )
}
