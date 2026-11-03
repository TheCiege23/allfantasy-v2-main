'use client'

import { useEffect, useState } from 'react'
import { SettingsSection, SettingsRow } from '@/app/league/[leagueId]/tabs/settings/components'

type CombatRules = {
  bashingThreshold: number
  maulingThreshold: number
  winningsPolicy?: 'beta_2025' | 'legacy_score'
  bashShare: number
  maulShare: number
}

export function ZombieCombatPanel({ leagueId }: { leagueId: string; canEdit: boolean }) {
  const [rules, setRules] = useState<CombatRules | null>(null)
  const [message, setMessage] = useState('Loading combat rules…')

  useEffect(() => {
    let active = true
    void fetch(`/api/zombie/matchups?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load combat rules.')
        return res.json() as Promise<{ rules?: CombatRules }>
      })
      .then((data) => {
        if (!active) return
        if (!data.rules) throw new Error('Combat rules are unavailable.')
        setRules(data.rules)
        setMessage('')
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load combat rules.') })
    return () => { active = false }
  }, [leagueId])

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 sm:px-6">
      <p className="text-[12px] text-white/60">
        These are the effective score margins used by weekly resolution for this sport.
      </p>
      {rules ? (
        <>
          <SettingsSection id="zm-bash" title="Bashing">
            <SettingsRow label="Winning margin" control={<strong>{rules.bashingThreshold}+ points</strong>} />
            <SettingsRow label="Winnings transfer" control={<strong>{rules.winningsPolicy === 'beta_2025' ? 'All accumulated winnings' : `${Math.round(rules.bashShare * 100)}%`}</strong>} />
          </SettingsSection>
          <SettingsSection id="zm-maul" title="Mauling">
            <SettingsRow label="Winning margin" control={<strong>{rules.maulingThreshold}+ points</strong>} />
            <SettingsRow label="Winnings transfer" control={<strong>{rules.winningsPolicy === 'beta_2025' ? 'All accumulated winnings' : `${Math.round(rules.maulShare * 100)}%`}</strong>} />
          </SettingsSection>
          <p className="text-[11px] text-white/55">Combat margins are sport rules and are shown for reference.</p>
        </>
      ) : <p role="status" className="text-amber-200">{message}</p>}
    </div>
  )
}
