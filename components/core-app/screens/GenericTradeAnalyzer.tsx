'use client'
import { useTradeVisualCopy } from "./useTradeVisualCopy"
import { TradeTranslationStatus } from './TradeTranslationStatus'
import { TopicTip } from '@/components/core-app/TopicTip'

import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { TradeEvidencePanel } from './TradeEvidencePanel'
import { TradeDecisionSummary } from './TradeDecisionSummary'
import { TradeComparisonSnapshots } from './TradeComparisonSnapshots'
import { TradeValueChart } from './TradeImpactCharts'
import { TradeReaction, TradeReactionSettings } from './TradeReactions'
import styles from './GenericTradeAnalyzer.module.css'
import { rosterSpotRowLabel } from '@/lib/trade-value/rosterSpotCharge'

type Result = {
  grade?: TradeGradeView
  lastUpdated?: string
  labels?: { fairnessLabel?: string; confidenceLabel?: string }
  dataGaps?: string[]
  error?: string
}

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

type SearchPlayer = { playerId: string | null; name: string; position: string | null; team: string | null; value: number | null }

function assets(text: string, sport: string, verified: Record<string, string>) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((name) => {
    const pick = /^(20\d{2})\s+(?:(?:round|ronda)\s*)?([1-9]\d?)(?:st|nd|rd|th)?(?:\s+(early|mid|late|temprana|media|tardía|tardia))?$/i.exec(name)
    if (pick) return { kind: 'pick' as const, year: Number(pick[1]), round: Number(pick[2]), tier: ({early:'early',mid:'mid',late:'late',temprana:'early',media:'mid',tardía:'late',tardia:'late'} as const)[pick[3]?.toLowerCase() as 'early'|'mid'|'late'|'temprana'|'media'|'tardía'|'tardia'], label: name }
    return { kind: 'player' as const, name, ...(verified[name] ? { playerId: verified[name] } : {}), sportHint: sport }
  })
}

function PlayerSearch(props: { sport: string; onChoose: (player: SearchPlayer) => void }) {
  const {copy,locale}=useTradeVisualCopy()

  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<SearchPlayer[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (query.trim().length < 2) { setRows([]); setLoading(false); return }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/trade-value/player-search?q=${encodeURIComponent(query)}&sport=${encodeURIComponent(props.sport)}`, { signal: controller.signal })
        const data = await response.json() as SearchPlayer[]
        if (!controller.signal.aborted) setRows(response.ok && Array.isArray(data) ? data : [])
      } catch {
        if (!controller.signal.aborted) setRows([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, props.sport])
  return (
    <div className="af-tc-generic-search">
      <label>{copy("Find a player ")}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy("Search name, then add a result")} autoComplete="off" />
      </label>
      {loading ? <span className="af-tc-generic-hint">{copy("Searching…")}</span> : null}
      {rows.length > 0 ? (
        <ul aria-label={copy("Player search results")}>
          {rows.map((row, index) => (
            <li key={`${row.playerId ?? row.name}-${index}`}>
              <button type="button" onClick={() => { props.onChoose(row); setQuery(''); setRows([]) }}>
                <strong>{row.name}</strong><span>{copy([row.position, row.team].filter(Boolean).join(' · ') || props.sport)}</span>
                <small>{copy(row.value == null ? 'Value unavailable' : row.value.toLocaleString(locale))}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function GenericTradeAnalyzer({ viewerId }: { viewerId?: string | null } = {}) {

  const comparisonScope = `generic:${viewerId ?? 'device'}`
  const [sport, setSport] = useState<string>('NFL')
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const {copy,locale,language,translationState,retryTranslation}=useTradeVisualCopy({result,assets:[...teamA.split(/\r?\n/),...teamB.split(/\r?\n/)].map(name=>({name}))})
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<string[]>([])
  const [screenshotConfirmed, setScreenshotConfirmed] = useState(false)
  const [verifiedA, setVerifiedA] = useState<Record<string, string>>({})
  const [verifiedB, setVerifiedB] = useState<Record<string, string>>({})
  const [pickYear, setPickYear] = useState(new Date().getFullYear() + 1)
  const [pickRound, setPickRound] = useState(1)
  const [pickTier, setPickTier] = useState<'early' | 'mid' | 'late'>('mid')
  const [pickOverall, setPickOverall] = useState('')

  function addPick(side: 'A' | 'B') {
    if (!Number.isInteger(pickYear) || pickYear < new Date().getFullYear() || pickYear > new Date().getFullYear() + 8) {
      setError('Choose a valid pick year.')
      return
    }
    const overall = pickOverall.trim() ? Number(pickOverall) : null
    if (overall != null && (!Number.isInteger(overall) || overall < 1 || overall > 192)) {
      setError('Overall pick must be from 1 to 192 for the 12-team reference.')
      return
    }
    if (overall == null && (!Number.isInteger(pickRound) || pickRound < 1 || pickRound > 16)) {
      setError('Choose a round from 1 to 16.')
      return
    }
    const round = overall == null ? pickRound : Math.ceil(overall / 12)
    const slot = overall == null ? null : ((overall - 1) % 12) + 1
    const tier = slot == null ? pickTier : slot <= 4 ? 'early' : slot <= 8 ? 'mid' : 'late'
    const line = `${pickYear} round ${round} ${tier}`
    if (side === 'A') setTeamA((current) => [current.trim(), line].filter(Boolean).join('\n'))
    else setTeamB((current) => [current.trim(), line].filter(Boolean).join('\n'))
    setScreenshotConfirmed(false)
    setResult(null)
    setError(null)
  }

  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setResult(null)
    setImageName(null)
    setReviewNotes([])
    setScreenshotConfirmed(false)
    setExtracting(true)
    const form = new FormData()
    form.append('image', file)
    try {
      const response = await fetch('/api/trade-value/extract-screenshot', { method: 'POST', body: form })
      const data = await response.json() as { teamA?: string[]; teamB?: string[]; reviewNotes?: string[]; error?: string }
      if (!response.ok) throw new Error(data.error || 'Could not read this screenshot.')
      setTeamA((data.teamA ?? []).join('\n'))
      setTeamB((data.teamB ?? []).join('\n'))
      setVerifiedA({})
      setVerifiedB({})
      setImageName(file.name)
      setReviewNotes(Array.isArray(data.reviewNotes) ? data.reviewNotes : [])
      if (!data.teamA?.length || !data.teamB?.length) {
        setError('The screenshot did not clearly show both sides. Correct the names before analyzing.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this screenshot.')
    } finally {
      setExtracting(false)
    }
  }

  function swapSides() {
    setTeamA(teamB)
    setTeamB(teamA)
    setVerifiedA(verifiedB)
    setVerifiedB(verifiedA)
    setScreenshotConfirmed(false)
    setResult(null)
    setError(null)
  }

  async function analyze() {
    if (imageName && !screenshotConfirmed) {
      setError('Review both sides from the screenshot, then confirm they are correct.')
      return
    }
    const sideGive = assets(teamA, sport, verifiedA)
    const sideGet = assets(teamB, sport, verifiedB)
    if (!sideGive.length || !sideGet.length) {
      setError('Add at least one asset to each team.')
      return
    }
    if (sideGive.length > 24 || sideGet.length > 24) {
      setError('Use no more than 24 assets per team.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/trade-value/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter: sport,
          leagueId: null,
          strategy: 'neutral',
          teamContext: 'neutral',
          sideGive,
          sideGet,
          skipAi: true,
        }),
      })
      const data = await response.json() as Result
      if (!response.ok) throw new Error(data.error || 'Analysis failed. Check the player names and try again.')
      setResult(data)
      setAnalyzedAt(new Date().toISOString())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Analysis failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="af-tc-generic" aria-labelledby="af-tc-generic-title">
      <TradeTranslationStatus state={translationState} language={language} retry={retryTranslation} />
      <div className="af-tc-generic-heading">
        <div>
          <div className="af-label">{copy("No league connection needed")}</div>
          <h2 id="af-tc-generic-title">{copy("Quick trade analyzer")}</h2>
          <p>{copy("Compare an outside offer using general market values. Put each player or draft pick a team sends on a separate line.")}</p>
        </div>
        <label className="af-tc-generic-upload">
          {copy(extracting ? 'Reading screenshot…' : 'Import screenshot')}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={importImage} disabled={extracting || busy} />
        </label>
      </div>
      {imageName ? (
        <div className={styles.review} role="status">
          <strong>{copy("Review screenshot import · ")}{copy(imageName)}</strong>
          <p>{copy("Extraction is a draft. Edit or remove each line, add missing assets, and check which team sends them.")}</p>
          {reviewNotes.length ? <ul aria-label={copy("Screenshot uncertainties")}>{reviewNotes.map((note, index) => <li key={`${index}-${note}`}>{copy(note)}</li>)}</ul>
            : <p>{copy("No specific uncertainty was reported. Still compare every line with the image.")}</p>}
          <button type="button" className="af-btn af-btn-ghost" onClick={swapSides}>{copy("Swap Team A and Team B")}</button>
        </div>
      ) : null}
      <label className="af-tc-generic-sport">{copy("Sport ")}<select value={sport} onChange={(event) => { setSport(event.target.value); setResult(null); setVerifiedA({}); setVerifiedB({}) }}>
          {SPORTS.map((value) => <option key={value} value={value}>{copy(value)}</option>)}
        </select>
      </label>
      <div className="af-tc-generic-sides">
        <div className="af-tc-generic-side">
          <label>{copy("Team A sends ")}<textarea value={teamA} onChange={(event) => { setTeamA(event.target.value); setScreenshotConfirmed(false); setResult(null) }} placeholder={copy('Player name\n2027 round 1')} rows={5} />
          </label>
          <PlayerSearch sport={sport} onChoose={(player) => {
            setTeamA((current) => [current.trim(), player.name].filter(Boolean).join('\n'))
            setScreenshotConfirmed(false)
            if (player.playerId) setVerifiedA((current) => ({ ...current, [player.name]: player.playerId! }))
            setResult(null)
          }} />
        </div>
        <div className="af-tc-generic-side">
          <label>{copy("Team B sends ")}<textarea value={teamB} onChange={(event) => { setTeamB(event.target.value); setScreenshotConfirmed(false); setResult(null) }} placeholder={copy('Player name\n2027 round 2')} rows={5} />
          </label>
          <PlayerSearch sport={sport} onChoose={(player) => {
            setTeamB((current) => [current.trim(), player.name].filter(Boolean).join('\n'))
            setScreenshotConfirmed(false)
            if (player.playerId) setVerifiedB((current) => ({ ...current, [player.name]: player.playerId! }))
            setResult(null)
          }} />
        </div>
      </div>
      {imageName ? (
        <label className="af-tc-generic-confirm">
          <input type="checkbox" checked={screenshotConfirmed} onChange={(event) => setScreenshotConfirmed(event.target.checked)} />{copy(" I checked the assets and which team sends each one. ")}</label>
      ) : null}
      <div className="af-tc-generic-pick">
        <strong>{copy("Add a draft pick")}</strong>
        <label>{copy("Year ")}<input type="number" min={new Date().getFullYear()} max={new Date().getFullYear() + 8} value={pickYear} onChange={(event) => setPickYear(Number(event.target.value))} /></label>
        <label>{copy("Round ")}<input type="number" min={1} max={16} value={pickRound} onChange={(event) => setPickRound(Number(event.target.value))} /></label>
        <label>{copy("Expected range ")}<select value={pickTier} onChange={(event) => setPickTier(event.target.value as 'early' | 'mid' | 'late')}><option value="early">{copy("Early")}</option><option value="mid">{copy("Middle")}</option><option value="late">{copy("Late")}</option></select></label>
        <label>{copy("Overall pick, if known ")}<input type="number" min={1} max={192} value={pickOverall} onChange={(event) => setPickOverall(event.target.value)} placeholder={copy("Optional")} /></label>
        <button type="button" onClick={() => addPick('A')}>{copy("Add to A")}</button>
        <button type="button" onClick={() => addPick('B')}>{copy("Add to B")}</button>
      </div>
      <p className="af-tc-generic-hint">{copy("A known overall pick maps to an early, middle, or late range using a 12-team reference; the grade remains an estimate. General market grade only: no league scoring, roster needs, trade rules, or acceptance prediction. Screenshot images go to the configured vision provider for asset extraction and are not saved by this tool.")}</p>
      <button type="button" className="af-btn" onClick={() => void analyze()} disabled={busy || extracting || Boolean(imageName && !screenshotConfirmed)}>
        {copy(busy ? 'Analyzing…' : 'Analyze trade')}
      </button>
      {error ? <p className="af-tc-generic-error" role="alert">{copy(error)}</p> : null}
      {result?.grade ? (
        <div className="af-tc-generic-result" aria-live="polite">
          {result.grade.graded ? (
            <>
              <div className="af-tc-generic-grades">
                <div><span>{copy("Team A")}</span><strong>{copy(result.grade.letter)}</strong><small>{copy("Receives Team B assets")}</small><TradeReaction letter={result.grade.letter} /></div>
                <div><span>{copy("Team B")}</span><strong>{copy(result.grade.partnerLetter)}</strong><small>{copy("Receives Team A assets")}</small><TradeReaction letter={result.grade.partnerLetter} /></div>
              </div>
              <h3>{copy(result.grade.sideAdvantage === 'even' ? 'Near-even market value' : result.grade.sideAdvantage === 'you' ? 'Team A receives more market value' : 'Team B receives more market value')}</h3>
              <p>{copy("Team A receives ")}{copy(result.grade.getMarket.toLocaleString(locale))}{copy(" in general market value and sends ")}{copy(result.grade.giveMarket.toLocaleString(locale))}{copy("; Team B sees the reverse. The value gap is ")}{copy(Math.abs(result.grade.percentDiff ?? 0))}{copy("% of the larger side.")} <TopicTip topic="tradeGrade" /></p>
              <p className="af-tc-generic-hint">{copy("This grade compares market value only. Position matters only through each asset’s quoted value; there is no team-specific position adjustment. League scoring, roster needs, injury risk, acceptance likelihood, and future results are not priced separately.")}</p>
              <p className="af-tc-generic-hint">{copy("Value basis: ")}{copy(result.grade.basis)}{copy(". Valuation checked ")}{copy(result.lastUpdated && Number.isFinite(Date.parse(result.lastUpdated)) ? new Date(result.lastUpdated).toLocaleString(locale) : 'at analysis time; source date unavailable')}{copy(".")}</p>
              <TradeDecisionSummary grade={result.grade} evaluatedAt={analyzedAt} gaps={result.dataGaps} generic />
              <TradeEvidencePanel grade={result.grade} evaluatedAt={analyzedAt} gaps={result.dataGaps} generic />
              <TradeValueChart grade={result.grade} generic />
              <TradeReactionSettings />
              {result.grade.lines.length ? (
                <details className={styles.breakdown}>
                  <summary>{copy("Why this grade? View asset values and sources")}</summary>
                  <ul>{result.grade.lines.map((line, index) => (
                    <li key={`${line.side}-${line.name}-${index}`}>
                      <strong>{copy(line.side === 'give' ? 'Team A sends' : 'Team B sends')}{copy(" · ")}{line.name}</strong>
                      <span>{copy(line.marketValue == null ? 'Value unavailable' : `${line.marketValue.toLocaleString(locale)} market value`)}</span>
                      <small>{copy(line.valueSource ?? line.source ?? 'Source unavailable')}{copy(line.valueAsOf && Number.isFinite(Date.parse(line.valueAsOf)) ? ` · as of ${new Date(line.valueAsOf).toLocaleDateString(locale)}` : ' · source date unavailable')}</small>
                    </li>
                  ))}
                  {result.grade.rosterSpot ? (
                    <li data-testid="generic-roster-spot">
                      <strong>{copy(rosterSpotRowLabel(result.grade.rosterSpot, 'teams'))}</strong>
                      <span>{copy(`${result.grade.rosterSpot.value.toLocaleString(locale)} — the last rostered player in a league this size`)}</span>
                    </li>
                  ) : null}</ul>
                </details>
              ) : null}
              {result.grade.lines.some((line) => line.marketValue == null || line.leagueValue == null) ? (
                <p className="af-tc-generic-hint">{copy("Some assets could not be priced. Review the names and the data gaps before relying on this grade.")}</p>
              ) : null}
            </>
          ) : <p>{copy(result.grade.reason)}</p>}
          {result.dataGaps?.length ? <p className="af-tc-generic-hint">{copy("Data gaps: ")}{copy(result.dataGaps.join(' · '))}</p> : null}
        </div>
      ) : result ? <p className="af-tc-generic-error">{copy("No reliable grade was returned for this trade.")}</p> : null}
      <TradeComparisonSnapshots scope={comparisonScope} snapshot={result?.grade?.graded ? {
        id: 'current', scope: comparisonScope, sport, title: 'Team A ↔ Team B',
        at: analyzedAt ?? result.lastUpdated ?? new Date().toISOString(),
        basis: result.grade.basis || 'General market value',
        uncertainty: result.dataGaps?.length ? `${result.dataGaps.length} data gap${result.dataGaps.length === 1 ? '' : 's'}` : result.grade.lines.some((line) => line.marketValue == null) ? 'Some assets unpriced' : 'Market estimate',
        sides: ['Team A', 'Team B'],
        assets: [teamA.split(/\r?\n/).filter(Boolean), teamB.split(/\r?\n/).filter(Boolean)],
        grades: [result.grade.letter, result.grade.partnerLetter],
        verdict: result.grade.sideAdvantage === 'even' ? 'Near-even market value' : result.grade.sideAdvantage === 'you' ? 'Team A receives more market value' : 'Team B receives more market value',
      } : null} />
    </section>
  )
}
