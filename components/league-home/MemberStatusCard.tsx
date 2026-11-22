'use client'

import { useEffect, useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { PAYMENT_LINK_LABEL, type PaymentLink } from '@/lib/dues/duesTracker'

/**
 * The two things a member must not miss, at the top of the league home: when the draft is (in their own
 * time zone, with "Add to calendar"), and what they owe in dues (with the league's own payment links).
 * Renders nothing when neither applies. TRACKING ONLY — AllFantasy never takes the money.
 */

type Status = {
  draft: { at: string; calendarHref: string } | null
  dues: { amount: string; dueDate: string | null; links: PaymentLink[]; reported: boolean } | null
}

export function MemberStatusCard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, spanish: string) => (es ? spanish : en)
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let live = true
    // Never throws: a card that cannot load is simply absent, it never breaks the league home.
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/member-status`, { credentials: 'same-origin', cache: 'no-store' })
        const s = res.ok ? ((await res.json()) as Status) : null
        if (live) setStatus(s)
      } catch {
        if (live) setStatus(null)
      }
    })()
    return () => {
      live = false
    }
  }, [leagueId])

  if (!status || (!status.draft && !status.dues)) return null
  const when = (iso: string) =>
    new Date(iso).toLocaleString(getAppIntlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

  return (
    <section className="af-card af-lh-member-status" data-testid="member-status" aria-label={t('Coming up for you', 'Lo que te toca')}>
      {status.draft ? (
        <div className="af-lh-ms-row">
          <div className="af-lh-ms-text">
            <span className="af-label">{t('Draft', 'Draft')}</span>
            <strong>{when(status.draft.at)}</strong>
          </div>
          <a className="af-btn af-btn--ghost af-lh-ms-btn" href={status.draft.calendarHref} download>
            {t('Add to calendar', 'Agregar al calendario')}
          </a>
        </div>
      ) : null}
      {status.dues ? (
        <div className="af-lh-ms-row">
          <div className="af-lh-ms-text">
            <span className="af-label">{t('Dues', 'Cuotas')}</span>
            <strong>
              {t('You owe', 'Debes')} {status.dues.amount}
              {status.dues.dueDate ? ` · ${t('due', 'vence el')} ${status.dues.dueDate}` : ''}
            </strong>
            {status.dues.reported ? <span className="af-lh-ms-note">{t('You said you paid — waiting for the commissioner.', 'Dijiste que pagaste — esperando al comisionado.')}</span> : null}
          </div>
          <div className="af-lh-ms-links">
            {status.dues.links.map((l) => (
              <a key={`${l.kind}-${l.url}`} className="af-btn af-btn--ghost af-lh-ms-btn" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.kind === 'other' ? t('Pay', 'Pagar') : PAYMENT_LINK_LABEL[l.kind]}
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

