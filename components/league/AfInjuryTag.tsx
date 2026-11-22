import { injuryTag, injuryTone } from '@/lib/injuries/afInjuryTag'

/**
 * AF's injury tag on the league page — "Q", "D", "OUT", "IR" — drawn the same way as /core's
 * matchup (an uncertainty in amber, never the red of OUT). Styles: components/league/league-type-skin.css.
 */
export function AfInjuryTag({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status || !status.trim()) return null
  const tag = injuryTag(status)
  return (
    <span className={className ? `af-inj-tag ${className}` : 'af-inj-tag'} data-tone={injuryTone(tag)} title={status}>
      {tag}
    </span>
  )
}
