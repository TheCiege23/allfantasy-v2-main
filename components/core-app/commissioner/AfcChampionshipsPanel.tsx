'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { afcStatus, afcTeams, isAfcSeed, type AfcPairing, type AfcRound, type AfcSeed } from '@/lib/afc-championships/bracket'

type Draft = { round: number; revision: number; pairings: AfcPairing[] }
const actionClass = 'rounded border border-current px-3 py-2 text-sm font-medium disabled:opacity-50'
const score = (value: number | null) => value == null ? '—' : value.toFixed(2)
const team = (seed: AfcSeed | null) => seed == null ? 'TBD' : `#${seed} ${afcTeams[seed]}`

export function AfcChampionshipsPanel({
  leagueId,
  bracket,
}: {
  leagueId: string
  bracket: { revision: number; rounds: AfcRound[] } | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const path = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/afc-championships`

  useEffect(() => {
    if (!bracket || draft) return
    const timer = window.setInterval(() => router.refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [bracket, draft, router])

  async function save(method: 'POST' | 'PUT', payload?: { round: number; revision: number; pairings: AfcPairing[] | null }) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(path, {
        method,
        ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Save failed')
      setDraft(null)
      setMessage(method === 'POST' ? 'Staging bracket loaded.' : 'Pairings saved.')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!bracket) {
    return (
      <section className="space-y-3">
        <p>Load the 17-team staging bracket and replay the first two rounds.</p>
        <button type="button" className={actionClass} disabled={saving} onClick={() => void save('POST')}>Load staging bracket</button>
        {message && <p role="status">{message}</p>}
      </section>
    )
  }

  function edit(round: AfcRound) {
    if (!round.canOverride || !bracket) return
    const pairings = round.games.flatMap(({ away, home }) => away == null || home == null ? [] : [{ away, home }])
    setMessage('')
    setDraft({ round: round.number, revision: bracket.revision, pairings })
  }

  return (
    <div className="space-y-5">
      <p>Teams advance when both AF scores are final. You can change the next round’s pairings before scoring starts.</p>
      {message && <p role="status" className="text-sm">{message}</p>}
      {bracket.rounds.map(round => (
        <section key={round.number} aria-labelledby={`afc-round-${round.number}`} className="space-y-3 rounded-md border border-current/25 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`afc-round-${round.number}`} className="text-lg font-semibold">Round {round.number} <span className="text-sm font-normal">· Week {round.week}</span></h2>
            {round.canOverride && !draft && <button className={actionClass} type="button" onClick={() => edit(round)}>Override matchups</button>}
          </div>
          {round.overrideNeedsReview && <p role="status">An earlier result changed who advanced. Review these pairings before the round starts.</p>}
          {draft?.round === round.number ? (
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save('PUT', draft) }}>
              {draft.pairings.map((pair, index) => (
                <fieldset key={index} className="grid gap-2 sm:grid-cols-2">
                  <legend className="text-sm">Matchup {index + 1}</legend>
                  {(['away', 'home'] as const).map(side => (
                    <label key={side} className="flex flex-col gap-1 text-sm">
                      {side === 'away' ? 'Away team' : 'Home team'}
                      <select
                        className="rounded border border-neutral-500 bg-white p-2 text-neutral-950"
                        value={pair[side]}
                        disabled={saving}
                        onChange={event => {
                          const seed = Number(event.target.value)
                          if (!isAfcSeed(seed)) return
                          setDraft({ ...draft, pairings: draft.pairings.map((row, i) => i === index ? { ...row, [side]: seed } : row) })
                        }}
                      >
                        {round.defaults.flat().filter(seed => seed != null).sort((a, b) => a - b).map(seed =>
                          <option key={seed} value={seed}>{team(seed)}</option>,
                        )}
                      </select>
                    </label>
                  ))}
                </fieldset>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={actionClass} disabled={saving}>Save matchups</button>
                {round.overridden && <button type="button" className={actionClass} disabled={saving} onClick={() => void save('PUT', { ...draft, pairings: null })}>Restore generated matchups</button>}
                <button type="button" className={actionClass} disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr><th scope="col">Away</th><th scope="col">Home</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {round.games.map(game => (
                    <tr key={game.id} className="border-t border-current/20">
                      <td className="p-2 pl-0">{team(game.away)} {score(game.awayPoints)}</td>
                      <td className="p-2">{team(game.home)} {score(game.homePoints)}</td>
                      <td className="p-2">{game.winner == null ? afcStatus[game.status] : `${team(game.winner)} ${round.number === bracket.rounds.length ? 'wins the bracket' : 'advances'}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
