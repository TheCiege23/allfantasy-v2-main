'use client'

import { useId, useState, type FormEvent } from 'react'
import { INQUIRY_LIMITS, LEAGUE_COUNT_OPTIONS, PARTNER_FALLBACK_EMAIL, type InquiryField } from '@/lib/partner-portal/inquiry'

/**
 * The /partners contact form → POST /api/partners/inquiry. On any failure the visitor keeps everything they
 * typed and is shown the address to write to; "sent" appears only when the server says the email was accepted.
 */

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; message: string } | { kind: 'error'; message: string }

const inputClass =
  // 16px on phones: iOS Safari zooms into any field smaller than that on focus.
  'mt-1 w-full rounded-lg border bg-[#0a0f1c] px-3 py-2 text-base text-white sm:text-sm placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400/60'

export function PartnerInquiryForm() {
  const uid = useId()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [errors, setErrors] = useState<Partial<Record<InquiryField, string>>>({})

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status.kind === 'sending') return
    const data = Object.fromEntries(new FormData(e.currentTarget).entries())
    setStatus({ kind: 'sending' })
    setErrors({})
    try {
      const res = await fetch('/api/partners/inquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; errors?: Partial<Record<InquiryField, string>> } | null
      if (res.ok && json?.ok) {
        setStatus({ kind: 'sent', message: json.message ?? "Thanks — we've got it." })
        return
      }
      setErrors(json?.errors ?? {})
      setStatus({ kind: 'error', message: json?.message ?? `That didn't go through. Email ${PARTNER_FALLBACK_EMAIL} instead.` })
    } catch {
      setStatus({ kind: 'error', message: `That didn't go through. Email ${PARTNER_FALLBACK_EMAIL} instead — your message is still here to copy.` })
    }
  }

  if (status.kind === 'sent') {
    return (
      <div role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-5 text-sm text-emerald-100">
        <p className="font-semibold text-white">Sent.</p>
        <p className="mt-1">{status.message}</p>
      </div>
    )
  }

  const field = (name: InquiryField, label: string, opts: { type?: string; required?: boolean; max: number; placeholder?: string; autoComplete?: string }) => {
    const id = `${uid}-${name}`
    const err = errors[name]
    return (
      <div>
        <label htmlFor={id} className="text-xs font-semibold text-white/75">
          {label}
          {opts.required ? null : <span className="font-normal text-white/45"> (optional)</span>}
        </label>
        <input
          id={id}
          name={name}
          type={opts.type ?? 'text'}
          required={opts.required}
          maxLength={opts.max}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className={`${inputClass} ${err ? 'border-red-400/70' : 'border-white/15'}`}
        />
        {err ? (
          <p id={`${id}-err`} className="mt-1 text-xs text-red-300">
            {err}
          </p>
        ) : null}
      </div>
    )
  }

  const countId = `${uid}-leagueCount`
  const messageId = `${uid}-message`
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 text-left" aria-label="Partner inquiry">
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'Your name', { required: true, max: INQUIRY_LIMITS.name, autoComplete: 'name' })}
        {field('email', 'Work email', { type: 'email', required: true, max: INQUIRY_LIMITS.email, autoComplete: 'email' })}
        {field('company', 'Company or platform', { required: true, max: INQUIRY_LIMITS.company, autoComplete: 'organization' })}
        {field('website', 'Website', { max: INQUIRY_LIMITS.website, placeholder: 'example.com', autoComplete: 'url' })}
      </div>
      <div>
        <label htmlFor={countId} className="text-xs font-semibold text-white/75">
          Leagues you run <span className="font-normal text-white/45">(optional)</span>
        </label>
        <select
          id={countId}
          name="leagueCount"
          defaultValue=""
          aria-invalid={errors.leagueCount ? true : undefined}
          className={`${inputClass} ${errors.leagueCount ? 'border-red-400/70' : 'border-white/15'}`}
        >
          <option value="">Choose one</option>
          {LEAGUE_COUNT_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={messageId} className="text-xs font-semibold text-white/75">
          What would you like to see? <span className="font-normal text-white/45">(optional)</span>
        </label>
        <textarea
          id={messageId}
          name="message"
          rows={4}
          maxLength={INQUIRY_LIMITS.message}
          aria-invalid={errors.message ? true : undefined}
          className={`${inputClass} ${errors.message ? 'border-red-400/70' : 'border-white/15'}`}
        />
      </div>
      {/* Honeypot: hidden from people and from assistive tech; a script that fills it is quietly ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Fax
          <input name="fax" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      {status.kind === 'error' ? (
        <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          {status.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status.kind === 'sending'}
          className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-bold text-[#050814] hover:bg-cyan-400 disabled:opacity-60"
        >
          {status.kind === 'sending' ? 'Sending…' : 'Send'}
        </button>
        <p className="text-xs text-white/50">
          A person reads every message, usually within one business day. Prefer email?{' '}
          <a href={`mailto:${PARTNER_FALLBACK_EMAIL}`} className="text-cyan-300 hover:underline">
            {PARTNER_FALLBACK_EMAIL}
          </a>
        </p>
      </div>
    </form>
  )
}
