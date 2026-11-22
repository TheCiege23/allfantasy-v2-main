'use client'

/**
 * Which of my teams am I running right now?
 *
 * Shown only to a manager who runs more than one team in this league (lib/league/multiTeamManagers.ts).
 * Switching remembers the team on the server (POST /api/leagues/[leagueId]/my-teams), which every lineup,
 * waiver, trade and draft request then acts on, and reloads the league so every screen shows that team.
 *
 * `variant="auction"` is the same control inside the auction room: "Bidding as". A bid spends one
 * team's budget, so the server never guesses the team (lib/live-draft-engine/auction/multiTeamAuction.ts).
 * There the team shown is confirmed to the server when the room opens, so the team on screen is always
 * the team a bid is placed for, and switching refreshes the room instead of reloading the page.
 */
import { useEffect, useId, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type Team = { rosterId: string; teamName: string }

export function ActiveTeamSwitcher({ leagueId, onSwitched, variant = 'header' }: { leagueId: string; onSwitched?: (rosterId: string) => void; variant?: 'header' | 'auction' }) {
  const selectId = useId()
  const auction = variant === 'auction'
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
        const list = Array.isArray(data.teams) ? data.teams : []
        setTeams(list)
        setActive(data.activeRosterId ?? null)
        // In the auction room, make the server's remembered team the one shown, so a bid is never
        // refused (or placed for another team) because no team had been switched to yet.
        if (auction && list.length > 1 && data.activeRosterId) {
          void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rosterId: data.activeRosterId }) }).catch(() => {})
        }
      })
      .catch(() => {})
    return () => { live = false }
  }, [endpoint, auction])

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
      className={auction
        ? 'flex w-full flex-wrap items-center gap-2 border-b border-amber-300/20 bg-amber-400/[0.07] px-3 py-2'
        : 'mx-auto mb-3 flex w-full max-w-5xl flex-wrap items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2'}
      data-testid={auction ? 'auction-team-picker' : 'active-team-switcher'}
    >
      <label htmlFor={selectId} className="text-[12px] font-semibold text-white/80">{t(auction ? 'teamSwitcher.auctionLabel' : 'teamSwitcher.label')}</label>
      <select
        id={selectId}
        className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0a1220] px-3 text-[13px] text-white sm:flex-none sm:min-w-[220px]"
        value={active ?? ''}
        disabled={busy}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {teams.map((team) => (
          <option key={team.rosterId} value={team.rosterId}>{team.teamName}</option>
        ))}
      </select>
      <span className="text-[11px] text-white/50">{t(auction ? 'teamSwitcher.auctionHelp' : 'teamSwitcher.help').replace('{{n}}', String(teams.length))}</span>
      {failed ? <span role="alert" className="text-[11px] text-red-300">{t('teamSwitcher.failed')}</span> : null}
    </div>
  )
}
