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
  /** What completed trades in AllFantasy-connected leagues say about these players (`tradeMarketOverlay.ts`). */
  tradeMarket?: {
    generatedAt: string | null
    book?: string
    lineup?: string | null
    note?: string | null
    lines: Array<{ side: 'give' | 'get'; name: string; source?: 'market' | 'lineup'; adjustmentPercent: number; trades: number; chartValue: number | null; tradeMarketValue: number | null; reason?: string }>
  } | null
}

/** How many quarterbacks a lineup starts — the single biggest driver of a QB's value. */
const QB_PRESETS = {
  '1qb': { label: '1QB', qb: 1, sf: 0 },
  sf: { label: 'Superflex (1QB + SF)', qb: 1, sf: 1 },
  '2qb': { label: '2QB', qb: 2, sf: 0 },
  '4qb': { label: '4QB (e.g. Four Horsemen)', qb: 4, sf: 0 },
} as const
type QbPreset = keyof typeof QB_PRESETS

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const

type SearchPlayer = { playerId: string | null; name: string; position: string | null; team: string | null; value: number | null }
/**
 * How a deal is graded with no league, for the sports that offer a choice: a standard category preset, or
 * fantasy points. The first choice is the default — most NBA and MLB leagues are category leagues.
 */
const SCORING_CHOICES: Readonly<Record<string, { label: string; choices: ReadonlyArray<{ value: string; label: string }> }>> = {
  NBA: {
    label: 'NBA scoring',
    choices: [
      { value: 'nba_9cat', label: '9-category head-to-head' },
      { value: 'nba_8cat_standard', label: '8-category (no turnovers)' },
      { value: 'points', label: 'Points' },
    ],
  },
  MLB: {
    label: 'MLB scoring',
    choices: [
      { value: 'mlb_5x5', label: '5x5 categories' },
      { value: 'mlb_6x6', label: '6x6 categories (adds TB and holds)' },
      { value: 'points', label: 'Points' },
    ],
  },
}

/** "$25 FAAB", "25 faab", "FAAB 25" → a FAAB asset. Exported for its test. */
export function parseFaabLine(line: string): number | null {
  const m = /^(?:\$?\s*(\d{1,5})\s*(?:faab|fab)|(?:faab|fab)\s*\$?\s*(\d{1,5}))$/i.exec(line.trim())
  if (!m) return null
  const amount = Number(m[1] ?? m[2])
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function assets(text: string, sport: string, verified: Record<string, string>) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((name) => {
    const faab = parseFaabLine(name)
    if (faab != null) return { kind: 'faab' as const, amount: faab }
    const pick =/^(20\d{2})\s+(?:(?:round|ronda)\s*)?([1-9]\d?)(?:st|nd|rd|th)?(?:\s+(early|mid|late|temprana|media|tardía|tardia))?$/i.exec(name)
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
  const [scoringBySport, setScoringBySport] = useState<Record<string, string>>({ NBA: 'nba_9cat', MLB: 'mlb_5x5' })
  const scoring = SCORING_CHOICES[sport] ? scoringBySport[sport] ?? SCORING_CHOICES[sport]!.choices[0]!.value : null
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
  const [faabAmount, setFaabAmount] = useState('')
  const [waiverBudget, setWaiverBudget] = useState(100)
  /*
   * The league format the deal is valued in — no league needed. Superflex is the default because it is the
   * most common format among completed trades on file (measured 2026-11-11).
   */
  const [qbPreset, setQbPreset] = useState<QbPreset>('sf')
  const [rbSlots, setRbSlots] = useState(2)
  const [wrSlots, setWrSlots] = useState(3)
  const [teSlots, setTeSlots] = useState(1)
  const [flexSlots, setFlexSlots] = useState(2)
  const [dynasty, setDynasty] = useState(true)
  // League size prices the chart itself (FantasyCalc is asked for this many teams), so it is not a lineup move.
  const [teams, setTeams] = useState(12)
  const formatChange = <T,>(set: (v: T) => void) => (v: T) => { set(v); setResult(null) }

  function addFaab(side: 'A' | 'B') {
    const amount = Number(faabAmount)
    if (!Number.isInteger(amount) || amount < 1 || amount > waiverBudget) {
      setError(`FAAB must be a whole amount from 1 to ${waiverBudget}.`)
      return
    }
    const line = `$${amount} FAAB`
    if (side === 'A') setTeamA((current) => [current.trim(), line].filter(Boolean).join('\n'))
    else setTeamB((current) => [current.trim(), line].filter(Boolean).join('\n'))
    setFaabAmount('')
    setResult(null)
    setError(null)
  }

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
          waiverBudget,
          ...(sport === 'NFL'
            ? {
                isDynasty: dynasty,
                leagueSize: teams,
                lineup: { qb: QB_PRESETS[qbPreset].qb, sf: QB_PRESETS[qbPreset].sf, rb: rbSlots, wr: wrSlots, te: teSlots, flex: flexSlots },
              }
            : {}),
          ...(scoring ? { scoringFormat: scoring } : {}),
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
          <p>{copy("Grade any trade on current market values, adjusted by what managers actually paid in completed trades across AllFantasy leagues. Put each player, pick or FAAB amount a team sends on its own line.")}</p>
        </div>
        <label className="af-tc-generic-upload">
          {copy(extracting ? 'Reading screenshot…' : 'Import screenshot')}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={importImage} disabled={extracting || busy} />
        </label>
      </div>
      {imageName ? (
        <div className={styles.review} role="status">
          <strong>{copy("Review screenshot import · ")}{copy(imageName)}</strong>
          <p>{copy("We read this from your screenshot, so check it. Fix or remove lines, add anything missing, and make sure each side is right.")}</p>
          {reviewNotes.length ? <ul aria-label={copy("Screenshot uncertainties")}>{reviewNotes.map((note, index) => <li key={`${index}-${note}`}>{copy(note)}</li>)}</ul>
            : <p>{copy("Nothing looked unclear, but still check every line against the screenshot.")}</p>}
          <button type="button" className="af-btn af-btn-ghost" onClick={swapSides}>{copy("Swap Team A and Team B")}</button>
        </div>
      ) : null}
      <label className="af-tc-generic-sport">{copy("Sport ")}<select value={sport} onChange={(event) => { setSport(event.target.value); setResult(null); setVerifiedA({}); setVerifiedB({}) }}>
          {SPORTS.map((value) => <option key={value} value={value}>{copy(value)}</option>)}
        </select>
      </label>
      {sport === 'NFL' ? (
        <fieldset className="af-tc-generic-format" data-testid="generic-league-format">
          <legend>{copy("League format")}</legend>
          <label>{copy("Quarterbacks ")}<select value={qbPreset} onChange={(event) => formatChange(setQbPreset)(event.target.value as QbPreset)} data-testid="generic-qb-preset">
              {(Object.keys(QB_PRESETS) as QbPreset[]).map((key) => <option key={key} value={key}>{copy(QB_PRESETS[key].label)}</option>)}
            </select>
          </label>
          <label>{copy("Teams ")}<select value={teams} onChange={(event) => formatChange(setTeams)(Number(event.target.value))} data-testid="generic-teams">{[8, 10, 12, 14, 16].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{copy("RB ")}<select value={rbSlots} onChange={(event) => formatChange(setRbSlots)(Number(event.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{copy("WR ")}<select value={wrSlots} onChange={(event) => formatChange(setWrSlots)(Number(event.target.value))}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{copy("TE ")}<select value={teSlots} onChange={(event) => formatChange(setTeSlots)(Number(event.target.value))} data-testid="generic-te-slots">{[1, 2].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{copy("FLEX ")}<select value={flexSlots} onChange={(event) => formatChange(setFlexSlots)(Number(event.target.value))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>{copy("Values ")}<select value={dynasty ? 'dynasty' : 'redraft'} onChange={(event) => formatChange(setDynasty)(event.target.value === 'dynasty')} data-testid="generic-dynasty">
              <option value="dynasty">{copy("Dynasty")}</option>
              <option value="redraft">{copy("Redraft")}</option>
            </select>
          </label>
          <small className="af-tc-generic-hint">{copy("Two or more QB/superflex starters prices on the superflex chart. Lineup moves (like 2-TE or 4-QB) apply only where enough completed trades in lineups like this one measured them.")}</small>
          <small className="af-tc-generic-hint" data-testid="generic-college-hint">{copy("Devy: search a college player's name to trade him for pros. College prospects are valued on the same dynasty chart — the chance he is drafted, times what a player like him is worth on arrival, discounted for the wait. Dynasty values only.")}</small>
        </fieldset>
      ) : null}
      {/* NBA and MLB leagues are mostly category leagues; the grade values each the way it is won. */}
      {scoring && SCORING_CHOICES[sport] ? (
        <label className="af-tc-generic-sport">{copy("Scoring ")}<select aria-label={copy(SCORING_CHOICES[sport]!.label)} value={scoring} onChange={(event) => { const value = event.target.value; setScoringBySport((prev) => ({ ...prev, [sport]: value })); setResult(null) }}>
            {SCORING_CHOICES[sport]!.choices.map((choice) => <option key={choice.value} value={choice.value}>{copy(choice.label)}</option>)}
          </select>
        </label>
      ) : null}
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
      {sport === 'NFL' ? (
        <div className="af-tc-generic-pick" data-testid="generic-faab-row">
          <strong>{copy("Add FAAB")}</strong>
          <label>{copy("Amount ")}<input type="number" min={1} max={waiverBudget} value={faabAmount} onChange={(event) => setFaabAmount(event.target.value)} placeholder="25" /></label>
          <label>{copy("League budget ")}<input type="number" min={1} max={10000} value={waiverBudget} onChange={(event) => { setWaiverBudget(Math.max(1, Math.min(10000, Number(event.target.value) || 100))); setResult(null) }} /></label>
          <button type="button" onClick={() => addFaab('A')}>{copy("Add FAAB to A")}</button>
          <button type="button" onClick={() => addFaab('B')}>{copy("Add FAAB to B")}</button>
        </div>
      ) : null}
      <p className="af-tc-generic-hint">{copy("If you know the overall pick number, we treat it as early, mid or late (based on a 12-team league). FAAB is priced against the league budget you enter. This uses market values only — no league scoring, roster needs or trade rules. Screenshots are sent to our image reader to pull out the players and aren’t saved.")}</p>
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
              <p>{copy("Team A receives ")}{copy((result.grade.getValue ?? result.grade.getMarket).toLocaleString(locale))}{copy(" in market value and sends ")}{copy((result.grade.giveValue ?? result.grade.giveMarket).toLocaleString(locale))}{copy("; Team B is the opposite. The gap is ")}{copy(Math.abs(result.grade.percentDiff ?? 0))}{copy("% of the bigger side.")} <TopicTip topic="tradeGrade" /></p>
              <p className="af-tc-generic-hint">{copy("This grade compares market value only. It doesn’t account for league scoring, roster needs, injuries, whether they’ll accept, or how players will perform.")}</p>
              {result.tradeMarket?.lines.length || result.tradeMarket?.note ? (
                <div className="af-tc-generic-market" data-testid="generic-trade-market">
                  <strong>{copy("What real trades say")}</strong>
                  <p className="af-tc-generic-hint">{copy(`Measured only from completed ${result.tradeMarket.book ?? ''} trades across AllFantasy-connected leagues${result.tradeMarket.lineup ? `, for this lineup (${result.tradeMarket.lineup})` : ''}. The letter above already includes these moves.`)}</p>
                  <ul>{result.tradeMarket.lines.map((line, index) => (
                    <li key={`${line.side}-${line.name}-${line.source ?? 'market'}-${index}`} data-source={line.source ?? 'market'}>
                      <span>{line.name}{line.source === 'lineup' ? copy(' · lineup') : ''}</span>
                      <strong className={line.adjustmentPercent >= 0 ? 'af-tc-generic-up' : 'af-tc-generic-down'}>{line.adjustmentPercent > 0 ? '+' : ''}{line.adjustmentPercent}%</strong>
                      <small>{copy(line.source === 'lineup' ? (line.reason ?? 'Lineup adjustment') : `${line.trades} completed trades`)}{line.source !== 'lineup' && line.chartValue != null && line.tradeMarketValue != null ? copy(` · chart ${line.chartValue.toLocaleString(locale)} → ${line.tradeMarketValue.toLocaleString(locale)}`) : ''}</small>
                    </li>
                  ))}</ul>
                  {result.tradeMarket.note ? <p className="af-tc-generic-hint" data-testid="generic-lineup-note">{copy(result.tradeMarket.note)}</p> : null}
                  {result.tradeMarket.generatedAt ? <small className="af-tc-generic-hint">{copy(`Trade market updated ${new Date(result.tradeMarket.generatedAt).toLocaleDateString(locale)}.`)}</small> : null}
                </div>
              ) : null}
              <p className="af-tc-generic-hint">{copy("Value basis: ")}{copy(result.grade.basis)}{copy(/[.!?]\s*$/.test(result.grade.basis) ? " Valuation checked " : ". Valuation checked ")}{copy(result.lastUpdated && Number.isFinite(Date.parse(result.lastUpdated)) ? new Date(result.lastUpdated).toLocaleString(locale) : 'at analysis time; source date unavailable')}{copy(".")}</p>
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
                      <span>{copy(line.marketValue == null ? 'Value unavailable' : line.leagueValue != null && line.leagueValue !== line.marketValue ? `${line.leagueValue.toLocaleString(locale)} graded value (chart ${line.marketValue.toLocaleString(locale)})` : `${line.marketValue.toLocaleString(locale)} market value`)}</span>
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
                <p className="af-tc-generic-hint">{copy("We couldn’t find values for some players. Check the names before relying on this grade.")}</p>
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
