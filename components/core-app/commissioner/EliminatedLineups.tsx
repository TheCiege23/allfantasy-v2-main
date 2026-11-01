'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { commissionerScreensMessages } from '@/lib/core-app/messages/commissionerScreens'
import type { EliminatedLineupView } from '@/lib/eliminated-lineups/eliminatedLineupService'
import type { LineupStandard } from '@/lib/eliminated-lineups/eliminatedLineups'

/**
 * Lineup minimums for eliminated teams (lib/eliminated-lineups), on the Commissioner Hub. The rule is
 * AF Commissioner; the list of teams out of the race, and what each lineup is short of, is shown either
 * way so a commissioner can see what the rule would do before turning it on. The route enforces the
 * plan; this card only reflects what it was told.
 */

type M = typeof commissionerScreensMessages.en

const REFUSED: Record<string, (m: M) => string> = {
  no_season: (m) => m.eliminatedRefusedNoSeason,
  no_playoff_size: (m) => m.eliminatedRefusedNoPlayoffSize,
}

export function EliminatedLineups({ leagueId }: { leagueId: string }) {
  const m = useMessages(commissionerScreensMessages)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/eliminated-lineups`
  const [view, setView] = useState<EliminatedLineupView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [standard, setStandard] = useState<LineupStandard>('playable')
  const [autoFill, setAutoFill] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      const body = (await r.json()) as EliminatedLineupView
      setView(body)
      if (body.supported) {
        setEnabled(Boolean(body.rule))
        setStandard(body.rule?.standard ?? 'playable')
        setAutoFill(body.rule ? body.rule.autoFill : true)
      }
    } catch {
      setMessage(m.commonPermissionRequired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: enabled ? { enabled: true, standard, autoFill } : { enabled: false } }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(enabled ? m.eliminatedSavedOn : m.eliminatedSavedOff)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.commonCouldNotSaveRefresh)
    } finally {
      setBusy(false)
    }
  }

  if (view && !view.supported && !REFUSED[view.reason]) return null

  return (
    <section id="ch-eliminated-lineups" className="af-tw af-tw-panel" data-testid="eliminated-lineups">
      <h2>{m.eliminatedTitle}</h2>
      <p>
        {m.eliminatedIntro}
      </p>
      {view === null && !message ? <p role="status">{m.commonLoading}</p> : null}
      {view && !view.supported ? <p>{REFUSED[view.reason]!(m)}</p> : null}

      {view?.supported ? (
        <>
          {!view.available ? (
            <p data-testid="eliminated-lineups-plan">{m.eliminatedPlan}</p>
          ) : null}
          <fieldset disabled={busy || (!view.available && !view.rule)}>
            <label>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
              {m.eliminatedRuleOn}
            </label>
            {enabled ? (
              <>
                <label>
                  <input type="radio" name="eliminated-standard" checked={standard === 'filled'} onChange={() => setStandard('filled')} />{' '}
                  {m.eliminatedStandardFilled}
                </label>
                <label>
                  <input type="radio" name="eliminated-standard" checked={standard === 'playable'} onChange={() => setStandard('playable')} />{' '}
                  {m.eliminatedStandardPlayable}
                </label>
                <label>
                  <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFill(e.target.checked)} />{' '}
                  {m.eliminatedAutoFill}
                </label>
              </>
            ) : null}
            <button type="button" className="af-btn" onClick={() => void save()}>
              {busy ? m.commonSaving : m.commonSave}
            </button>
          </fieldset>

          <h3>{view.week != null ? m.eliminatedOutWeek(view.week) : m.eliminatedOut}</h3>
          {view.teams.length === 0 ? (
            <p>{m.eliminatedEveryTeamCanReach(view.playoffTeams)}</p>
          ) : (
            <ul>
              {view.teams.map((team) => (
                <li key={team.rosterId} data-testid="eliminated-lineups-team">
                  <strong>{team.teamName}</strong>{' '}
                  {team.reason === 'missed_playoffs' ? m.eliminatedMissedPlayoffs : m.eliminatedCannotReach}{' '}
                  {team.text ? m.eliminatedShort(team.text) : team.shortfall ? m.eliminatedMeetsStandard : m.eliminatedUnreadable}
                  {team.managedByAllFantasy ? m.eliminatedManagedByAf : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  )
}
