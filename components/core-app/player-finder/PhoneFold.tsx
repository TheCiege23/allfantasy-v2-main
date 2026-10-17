'use client'

import { useState, type ReactNode } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { leagueActionsCopy } from '@/lib/core-app/leagueActionsCopy'

/**
 * A section that folds on a phone and is simply itself everywhere else (2026-10-08). The player card
 * on a phone ran to a dozen screens; the decision — his status, the game, your move in each league —
 * now fits the first, and the reference sections (news, market value, depth chart, who'd start, the
 * season) are one tap each.
 *
 * The toggle is phone-only CSS and the body is hidden only while folded on a phone, so a desktop
 * reader never sees a toggle and never loses a section.
 *
 * ⚠ NOT `<details>`: a closed one still counts as present to every visibility check this repo runs,
 * and its open state cannot be told apart by width. Here the body stays in the DOM either way and
 * only the phone stylesheet hides it.
 */
export function PhoneFold({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const { language } = useOptionalLanguage()
  const t = leagueActionsCopy(language)
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="af-pf-fold" data-open={open ? 'true' : 'false'}>
      <button type="button" className="af-pf-fold-toggle" aria-expanded={open} aria-label={open ? t.foldHide(title) : t.foldShow(title)} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span aria-hidden className="af-pf-fold-caret">
          ▾
        </span>
      </button>
      <div className="af-pf-fold-body">{children}</div>
    </div>
  )
}

export default PhoneFold
