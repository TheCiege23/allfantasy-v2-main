'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { PublicReputation } from '@/lib/commish-reputation/reputation'

/**
 * Commish reputation chip for public listings (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 10).
 * Renders nothing unless the commissioner made their reputation public on this league.
 */
export function CommishReputationBadge({ reputation, className }: { reputation: PublicReputation | null | undefined; className?: string }) {
  const { language } = useOptionalLanguage()
  const t = (en: string, es: string) => (language === 'es' ? es : en)
  if (!reputation) return null
  if (reputation.kind === 'new') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/60 ${className ?? ''}`} data-testid="commish-badge-new">
        {t('New commissioner', 'Comisionado nuevo')}
      </span>
    )
  }
  const stars = `${reputation.overall.toFixed(1)}★`
  const count = t(`${reputation.ratings} ratings`, `${reputation.ratings} valoraciones`)
  if (reputation.wellRun) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-200 ${className ?? ''}`}
        title={t(`Rated ${stars} by managers across ${reputation.leagues} league(s), ${count}`, `Valorado ${stars} por mánagers en ${reputation.leagues} liga(s), ${count}`)}
        data-testid="commish-badge-well-run"
      >
        {t('Well-run league', 'Liga bien llevada')} · {stars}
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/70 ${className ?? ''}`} data-testid="commish-badge-rated">
      {t('Commish', 'Comisionado')} {stars} · {count}
    </span>
  )
}
