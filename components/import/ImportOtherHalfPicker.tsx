'use client'

/**
 * "Where's the college half?" on the import confirm screen, for a C2C or devy league. The commissioner
 * picks one of their leagues already on AllFantasy, says it is not here yet (the done screen then sends
 * them to import it, with this league waiting to be linked), or says there is none. Nothing is guessed:
 * a league is only preselected when this import was opened to be its other half (`/import?pairWith=`).
 *
 * The link itself is made by the import commit (`pairWithLeagueId`), after the league is built.
 */

import { useEffect, useState } from 'react'
import { platformLabel, type OtherHalfChoice } from '@/lib/league-import/otherHalf'

type Candidate = { leagueId: string; name: string; platform: string; sport: string; season: number | null }
type Loaded = { needRole: 'pro' | 'college'; candidates: Candidate[] }

function radioValue(choice: OtherHalfChoice): string {
  return choice.kind === 'link' ? `link:${choice.leagueId}` : choice.kind
}

export function ImportOtherHalfPicker(props: {
  /** The sport the preview read for the league being imported. */
  sport: string
  /** A league this import was opened to pair with; preselected when it is one of the candidates. */
  preferLeagueId?: string | null
  value: OtherHalfChoice
  onChange: (next: OtherHalfChoice) => void
  /** Injected in tests; the real one asks the link endpoint. */
  load?: (sport: string) => Promise<Loaded | null>
}) {
  const { sport, preferLeagueId, value, onChange, load } = props
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setLoaded(null)
    setFailed(false)
    const read =
      load ??
      (async (s: string) => {
        const res = await fetch(`/api/league/college-pro-roster/link?sport=${encodeURIComponent(s)}`, { cache: 'no-store' })
        return res.ok ? ((await res.json()) as Loaded) : null
      })
    read(sport)
      .then((data) => {
        if (!live) return
        if (!data) {
          setFailed(true)
          return
        }
        setLoaded(data)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [sport, load])

  // Preselect the league this import was opened for, once, if it is really one of the choices.
  useEffect(() => {
    if (!loaded || !preferLeagueId || value.kind !== 'none') return
    const match = loaded.candidates.find((c) => c.leagueId === preferLeagueId)
    if (match) onChange({ kind: 'link', leagueId: match.leagueId, name: match.name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, preferLeagueId])

  const half = loaded?.needRole === 'pro' ? 'pro' : 'college'
  const selected = radioValue(value)
  const pick = (next: OtherHalfChoice) => onChange(next)

  return (
    <fieldset className="af-im-other-half" data-testid="import-other-half">
      <legend className="af-label">Where’s the {half} half?</legend>
      <p className="af-im-field-help">
        Link the two leagues and every manager sees one league, with both rosters and both scores.
      </p>
      {!loaded && !failed ? (
        <p className="af-im-field-help" data-testid="import-other-half-loading">
          Looking for your leagues…
        </p>
      ) : null}
      {failed ? (
        <p className="af-im-field-help" data-testid="import-other-half-failed">
          We couldn’t load your leagues. You can still link them later from Connect leagues.
        </p>
      ) : null}
      <div className="af-im-other-half-list" role="radiogroup" aria-label={`The ${half} half`}>
        {loaded?.candidates.map((c) => (
          <label key={c.leagueId} className="af-im-other-half-option" data-selected={selected === `link:${c.leagueId}` ? 'true' : undefined}>
            <input
              type="radio"
              name="import-other-half"
              value={`link:${c.leagueId}`}
              checked={selected === `link:${c.leagueId}`}
              onChange={() => pick({ kind: 'link', leagueId: c.leagueId, name: c.name })}
            />
            <span className="af-im-other-half-text">
              <span className="af-im-other-half-name">{c.name}</span>
              <span className="af-im-other-half-meta">
                {[platformLabel(c.platform), c.sport, c.season].filter(Boolean).join(' · ')}
              </span>
            </span>
          </label>
        ))}
        {loaded && loaded.candidates.length === 0 ? (
          <p className="af-im-field-help" data-testid="import-other-half-empty">
            None of your {half} leagues on AllFantasy are free to link.
          </p>
        ) : null}
        <label className="af-im-other-half-option" data-selected={selected === 'later' ? 'true' : undefined}>
          <input type="radio" name="import-other-half" value="later" checked={selected === 'later'} onChange={() => pick({ kind: 'later' })} />
          <span className="af-im-other-half-text">
            <span className="af-im-other-half-name">It’s not on AllFantasy yet</span>
            <span className="af-im-other-half-meta">Import it next, from any platform. We’ll link the two.</span>
          </span>
        </label>
        <label className="af-im-other-half-option" data-selected={selected === 'none' ? 'true' : undefined}>
          <input type="radio" name="import-other-half" value="none" checked={selected === 'none'} onChange={() => pick({ kind: 'none' })} />
          <span className="af-im-other-half-text">
            <span className="af-im-other-half-name">There’s no other half</span>
          </span>
        </label>
      </div>
    </fieldset>
  )
}
