'use client'

/**
 * Which of my teams am I running right now?
 *
 * Shown only to a manager who runs more than one team in this league (lib/league/multiTeamManagers.ts).
 * Switching remembers the team on the server (POST /api/leagues/[leagueId]/my-teams), which every lineup,
 * waiver, trade and draft request then acts on, and reloads the league so every screen shows that team.
 */
import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Team = { rosterId: string; teamName: string }

export function ActiveTeamSwitcher({ leagueId, onSwitched }: { leagueId: string; onSwitched?: (rosterId: string) => void }) {
  const { t } = useLanguage()
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/my-teams`
  const [teams, setTeams] = useState<Team[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch(endpoint, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { teams?: Team[]; activeRosterId?: string | null } | null) => {
        if (!live || !data) return
        setTeams(Array.isArray(data.teams) ? data.teams : [])
        setActive(data.activeRosterId ?? null)
      })
      .catch(() => {})
    return () => { live = false }
  }, [endpoint])

  // One team (or none): nothing to choose, nothing to show.
  if (teams.length < 2) return null

  async function switchTo(rosterId: string) {
    if (rosterId === active || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rosterId }) })
      if (!res.ok) { setFailed(true); return }
      setActive(rosterId)
      if (onSwitched) onSwitched(rosterId)
      // Every screen read the other team; load them again for this one.
      else window.location.reload()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="mx-auto mb-3 flex w-full max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2"
      data-testid="active-team-switcher"
    >
      <label htmlFor="af-active-team" className="text-[12px] font-semibold text-white/80">{t('teamSwitcher.label')}</label>
      <select
        id="af-active-team"
        className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0a1220] px-3 text-[13px] text-white sm:flex-none sm:min-w-[220px]"
        value={active ?? ''}
        disabled={busy}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {teams.map((team) => (
          <option key={team.rosterId} value={team.rosterId}>{team.teamName}</option>
        ))}
      </select>
      <span className="text-[11px] text-white/50">{t('teamSwitcher.help').replace('{{n}}', String(teams.length))}</span>
      {failed ? <span role="alert" className="text-[11px] text-red-300">{t('teamSwitcher.failed')}</span> : null}
    </div>
  )
}
