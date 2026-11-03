'use client'

import { useEffect, useState } from 'react'
import { Lock, Sparkles } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { taxiRulesInPlainWords, teamsOverTaxiLimit } from '@/lib/taxi/taxiRulesPlainWords'

type TaxiHeld = { teamName: string; count: number }

/**
 * How many taxi players each team holds, from the taxi-steals view (lib/taxi/taxiStealingService.ts),
 * which already loads every roster for a dynasty league on AllFantasy and lists the counts for a
 * commissioner. Anything else — an imported league (`supported: false`), a member, an error — yields
 * null, and the lock warning simply does not show: no count is ever guessed.
 */
function useTaxiHeld(leagueId: string | null | undefined, enabled: boolean): TaxiHeld[] | null {
  const [held, setHeld] = useState<TaxiHeld[] | null>(null)
  useEffect(() => {
    if (!enabled || !leagueId) {
      setHeld(null)
      return
    }
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/taxi-steals`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { view?: { supported?: boolean; taxiHeld?: TaxiHeld[] } } | null) => {
        if (cancelled) return
        const list = d?.view?.supported ? d.view.taxiHeld : undefined
        setHeld(Array.isArray(list) && list.length > 0 ? list : null)
      })
      .catch(() => {
        if (!cancelled) setHeld(null)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabled])
  return held
}

/** The over-the-limit warning, or nothing. Exported for the tests. */
export function TaxiLockWarning({ held, slots, className }: { held: TaxiHeld[] | null; slots: number; className?: string }) {
  const { tInterpolate } = useOptionalLanguage()
  if (!held) return null
  const over = teamsOverTaxiLimit(held, slots)
  if (over.length === 0) return null
  const vars = { count: over.length, slots, teams: over.join(', ') }
  const key = slots === 0 ? (over.length === 1 ? 'taxiPanel.overOffOne' : 'taxiPanel.overOff') : over.length === 1 ? 'taxiPanel.overOne' : 'taxiPanel.over'
  return (
    <div
      role="status"
      data-testid="taxi-lock-warning"
      className={`${className ?? ''} flex items-start gap-3 rounded-xl border border-[rgba(240,122,74,0.35)] bg-[rgba(240,122,74,0.1)] px-4 py-3`}
    >
      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#FFB394]" strokeWidth={1.8} aria-hidden="true" />
      <div className="space-y-1 text-[13px] leading-relaxed text-[#FFD3C2]">
        <p>{tInterpolate(key, vars)}</p>
        <p className="text-[12px] text-[#FFD3C2]/80">{tInterpolate('taxiPanel.overHint')}</p>
      </div>
    </div>
  )
}

/**
 * "What this changes": the taxi squad's current values in plain words, for a dynasty league only. It
 * reads the values the editor is showing, so it follows each change as the commissioner makes it.
 *
 * No "league chat will say" preview: a settings save publishes a `settings_changed` league event
 * (notifications and the league home's What changed card), not a league chat post, so there is no
 * chat line to preview.
 */
export function TaxiRulesExplainer({
  slots,
  yearsLimit,
  allowNonRookies,
}: {
  slots: number
  yearsLimit: number
  allowNonRookies: boolean
}) {
  const { tInterpolate } = useOptionalLanguage()
  const lines = taxiRulesInPlainWords({ slots, yearsLimit, allowNonRookies })
  return (
    <aside
      data-testid="taxi-what-this-changes"
      aria-labelledby="taxi-what-this-changes-title"
      className="space-y-3 rounded-2xl border border-[color:var(--dyn-rail,#1C2333)] bg-[color:var(--dyn-vault,#121826)] p-4"
    >
      <h5
        id="taxi-what-this-changes-title"
        className="text-[13px] font-bold uppercase tracking-[0.1em] text-[color:var(--dyn-faint,#9AA4B2)]"
        style={{ fontFamily: "var(--font-archivo,'Archivo',system-ui,sans-serif)", fontStretch: '75%' }}
      >
        {tInterpolate('taxiPanel.title')}
      </h5>
      <ul className="space-y-2 text-[13px] leading-relaxed text-[color:var(--dyn-text,#E8ECF2)]">
        {lines.map((l) => (
          <li key={l.key} data-line={l.key}>
            {tInterpolate(l.key, l.vars)}
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 border-t border-[color:var(--dyn-rail,#1C2333)] pt-3 text-[12px] leading-relaxed text-[color:var(--dyn-text2,#C3CAD5)]">
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--dyn-gold,#D4A24C)]" strokeWidth={1.8} aria-hidden="true" />
        <span>{tInterpolate('taxiPanel.chimmy')}</span>
      </p>
    </aside>
  )
}

export { useTaxiHeld }
