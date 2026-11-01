"use client"

import { useEffect, useRef, useState } from "react"
import type { MatchupEvidence } from "@/lib/playoffs/bracketCoachEvidence"
import { paidToolFetchWithConfirm } from "@/lib/tokens/paidToolClient"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { bracketCompanionCopy, bracketCompanionLocale } from "@/lib/brackets/bracketCompanionCopy"
import { bracketCoachCopy } from "@/lib/brackets/bracketCoachCopy"

export default function ChimmyMatchupAdvice({ challengeId, seriesId, canPick, onPick }: {
  challengeId?: string; seriesId: string; canPick: boolean; onPick: (team: string) => void
}) {
  const { language } = useOptionalLanguage()
  const copy = bracketCoachCopy(language), c = bracketCompanionCopy(language), locale = bracketCompanionLocale(language)
  const [evidence, setEvidence] = useState<MatchupEvidence | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const context = `${challengeId}:${seriesId}:${language}`
  const latestContext = useRef(context)
  latestContext.current = context
  useEffect(() => { setEvidence(null); setAnalysis(null); setError(null) }, [context])
  async function load(generate: boolean) {
    if (!challengeId || pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const url = `/api/brackets/playoffs/${encodeURIComponent(challengeId)}/coach/matchup`
      const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seriesId, generate, locale: language === "es" ? "es" : "en" }) }
      const response = generate ? await paidToolFetchWithConfirm(url, init) : await fetch(url, init)
      const result = await response.json()
      if (latestContext.current !== context) return
      if (result.evidence) setEvidence(result.evidence)
      if (!response.ok) throw new Error(result.userMessage ?? result.message ?? result.error ?? c.analysisError)
      if (generate) {
        setAnalysis(result.generative && typeof result.analysis === "string" ? result.analysis : null)
        if (!result.generative) setError(c.factsOnly)
      }
    } catch (error) { setError(c.analysisError) }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="af-cup-chimmy" aria-label={c.adviceLabel}>
    <span className="af-cup-chimmy-eyebrow">{c.intelligence}</span>
    <h2>{copy.adviceTitle}</h2>
    <p>{copy.adviceIntro}</p>
    {!challengeId ? <p>{c.openAdvice}</p> : <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void load(false)}>{busy ? copy.loading : copy.facts}</button>
      <button type="button" disabled={busy} onClick={() => void load(true)}>{busy ? copy.working : copy.analysis}</button>
    </div>}
    <p className="text-xs">{copy.price}</p>
    {error && <p role="alert">{error}</p>}
    {evidence && <div className="mt-4 space-y-3">
      <p><strong>{evidence.recommendation ? c.lean(evidence.recommendation) : c.noLean}</strong></p>
      <p className="text-xs">{c.coverage(c.qualities[evidence.dataQuality as keyof typeof c.qualities],new Date(evidence.asOf).toLocaleString(locale))}</p>
      {[evidence.away, evidence.home].map((team) => <div key={team.name} className="rounded-xl border border-white/15 p-3 text-sm">
        <h3 className="font-bold">{team.name}</h3>
        <p>{c.season}: {team.seasonRecord ? `${team.seasonRecord.wins}–${team.seasonRecord.losses}` : c.unverified}. {c.form(team.recentForm.wins,team.recentForm.losses,team.recentForm.games)}</p>
        <p>{team.hoursSincePreviousTipoff == null ? c.restUnknown : c.rest(team.hoursSincePreviousTipoff)}</p>
        {team.cupRecord && <p>{c.cup}: {team.cupRecord.wins}–{team.cupRecord.losses}. {team.cupRecord.road}</p>}
        {team.injuries.length > 0 && <ul>{team.injuries.map((row) => <li key={`${row.player}:${row.reportedAt}`}>{row.player}: {c.injuryStatus[row.status.toLowerCase() as keyof typeof c.injuryStatus] ?? row.status} — {row.source}, {new Date(row.reportedAt).toLocaleString(locale)}</li>)}</ul>}
      </div>)}
      <ul className="list-disc pl-5 text-sm">{evidence.factors.map((factor) => <li key={factor}>{factor}</li>)}</ul>
      <details><summary className="cursor-pointer text-sm font-bold">{copy.sources}</summary><ul className="list-disc pl-5 text-xs">{evidence.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul><p className="text-xs">{evidence.sourceDescription}</p></details>
      {analysis && <div className="whitespace-pre-wrap rounded-xl border border-teal-300/30 p-3 text-sm" aria-label={c.analysisLabel}>{analysis}</div>}
      {evidence.recommendation && <button type="button" disabled={!canPick || busy} onClick={() => onPick(evidence.recommendation!)}>{c.usePick(evidence.recommendation)}</button>}
      <p className="text-xs">{copy.noAutomaticPicks}</p>
    </div>}
  </section>
}
