'use client'

import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, MessageCircle, MessageSquareText, Share2 } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { inviteShareMessage, smsInviteHref, whatsAppInviteHref } from '@/lib/league/league-invite-link'

type Translate = (key: string) => string

function tx(t: Translate, key: string, fallback: string): string {
  const value = t(key)
  return value && value !== key ? value : fallback
}

export type CopyOutcome = 'copied' | 'failed'

/**
 * Copy the invite link. `navigator.clipboard` is missing on plain-http origins and can reject on
 * iOS when the tap is not trusted, so fall back to selecting the visible field and `execCommand`.
 * The old Copy buttons fired `writeText` without awaiting it and said "Copied" either way.
 */
export async function copyInviteText(text: string, field?: HTMLInputElement | null): Promise<CopyOutcome> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    /* fall through to the selection fallback */
  }
  try {
    if (field && typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      field.focus()
      field.select()
      field.setSelectionRange(0, text.length)
      return document.execCommand('copy') ? 'copied' : 'failed'
    }
  } catch {
    /* nothing left to try */
  }
  return 'failed'
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed'

/** The phone's own share sheet (Messages, Mail, Discord, Instagram…). Cancelling is not an error. */
export async function shareInviteNatively(data: { title: string; text: string; url: string }): Promise<ShareOutcome> {
  try {
    await navigator.share(data)
    return 'shared'
  } catch (error) {
    return error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

const buttonClass =
  'inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition active:scale-[0.98]'

/**
 * The invite link with every way to send it: QR code, the phone share sheet, a text message,
 * WhatsApp and Copy. Used by the post-create welcome sheet, the settings Invite panel and the
 * Draft tab, so the three show the same link built the same way.
 */
export function LeagueInviteShare({
  url,
  leagueName,
  filled,
  total,
  showQr = true,
  testIdPrefix = 'league-invite',
}: {
  url: string
  leagueName?: string | null
  filled?: number
  total?: number
  showQr?: boolean
  testIdPrefix?: string
}) {
  const { t } = useLanguage()
  const fieldRef = useRef<HTMLInputElement | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed' | 'shared'>('idle')
  const resetTimer = useRef<number | null>(null)

  // After mount only: the server has no navigator, and rendering the button there would mismatch.
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    return () => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
    }
  }, [])

  const flash = (next: 'copied' | 'failed' | 'shared') => {
    setStatus(next)
    if (resetTimer.current) window.clearTimeout(resetTimer.current)
    if (next !== 'failed') resetTimer.current = window.setTimeout(() => setStatus('idle'), 2500)
  }

  if (!url) {
    return (
      <p className="text-sm text-[color:var(--text-secondary)]" data-testid={`${testIdPrefix}-no-link`}>
        {tx(t, 'league.invite.noLink', 'This league has no invite link yet. Open League settings › Invite to create one.')}
      </p>
    )
  }

  const message = inviteShareMessage(leagueName)
  const seats =
    typeof filled === 'number' && typeof total === 'number' && total > 0
      ? tx(t, 'league.invite.joined', '{{filled}} of {{total}} managers joined')
          .replace('{{filled}}', String(filled))
          .replace('{{total}}', String(total))
      : null

  return (
    <div className="space-y-3" data-testid={testIdPrefix}>
      {seats ? (
        <p className="text-sm font-bold text-[color:var(--text-primary)]" data-testid={`${testIdPrefix}-seats`}>
          {seats}
        </p>
      ) : null}
      {showQr ? (
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-[#ffffff] p-2" data-testid={`${testIdPrefix}-qr`}>
            <QRCodeSVG value={url} size={112} level="M" aria-label={tx(t, 'league.invite.qrLabel', 'QR code for the invite link')} />
          </div>
          <p className="text-xs leading-5 text-[color:var(--text-secondary)]">
            {tx(t, 'league.invite.qrHint', 'Managers in the room can scan this with their phone camera to join.')}
          </p>
        </div>
      ) : null}
      <label className="block">
        <span className="sr-only">{tx(t, 'league.invite.linkLabel', 'Invite link')}</span>
        <input
          ref={fieldRef}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] px-3 py-2.5 font-mono text-[16px] text-[color:var(--text-primary)] sm:text-sm"
          data-testid={`${testIdPrefix}-url`}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {canShare ? (
          <button
            type="button"
            className={`${buttonClass} col-span-2 border-violet-600 bg-violet-600 text-[#ffffff] sm:col-span-1`}
            onClick={async () => {
              const outcome = await shareInviteNatively({ title: leagueName?.trim() || 'AllFantasy league', text: message, url })
              if (outcome === 'shared') flash('shared')
            }}
            data-testid={`${testIdPrefix}-share`}
          >
            <Share2 className="h-4 w-4" aria-hidden />
            {tx(t, 'league.invite.share', 'Share')}
          </button>
        ) : null}
        <a
          href={smsInviteHref(message, url)}
          className={`${buttonClass} border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-primary)]`}
          data-testid={`${testIdPrefix}-sms`}
        >
          <MessageSquareText className="h-4 w-4" aria-hidden />
          {tx(t, 'league.invite.text', 'Text')}
        </a>
        <a
          href={whatsAppInviteHref(message, url)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${buttonClass} border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200`}
          data-testid={`${testIdPrefix}-whatsapp`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          WhatsApp
        </a>
        <button
          type="button"
          className={`${buttonClass} border-[color:var(--border-subtle)] bg-[color:var(--surface-card-soft)] text-[color:var(--text-primary)]`}
          onClick={async () => flash(await copyInviteText(url, fieldRef.current))}
          data-testid={`${testIdPrefix}-copy`}
        >
          {status === 'copied' ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {status === 'copied' ? tx(t, 'league.invite.copied', 'Copied') : tx(t, 'league.invite.copy', 'Copy link')}
        </button>
      </div>
      <p aria-live="polite" className="min-h-5 text-xs text-[color:var(--text-secondary)]" data-testid={`${testIdPrefix}-status`}>
        {status === 'failed'
          ? tx(t, 'league.invite.copyFailed', "Couldn't copy automatically. Press and hold the link above to copy it.")
          : status === 'copied'
            ? tx(t, 'league.invite.copiedLong', 'Invite link copied.')
            : status === 'shared'
              ? tx(t, 'league.invite.sharedLong', 'Invite sent.')
              : ''}
      </p>
    </div>
  )
}
