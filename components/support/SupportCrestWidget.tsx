'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Loader2, CheckCircle2, TriangleAlert } from 'lucide-react'
import { SUPPORT_WIDGET_FEEDBACK_TYPE, SUPPORT_WIDGET_TOOL } from '@/lib/support/support-widget'

/**
 * Global "contact support" entry point — the AF crest with an "S" glyph, mounted once in
 * GlobalAppShell so it is reachable from every product surface on BOTH desktop and mobile.
 * (The dashboard's FloatingCommunications bubble is `md:inline-flex` — desktop/tablet only — so
 * anchoring support to it would have left phone users, i.e. most live-event traffic, with no way
 * to reach it.)
 *
 * Deliberate choices:
 * - **Click to open, not hover.** Touch devices have no real hover, and a form with input fields
 *   that opens/closes on mouse position is fragile. Hover only reveals the text label/tooltip.
 * - **Posts to a real endpoint, never a `mailto:`.** A mailto would both leak the destination
 *   address into the page source and dump the user out to their own mail client. Nothing in this
 *   component — rendered text, markup, or payload — contains the support addresses; the server
 *   resolves recipients from SUPPORT_NOTIFICATION_EMAILS.
 * - Positioned beside the existing Chimmy FAB (whose offsets already clear MobileBottomTabs) so
 *   the floating cluster stays deconflicted at every breakpoint.
 */
export function SupportCrestWidget() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const emailRef = useRef<HTMLInputElement | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setError(null)
    // Reset back to a clean form after a successful send so a second message starts fresh.
    if (status === 'sent') {
      setStatus('idle')
      setMessage('')
    }
  }, [status])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    // Focus the first field so keyboard users land inside the dialog.
    const id = window.setTimeout(() => emailRef.current?.focus(), 40)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(id)
    }
  }, [open, close])

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSubmit = emailValid && message.trim().length > 0 && status !== 'sending'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('sending')
    setError(null)
    try {
      const res = await fetch('/api/legacy/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackType: SUPPORT_WIDGET_FEEDBACK_TYPE,
          tool: SUPPORT_WIDGET_TOOL,
          feedbackText: message.trim(),
          email: email.trim(),
          canContact: true,
          // Schema caps pageUrl at 500 chars.
          pageUrl: typeof window !== 'undefined' ? window.location.href.slice(0, 500) : null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : 'Could not send your message. Please try again.'
        )
        setStatus('error')
        return
      }
      setStatus('sent')
    } catch {
      setError('Could not send your message. Please try again.')
      setStatus('error')
    }
  }

  return (
    <>
      {/* Entry point — icon-only crest + "S". `group` drives the hover/focus label; hover never
          opens the form itself. Sits left of the Chimmy FAB at both breakpoints. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="open-support-widget"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Contact AllFantasy Support"
        title="Contact AllFantasy Support"
        /* Offsets are deconflicted from the other fixed controls in this corner, measured in-browser:
           mobile/tablet sits immediately LEFT of the Chimmy FAB (bottom-24 right-4), which itself
           already clears MobileBottomTabs; desktop stacks ABOVE both the Chimmy FAB (lg:bottom-6
           right-6) and the dashboard's wide "Open Communications" pill (bottom-5 right-5). */
        className="group fixed bottom-24 right-[4.75rem] z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/30 bg-gradient-to-br from-cyan-500/25 to-violet-500/20 shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] backdrop-blur-md transition hover:from-cyan-500/35 hover:to-violet-500/30 hover:shadow-[0_10px_36px_-8px_rgba(34,211,238,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 active:scale-95 lg:bottom-24 lg:right-6"
      >
        <span className="relative inline-flex h-7 w-7 items-center justify-center">
          {/* Plain <img>: matches GlobalTopNav's crest usage. No .svg counterpart exists in
              /public, so the raster crest is the sharpest asset available at this size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/af-crest.png"
            alt=""
            aria-hidden
            className="mode-logo-safe h-7 w-7 rounded-md object-contain"
          />
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-[10px] font-black leading-none text-white ring-2 ring-[#0a0a1f]"
          >
            S
          </span>
        </span>
        <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg border border-cyan-400/25 bg-slate-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 lg:block">
          Contact AllFantasy Support
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          role="presentation"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-widget-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[420px] overflow-hidden rounded-t-[20px] border border-white/10 bg-[#0a0a1f] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(0,0,0,0.45)] sm:rounded-[20px] sm:pb-0"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <p
                id="support-widget-title"
                className="text-[13px] font-bold tracking-tight text-white"
              >
                Contact AllFantasy Support
              </p>
              <button
                type="button"
                onClick={close}
                aria-label="Close support form"
                className="touch-manipulation inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
              >
                <X className="h-4.5 w-4.5" aria-hidden />
              </button>
            </div>

            {status === 'sent' ? (
              <div className="px-4 py-8 text-center" data-testid="support-widget-success">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" aria-hidden />
                <p className="mt-3 text-[15px] font-bold text-white">
                  Thanks — we got it and will follow up soon.
                </p>
                <p className="mt-1.5 text-[12.5px] leading-5 text-white/55">
                  We sent a confirmation to your email.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/25 to-violet-500/20 px-5 text-[13px] font-bold text-white transition hover:from-cyan-500/35 hover:to-violet-500/30"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 px-4 py-4">
                <p className="text-[12.5px] leading-5 text-white/55">
                  Issue or praise — it goes straight to the AllFantasy team.
                </p>

                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.08] px-3 py-2.5 text-[12.5px] text-red-200"
                  >
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
                    <span>{error}</span>
                  </div>
                ) : null}

                <div>
                  <label
                    htmlFor="support-widget-email"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/50"
                  >
                    Your email
                  </label>
                  <input
                    id="support-widget-email"
                    ref={emailRef}
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                  />
                </div>

                <div>
                  <label
                    htmlFor="support-widget-message"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/50"
                  >
                    Your message
                  </label>
                  <textarea
                    id="support-widget-message"
                    required
                    rows={4}
                    maxLength={5000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Tell us what happened, or what you love."
                    className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[14px] text-white placeholder:text-white/25 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  data-testid="support-widget-submit"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/25 to-violet-500/20 text-[14px] font-bold text-white transition hover:from-cyan-500/35 hover:to-violet-500/30 disabled:opacity-40"
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    'Send message'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default SupportCrestWidget
