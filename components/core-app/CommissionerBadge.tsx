'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The blue "C" beside a league the viewer commissions — in the crest's own
 * colours (navy fill, cyan ring, white letter) so it reads as AllFantasy's mark.
 *
 * ONE SOURCE OF TRUTH FOR "COMMISSIONER": `isCommissioner` from
 * getDashboardLeagueListForUser (resolveViewerLeagueCommissioner) — the same
 * flag behind the More menu's "Commissioner N" count. It covers co-commissioners,
 * a native AF league's creator, and an imported league's owner (Sleeper's
 * `is_owner` on the viewer's team). Every list passes that flag through; none
 * decides commissioner on its own.
 *
 * Styles: `.af-commish-c` in af-core.css.
 *
 * ⚠ THE "C" IS DRAWN BY CSS (::before), NOT TEXT. The badge sits inside or beside
 * league NAMES, and name text is read back — tests, copy/paste, the switcher's
 * own label — so a literal "C" would turn "Iron Horse" into "Iron HorseC". The
 * accessible name comes from aria-label instead.
 */
export function CommissionerBadge({ className }: { className?: string }) {
  // Every importer is a client component; the label follows the language switch (2026-10-04).
  const { language } = useOptionalLanguage()
  const label = language === 'es' ? 'Eres comisionado' : "You're the commissioner"
  return (
    <span
      className={className ? `af-commish-c ${className}` : 'af-commish-c'}
      role="img"
      aria-label={label}
      title={label}
      data-testid="commissioner-badge"
    />
  )
}
