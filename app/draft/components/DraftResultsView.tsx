'use client'

import { useState } from 'react'
import { DraftBoard } from './DraftBoard'
import { PlanRefusalNotice } from '@/components/monetization/PlanRefusalNotice'
import { currentPathForReturn, readPlanRefusal, type PlanRefusal } from '@/lib/monetization/planRefusal'
import type { DraftPickRecord, DraftPickOrderEntry, DraftStatePayload } from '../types'

type Props = {
  state: DraftStatePayload
  picks: DraftPickRecord[]
  sessionId: string
}

export function DraftResultsView({ state, picks, sessionId }: Props) {
  const [recap, setRecap] = useState<string | null>(null)
  const [grade, setGrade] = useState<string | null>(null)
  // Grade and Recap are AF Pro / AF Supreme with a daily cap (owner, 2026-11-28): show the plan and its link.
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null)
  const order = (state.pickOrder ?? []) as DraftPickOrderEntry[]

  const runRecap = async () => {
    const r = await fetch('/api/draft/ai/draft-recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, picks }),
    })
    const j = (await r.json().catch(() => ({}))) as { result?: unknown }
    const refused = r.ok ? null : readPlanRefusal(r.status, j, { returnTo: currentPathForReturn() })
    setRefusal(refused)
    if (refused) return
    setRecap(JSON.stringify(j.result ?? j, null, 2))
  }

  const runGrade = async () => {
    const r = await fetch('/api/draft/ai/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, picks }),
    })
    const j = (await r.json().catch(() => ({}))) as { result?: unknown }
    const refused = r.ok ? null : readPlanRefusal(r.status, j, { returnTo: currentPathForReturn() })
    setRefusal(refused)
    if (refused) return
    setGrade(JSON.stringify(j.result ?? j, null, 2))
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-bold text-white">Draft results</h2>
      <DraftBoard
        numTeams={state.numTeams}
        numRounds={state.numRounds}
        pickOrder={order}
        picks={picks}
        currentOverall={state.numTeams * state.numRounds + 1}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runGrade()}
          className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-black"
        >
          Grade My Draft
        </button>
        <button
          type="button"
          onClick={() => void runRecap()}
          className="rounded-lg border border-white/[0.12] px-4 py-2 text-sm text-white/80"
        >
          Generate Recap
        </button>
        <button
          type="button"
          onClick={() => {
            const url = `${typeof window !== 'undefined' ? window.location.href : ''}`
            void navigator.clipboard.writeText(url)
          }}
          className="rounded-lg border border-white/[0.12] px-4 py-2 text-sm text-white/80"
        >
          Share recap link
        </button>
      </div>
      {refusal ? <PlanRefusalNotice refusal={refusal} /> : null}
      {grade ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/70">{grade}</pre>
      ) : null}
      {recap ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/70">{recap}</pre>
      ) : null}
    </div>
  )
}
