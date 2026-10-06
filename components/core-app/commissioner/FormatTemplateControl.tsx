'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CommissionerFormatTemplate } from '@/lib/core-app/commissionerHub'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * The owner's "this league is run as …" switch, in the hub's Format operations.
 *
 * A platform cannot publish that a league promotes and relegates — Sleeper has no such setting — so
 * without this, the EFL template could not reach the league it was written for. Applying or removing
 * changes which mechanics Commissioner OS runs, so both take a confirm step.
 *
 * Renders nothing for anyone but the owner, and nothing when there is neither a template applied nor
 * one that fits. The route re-checks both (owner-only, offer recomputed server-side), so this
 * component cannot grant what it is not allowed to.
 */
export function FormatTemplateControl({ leagueId, template }: { leagueId: string; template: CommissionerFormatTemplate }) {
  const router = useRouter()
  const { language } = useOptionalLanguage()
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const [confirming, setConfirming] = useState<string | 'remove' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!template.canChange) return null
  if (!template.applied && template.offers.length === 0) return null

  async function save(templateId: string | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/commissioner-template`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ templateId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Could not save (${res.status}).`)
        return
      }
      setConfirming(null)
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="af-ch-template" data-testid="format-template-control">
      {template.applied ? (
        <>
          <p className="af-ch-muted">
            {t('Run on AllFantasy as')} <strong>{template.applied.label}</strong>
            {template.applied.resolved ? '' : t(' — that version is no longer published')}.
          </p>
          {confirming === 'remove' ? (
            <div className="af-ch-template-actions">
              <span className="af-ch-muted">{t('Turn off this format’s mechanics for the league?')}</span>
              <button type="button" className="af-btn" disabled={busy} onClick={() => save(null)}>
                {busy ? t('Removing…') : t('Yes, remove')}
              </button>
              <button type="button" className="af-btn" disabled={busy} onClick={() => setConfirming(null)}>
                {t('Cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="af-btn" onClick={() => setConfirming('remove')}>
              {t('Remove format')}
            </button>
          )}
        </>
      ) : (
        template.offers.map((offer) => (
          <div key={offer.id} className="af-ch-template-offer">
            <p>
              <strong>{t(`Does this league run as ${offer.label}?`)}</strong> {t(offer.description)}
            </p>
            {confirming === offer.id ? (
              <div className="af-ch-template-actions">
                <span className="af-ch-muted">{t('Apply it to this league? You can remove it later.')}</span>
                <button type="button" className="af-btn" disabled={busy} onClick={() => save(offer.id)}>
                  {busy ? t('Applying…') : t('Yes, apply')}
                </button>
                <button type="button" className="af-btn" disabled={busy} onClick={() => setConfirming(null)}>
                  {t('Cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="af-btn" onClick={() => setConfirming(offer.id)}>
                {t('Use')} {offer.label}
              </button>
            )}
          </div>
        ))
      )}
      {error ? (
        <p className="af-ch-muted" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  )
}
