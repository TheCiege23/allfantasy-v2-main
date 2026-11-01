"use client"

import { useRef, useState } from "react"
import type { MatchupEvidence } from "@/lib/playoffs/bracketCoachEvidence"
import { paidToolFetchWithConfirm } from "@/lib/tokens/paidToolClient"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { bracketCoachCopy } from "@/lib/brackets/bracketCoachCopy"

export default function ChimmyMatchupAdvice({ challengeId, seriesId, canPick, onPick }: {
  challengeId?: string; seriesId: string; canPick: boolean; onPick: (team: string) => void
}) {
  const { language } = useOptionalLanguage()
  const copy = bracketCoachCopy(language)
  const [evidence, setEvidence] = useState<MatchupEvidence | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  async function load(generate: boolean) {
    if (!challengeId || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const url = `/api/brackets/playoffs/${encodeURIComponent(challengeId)}/coach/matchup`
      const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seriesId, generate, locale: language === "es" ? "es" : "en" }) }
      const response = generate ? await paidToolFetchWithConfirm(url, init) : await fetch(url, init)
      const result = await response.json()
      if (result.evidence) setEvidence(result.evidence)
      if (!response.ok) throw new Error(result.userMessage ?? result.message ?? result.error ?? "Matchup analysis is unavailable")
      if (generate) {
        setAnalysis(result.generative && typeof result.analysis === "string" ? result.analysis : null)
        if (!result.generative) setError("Chimmy's analysis is unavailable. The verified facts below are still available.")
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load matchup analysis") }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="af-cup-chimmy" aria-label="Chimmy matchup coach">
    <span className="af-cup-chimmy-eyebrow">Chimmy Intelligence</span>
    <h2>{copy.adviceTitle}</h2>
    <p>{copy.adviceIntro}</p>
    {!challengeId ? <p>Open your bracket to request Chimmy advice.</p> : <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void load(false)}>{busy ? copy.loading : copy.facts}</button>
      <button type="button" disabled={busy} onClick={() => void load(true)}>{busy ? copy.working : copy.analysis}</button>
    </div>}
    <p className="text-xs">{copy.price}</p>
    {error && <p role="alert">{error}</p>}
    {evidence && <div className="mt-4 space-y-3">
      <p><strong>{evidence.recommendation ? `Evidence-backed lean: ${evidence.recommendation}` : "No clear lean from the available evidence"}</strong></p>
      <p className="text-xs">Data coverage: {evidence.dataQuality}. Checked {new Date(evidence.asOf).toLocaleString()}.</p>
      {[evidence.away, evidence.home].map((team) => <div key={team.name} className="rounded-xl border border-white/15 p-3 text-sm">
        <h3 className="font-bold">{team.name}</h3>
        <p>Season: {team.seasonRecord ? `${team.seasonRecord.wins}–${team.seasonRecord.losses}` : "Unverified"}. Recent verified finals: {team.recentForm.wins}–{team.recentForm.losses} ({team.recentForm.games} games available).</p>
        <p>{team.hoursSincePreviousTipoff == null ? "Rest interval unavailable." : `${team.hoursSincePreviousTipoff} hours between recorded tipoffs; travel and actual recovery unknown.`}</p>
        {team.cupRecord && <p>Cup: {team.cupRecord.wins}–{team.cupRecord.losses}. {team.cupRecord.road}</p>}
        {team.injuries.length > 0 && <ul>{team.injuries.map((row) => <li key={`${row.player}:${row.reportedAt}`}>{row.player}: {row.status} — {row.source}, {new Date(row.reportedAt).toLocaleString()}</li>)}</ul>}
      </div>)}
      <ul className="list-disc pl-5 text-sm">{evidence.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
      <details><summary className="cursor-pointer text-sm font-bold">{copy.sources}</summary><ul className="list-disc pl-5 text-xs">{evidence.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul><p className="text-xs">{evidence.sourceDescription}</p></details>
      {analysis && <div className="whitespace-pre-wrap rounded-xl border border-teal-300/30 p-3 text-sm" aria-label="Chimmy analysis">{analysis}</div>}
      {evidence.recommendation && <button type="button" disabled={!canPick || busy} onClick={() => onPick(evidence.recommendation!)}>Use this pick · {evidence.recommendation}</button>}
      <p className="text-xs">{copy.noAutomaticPicks}</p>
    </div>}
  </section>
}
