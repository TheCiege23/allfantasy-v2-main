'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { finderCopy } from '@/lib/core-app/playerFinderCopy'
import type { PlayerMatch } from '@/lib/core-app/playerFinder'
import { FilterChips } from '@/components/core-app/primitives/FilterChips'

const ALL = '__all__'

/**
 * The matches' positions, in the order they first appear — the chips the filter offers. Only positions
 * a match actually has: a chip for a position with nobody under it would filter the list to nothing.
 */
export function matchPositions(matches: Pick<PlayerMatch, 'position'>[]): string[] {
  const seen: string[] = []
  for (const m of matches) {
    const p = (m.position ?? '').trim().toUpperCase()
    if (p && !seen.includes(p)) seen.push(p)
  }
  return seen
}

/**
 * Position chips over the search matches (Player Finder). Narrows the list in place — the search
 * itself, its URL and the matches the server sent are untouched, so "All" is always one tap back.
 */
export function MatchPositionFilter({
  options,
  value,
  onChange,
  total,
}: {
  options: string[]
  value: string | null
  onChange: (next: string | null) => void
  total: number
}) {
  const { language } = useOptionalLanguage()
  const t = finderCopy(language)
  /* The shared FilterChips: "All" is a chip of its own, so `null` travels as an id no position has. */
  return (
    <FilterChips
      className="af-pf-posfilter"
      ariaLabel={t.posFilterAria(total)}
      value={value ?? ALL}
      onChange={(next) => onChange(next === ALL ? null : next)}
      options={[{ id: ALL, label: t.posAll }, ...options.map((p) => ({ id: p, label: p }))]}
    />
  )
}
