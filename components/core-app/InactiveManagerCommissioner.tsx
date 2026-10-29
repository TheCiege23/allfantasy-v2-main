'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { inactiveManagerCommissionerMessages } from '@/lib/core-app/messages/inactiveManagerCommissioner'

type AutopilotStyle = 'dynasty_owner' | 'win_now' | 'rebuild'

type Team = {
  rosterId: string
  teamName: string | null
  managerName: string | null
  status: 'active' | 'at_risk' | 'inactive' | 'unknown'
  managed: { since: string; byUserId: string; autopilot?: { style: AutopilotStyle; since: string } } | null
  suggested: boolean
}

/**
 * Inactive manager mode (lib/inactive-manager): the commissioner hands an away manager's lineup to
 * AllFantasy, which sets the projected-best lineup each week until the manager saves one themselves.
 * AllFantasy suggests the teams manager health calls inactive; only the commissioner turns it on.
 */
export function InactiveManagerCommissioner({ leagueId }: { leagueId: string }) {
  const m = useMessages(inactiveManagerCommissionerMessages)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/inactive-managers`
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [native, setNative] = useState(true)
  const [entitled, setEntitled] = useState(false)
  const [draftAsMe, setDraftAsMeState] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as { native: boolean; autopilotEntitled?: boolean; draftAsMe?: boolean; teams: Team[] }
      setNative(body.native)
      setEntitled(Boolean(body.autopilotEntitled))
      setDraftAsMeState(body.draftAsMe !== false)
      setTeams(body.teams)
    } catch {
      setMessage(m.loadFailed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (team: Team) => {
    setBusy(team.rosterId)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: team.rosterId, on: !team.managed }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(team.managed ? m.stopped : m.turnedOn)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.saveFailed)
    } finally {
      setBusy(null)
    }
  }

  /** Chimmy autopilot (AF Commissioner): `style: null` takes it off and leaves lineup management running. */
  const setAutopilot = async (team: Team, style: AutopilotStyle | null) => {
    setBusy(team.rosterId)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId: team.rosterId, autopilot: style }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(
        style
          ? m.autopilotOn
          : m.autopilotOff,
      )
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.saveFailed)
    } finally {
      setBusy(null)
    }
  }
  /** Draft as me (AF Commissioner): a missed draft pick is made the way that manager drafts. */
  const toggleDraftAsMe = async (on: boolean) => {
    setBusy('draft-as-me')
    setMessage('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftAsMe: on }) })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setDraftAsMeState(on)
      setMessage(
        on
          ? m.draftAsMeOn
          : m.draftAsMeOff,
      )
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.saveFailed)
    } finally {
      setBusy(null)
    }
  }

  const styleLabel = (style: AutopilotStyle) =>
    style === 'dynasty_owner'
      ? m.styleDynastyOwner
      : style === 'win_now'
        ? m.styleWinNow
        : m.styleRebuild

  if (!native) return null
  const name = (team: Team) => team.teamName || team.managerName || m.team
  const shown = (teams ?? []).filter((team) => team.managed || team.suggested)
  const others = (teams ?? []).filter((team) => !team.managed && !team.suggested)

  return (
    <section id="ch-inactive-managers" className="af-tw af-tw-panel" data-testid="inactive-manager-mode">
      <h2>{m.title}</h2>
      <p>
        {m.intro}
      </p>
      <p data-testid="draft-as-me-toggle">
        {entitled ? (
          <label>
            <input type="checkbox" checked={draftAsMe} disabled={busy !== null} onChange={(e) => void toggleDraftAsMe(e.target.checked)} />{' '}
            {m.draftAsMeToggle}
          </label>
        ) : (
          <a href="/commissioner-upgrade?highlight=draft_as_me">
            {m.draftAsMeUpsell}
          </a>
        )}
      </p>
      {teams === null ? <p role="status">{m.loadingTeams}</p> : null}
      {teams && shown.length === 0 ? <p>{m.noneInactive}</p> : null}
      <ul>
        {shown.map((team) => (
          <li key={team.rosterId} data-testid="inactive-manager-team">
            <strong>{name(team)}</strong>{' '}
            {team.managed
              ? m.managedSince(new Date(team.managed.since).toLocaleDateString(getAppIntlLocale()))
              : m.suggested}{' '}
            <button type="button" className="af-btn" disabled={busy !== null} onClick={() => void toggle(team)}>
              {busy === team.rosterId ? m.saving : team.managed ? m.stop : m.letAllFantasySet}
            </button>
            <span className="af-tw-autopilot" data-testid="chimmy-autopilot">
              {entitled ? (
                <label>
                  {m.chimmyAutopilot}{' '}
                  <select
                    value={team.managed?.autopilot?.style ?? ''}
                    disabled={busy !== null}
                    onChange={(e) => void setAutopilot(team, (e.target.value || null) as AutopilotStyle | null)}
                  >
                    <option value="">{m.off}</option>
                    <option value="dynasty_owner">{styleLabel('dynasty_owner')}</option>
                    <option value="win_now">{styleLabel('win_now')}</option>
                    <option value="rebuild">{styleLabel('rebuild')}</option>
                  </select>
                </label>
              ) : (
                <a href="/commissioner-upgrade?highlight=chimmy_autopilot">
                  {m.autopilotUpsell}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
      {others.length > 0 ? (
        <details>
          <summary>{m.otherTeams}</summary>
          <ul>
            {others.map((team) => (
              <li key={team.rosterId}>
                {name(team)}{' '}
                <button type="button" className="af-btn" disabled={busy !== null} onClick={() => void toggle(team)}>
                  {m.letAllFantasySet}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
