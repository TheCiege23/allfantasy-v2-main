'use client'

import { useMemo, useState } from 'react'
import { BracketTreeView } from '@/components/bracket/BracketTreeView'

type HarnessNode = {
  id: string
  slot: string
  round: number
  region: string | null
  seedHome: number | null
  seedAway: number | null
  homeTeamName: string | null
  awayTeamName: string | null
  sportsGameId: string | null
  nextNodeId: string | null
  nextNodeSide: string | null
  game: null
}

const HARNESS_NODES: HarnessNode[] = [
  {
    id: 'r1g1',
    slot: 'R1-G1',
    round: 1,
    region: null,
    seedHome: 1,
    seedAway: 8,
    homeTeamName: 'NFL Seed 1',
    awayTeamName: 'NFL Seed 8',
    sportsGameId: null,
    nextNodeId: 'r2g1',
    nextNodeSide: 'home',
    game: null,
  },
  {
    id: 'r1g2',
    slot: 'R1-G2',
    round: 1,
    region: null,
    seedHome: 4,
    seedAway: 5,
    homeTeamName: 'NFL Seed 4',
    awayTeamName: 'NFL Seed 5',
    sportsGameId: null,
    nextNodeId: 'r2g1',
    nextNodeSide: 'away',
    game: null,
  },
  {
    id: 'r1g3',
    slot: 'R1-G3',
    round: 1,
    region: null,
    seedHome: 2,
    seedAway: 7,
    homeTeamName: 'NFL Seed 2',
    awayTeamName: 'NFL Seed 7',
    sportsGameId: null,
    nextNodeId: 'r2g2',
    nextNodeSide: 'home',
    game: null,
  },
  {
    id: 'r1g4',
    slot: 'R1-G4',
    round: 1,
    region: null,
    seedHome: 3,
    seedAway: 6,
    homeTeamName: 'NFL Seed 3',
    awayTeamName: 'NFL Seed 6',
    sportsGameId: null,
    nextNodeId: 'r2g2',
    nextNodeSide: 'away',
    game: null,
  },
  {
    id: 'r2g1',
    slot: 'R2-G1',
    round: 2,
    region: null,
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    sportsGameId: null,
    nextNodeId: 'r3g1',
    nextNodeSide: 'home',
    game: null,
  },
  {
    id: 'r2g2',
    slot: 'R2-G2',
    round: 2,
    region: null,
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    sportsGameId: null,
    nextNodeId: 'r3g1',
    nextNodeSide: 'away',
    game: null,
  },
  {
    id: 'r3g1',
    slot: 'R3-G1',
    round: 3,
    region: null,
    seedHome: null,
    seedAway: null,
    homeTeamName: null,
    awayTeamName: null,
    sportsGameId: null,
    nextNodeId: null,
    nextNodeSide: null,
    game: null,
  },
]

const INITIAL_PICKS: Record<string, string | null> = {}

export function BracketChallengeHarnessClient() {
  const [open, setOpen] = useState(false)
  const [entryCreated, setEntryCreated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string>('')
  const [readOnly, setReadOnly] = useState(false)
  const [entryName, setEntryName] = useState('Harness Entry')
  const [tiebreakPoints, setTiebreakPoints] = useState('')

  const totalGames = useMemo(() => HARNESS_NODES.filter((n) => n.round >= 1).length, [])

  async function handleSubmitBracket() {
    setSubmitting(true)
    setSubmitMessage('')
    try {
      const res = await fetch('/api/bracket/entries/e2e-entry/submit', { method: 'POST' })
      if (res.ok) {
        setSubmitMessage('Bracket submitted')
      } else {
        setSubmitMessage('Submit failed')
      }
    } catch {
      setSubmitMessage('Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <main className="min-h-screen bg-[#040915] p-6 text-white space-y-4">
        <h1 className="text-xl font-semibold">E2E Bracket Challenge Harness</h1>
        <p className="text-sm text-white/60">
          Open the bracket challenge shell to validate picks, save/submit, leaderboard links, lock states, and mobile navigation.
        </p>
        <button
          type="button"
          data-testid="bracket-open-challenge-button"
          onClick={() => setOpen(true)}
          className="rounded border border-cyan-500/40 bg-cyan-500/20 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-500/30"
        >
          Open bracket challenge
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#040915] p-4 text-white space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="bracket-harness-back-button"
          onClick={() => setOpen(false)}
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          Back
        </button>
        <button
          type="button"
          data-testid="bracket-edit-toggle-button"
          onClick={() => setReadOnly((v) => !v)}
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          {readOnly ? 'Unlock edits' : 'Lock edits'}
        </button>
        <a
          href="#leaderboard"
          data-testid="bracket-leaderboard-link"
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          Leaderboard
        </a>
        <a
          href="#scoring"
          data-testid="bracket-scoring-info-link"
          className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
        >
          How scoring works
        </a>
        {!entryCreated && (
          <button
            type="button"
            data-testid="bracket-create-bracket-button"
            onClick={() => setEntryCreated(true)}
            className="rounded bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-900"
          >
            Create bracket
          </button>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <label className="text-xs font-semibold block">
          Entry name
          <input
            value={entryName}
            onChange={(e) => setEntryName(e.target.value)}
            data-testid="bracket-entry-name-input"
            className="mt-1 w-full rounded-md border border-white/15 bg-black/25 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs font-semibold block">
          Tie-break points
          <input
            value={tiebreakPoints}
            onChange={(e) => setTiebreakPoints(e.target.value.replace(/[^0-9]/g, ''))}
            data-testid="bracket-tiebreak-input"
            className="mt-1 w-full rounded-md border border-white/15 bg-black/25 px-2 py-1.5 text-sm"
          />
        </label>
        <p className="text-xs text-white/65" data-testid="bracket-lock-state-message">
          {readOnly ? 'Picks are locked for this harness entry.' : 'Picks are editable and auto-save on click.'}
        </p>
      </div>

      {entryCreated ? (
        <>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <BracketTreeView
              tournamentId="e2e-tournament"
              leagueId="e2e-league"
              entryId="e2e-entry"
              nodes={HARNESS_NODES}
              initialPicks={INITIAL_PICKS}
              readOnly={readOnly}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="bracket-submit-bracket-button"
              onClick={handleSubmitBracket}
              disabled={submitting}
              className="rounded bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit bracket'}
            </button>
            <span className="text-xs text-white/70" data-testid="bracket-submit-message">
              {submitMessage || `Games: ${totalGames}`}
            </span>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60" data-testid="bracket-empty-state">
          Create a bracket entry to start making picks.
        </div>
      )}

      <section id="leaderboard" className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
        Leaderboard section
      </section>
      <section id="scoring" className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
        Scoring information section
      </section>
    </main>
  )
}
