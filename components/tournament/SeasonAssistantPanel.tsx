'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { SeasonAssistantContext, SeasonAssistantTopic } from '@/lib/tournament/seasonAssistantContext'

const topics = [
  { id: 'rules', label: 'Scoring and rosters' },
  { id: 'draft', label: 'Draft and schedule' },
  { id: 'standings', label: 'Published standings' },
] as const satisfies ReadonlyArray<{ id: SeasonAssistantTopic; label: string }>

type Answer = {
  response: string
  publication: SeasonAssistantContext['publication']
  report?: SeasonAssistantContext['standings']
  draftHref?: string | null
  draftManifestHash?: string | null
}

export function SeasonAssistantPanel({ tournamentId, leagueId }: { tournamentId: string; leagueId?: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function show(topic: SeasonAssistantTopic | 'os') {
    setPending(true)
    setAnswer(null)
    setError('')
    try {
      if (topic === 'os') {
        const query = new URLSearchParams({ tournamentId, ...(leagueId ? { leagueId } : {}) })
        const response = await fetch('/api/decision-os/manager-command-center?' + query, { cache: 'no-store' })
        if (!response.ok) throw new Error('Could not load the tournament context.')
        const { tournament } = await response.json() as { tournament: SeasonAssistantContext }
        setAnswer({
          response: [
            tournament.sport + ' · ' + tournament.name + ' · Stage ' + tournament.stage.number + ' · ' + tournament.stage.name,
            'Scoring periods ' + tournament.stage.startPeriod + '–' + tournament.stage.endPeriod + ' · ' + tournament.rules.scoring.replaceAll('_', ' '),
            tournament.standings
              ? (tournament.standings.status === 'corrected' ? 'Corrected ' : '')
                + (tournament.standings.official ? 'official' : 'provisional') + ' standings · ' + tournament.standings.summary
              : 'No standings report is available for this stage in your view.',
          ].join('\n\n'),
          publication: tournament.publication,
          report: tournament.standings,
          draftManifestHash: tournament.draft.room?.manifestHash,
          draftHref: leagueId ? null : tournament.draft.assignment?.href,
        })
      } else {
        const response = await fetch('/api/chimmy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userContext: { tournament: { id: tournamentId, topic, leagueId } } }),
        })
        if (!response.ok) throw new Error('Could not load the Chimmy answer.')
        setAnswer(await response.json() as Answer)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Tournament context is unavailable.')
    } finally {
      setPending(false)
    }
  }

  return <section className="space-y-3 rounded-2xl border border-white/15 bg-slate-950 p-5 text-white">
    <h2 className="text-xl font-semibold">Tournament guidance</h2>
    <p className="text-sm text-slate-300">Ask Chimmy about this stage or see the tournament context in AllFantasy OS.</p>
    <div className="flex flex-wrap gap-2">
      {topics.map(topic => <button key={topic.id} type="button" disabled={pending} onClick={() => void show(topic.id)}
        className="min-h-11 rounded-lg border border-cyan-300/40 px-3 text-sm text-cyan-200 disabled:opacity-50">{topic.label}</button>)}
      <button type="button" disabled={pending} onClick={() => void show('os')}
        className="min-h-11 rounded-lg border border-white/30 px-3 text-sm disabled:opacity-50">AllFantasy OS context</button>
    </div>
    {pending && <p role="status" className="text-sm text-slate-300">Loading tournament context…</p>}
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {answer && <div aria-live="polite" className="space-y-3 text-sm">
      <p className="whitespace-pre-line">{answer.response}</p>
      <ul className="space-y-1 text-cyan-200">
        <li><Link href={answer.publication.href}>Published rules</Link> <span className="break-all text-slate-400">· {answer.publication.hash}</span></li>
        {answer.draftManifestHash && <li className="break-all text-slate-400">Frozen draft assignment · {answer.draftManifestHash}</li>}
        {answer.report && <li><a href={answer.report.href}>Period {answer.report.period} standings, revision {answer.report.revision}</a></li>}
        {!leagueId && answer.draftHref && <li><Link href={answer.draftHref}>Open my draft room</Link></li>}
      </ul>
    </div>}
  </section>
}
