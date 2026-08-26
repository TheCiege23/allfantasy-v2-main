'use client'

import { useCallback, useMemo, useState } from 'react'
import { TradeAssetPicker, type PickedAsset } from '@/components/core-app/screens/TradeAssetPicker'
import { TradeInbox } from '@/components/core-app/screens/TradeInbox'
import { TradeProposePanel } from '@/components/core-app/screens/TradeProposePanel'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { projectedLetterFor, type GradeLetter } from '@/lib/trade-intel/gradeScale'
import { TradeFinderPanel } from '@/components/core-app/screens/TradeFinderPanel'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-trade-center.css'

/**
 * Screen 36a — Trade Center.
 *
 * Build a deal, get the fairness verdict, and see the advisory context beside
 * it. Replaces the fragmented trade-analyzer / evaluator / finder surfaces with
 * one page.
 *
 * ⚠ THE THREE STATES ARE ORGANIC, NOT A PREVIEW SWITCHER. The design ships a
 * five-way state toggle so a reviewer can see every layout; in production those
 * are situations the same page falls into on its own — a normal analysis, a
 * degraded one, and a format that forbids the deal outright. The switcher is
 * deliberately not reimplemented.
 *
 * ⚠ MULTI-TEAM AND CROSS-PLATFORM ARE NOT BUILT. The handoff is explicit that
 * neither has backing schema: 3+ teams needs the two-sided
 * `sideGive`/`sideGet` input replaced with a per-team shape AND a real answer
 * for how fairness generalises past two sides, and a linked deal needs a
 * `LinkedTradeProposal` record with a status machine, because no platform can
 * enforce the other leg. Rendering either now would be a UI promising a
 * transaction the system cannot make.
 *
 * ⚠ NO NEW API ROUTE. This posts to the existing `/api/trade-value/analyze`.
 * The repo sits at the platform's route ceiling and a page is not worth one.
 */

/** Asset vocabulary the legend documents, per the handoff. */
const ASSET_TYPES: Array<{ key: string; label: string; glyph: string; color: string }> = [
  { key: 'player', label: 'Player · any position, incl. IDP', glyph: 'P', color: '#22d3ee' },
  { key: 'pick', label: 'Pick', glyph: 'D', color: '#8f97bd' },
  { key: 'faab', label: 'FAAB', glyph: '$', color: '#34d399' },
  { key: 'idol', label: 'Idol · Survivor', glyph: 'I', color: '#fbbf24' },
  { key: 'weapon', label: 'Weapon · Zombie', glyph: 'W', color: '#fb5b78' },
  { key: 'serum', label: 'Serum · Zombie', glyph: 'S', color: '#a78bfa' },
]

type Line = {
  name: string
  position?: string | null
  team?: string | null
  marketValue?: number | null
  pricedSource?: string | null
}

type AnalyzeResult = {
  labels?: { fairnessLabel?: string; confidenceLabel?: string }
  fairnessScore?: number
  confidenceScore?: number
  percentDiff?: number
  degraded?: boolean
  dataGaps?: string[]
  giveTotal?: number
  getTotal?: number
  players?: { give: Line[]; get: Line[] }
  byeNotes?: string[]
  needNotes?: string[]
  leverageNotes?: string[]
  postureNotes?: string[]
  pickNotes?: string[]
  scaleNotes?: string[]
  formatNotes?: string[]
  tradeIntelligence?: {
    whoWinsNow?: string
    whoWinsLongTerm?: string
    contenderRecommendation?: string
    rebuilderRecommendation?: string
    tradeWarnings?: string[]
    rebalanceSuggestions?: string[]
    alternateTargets?: Array<{ name: string; marketValue: number; position: string | null }>
    alternateTargetsNote?: string
    why?: string
  }
}

/**
 * ⚠ AN UNPRICED ASSET IS AN EM DASH, NEVER A ZERO. A defender the market feed
 * cannot price is not worthless, and rendering 0 would say he is.
 */
function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : '—'
}

/** Sum that ignores unpriced lines rather than treating them as zero. */
function totalOf(lines: Line[]): string {
  const priced = lines
    .map((l) => l.marketValue)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (priced.length === 0) return '—'
  return priced.reduce((a, b) => a + b, 0).toLocaleString()
}

const NOTE_GROUPS: Array<{ key: keyof AnalyzeResult; tone: string; title: string }> = [
  { key: 'scaleNotes', tone: 'scale', title: 'League & roster shape' },
  { key: 'postureNotes', tone: 'posture', title: 'Where each side stands' },
  { key: 'pickNotes', tone: 'pick', title: 'What these picks really are' },
  { key: 'leverageNotes', tone: 'leverage', title: 'Your leverage' },
  { key: 'needNotes', tone: 'need', title: "What it's worth to you" },
  { key: 'byeNotes', tone: 'bye', title: 'Bye-week collisions' },
]

/**
 * Into the shape `TradeConsoleAnalyzeInput` accepts.
 *
 * ⚠ A PLAYER WITHOUT AN ID GOES BY NAME, which is what the engine's own schema
 * allows — the FantasyCalc search path returns no id, so requiring one would
 * make the most common search result unusable.
 */
function toInput(a: PickedAsset) {
  if (a.kind === 'player') {
    return {
      kind: 'player' as const,
      ...(a.playerId ? { playerId: a.playerId } : {}),
      name: a.name,
      ...(a.sportHint ? { sportHint: a.sportHint } : {}),
    }
  }
  if (a.kind === 'pick') {
    return { kind: 'pick' as const, year: a.year, round: a.round, label: a.label }
  }
  return { kind: 'faab' as const, amount: a.amount }
}

export function TradeCenter(props: {
  league: { id: string; name: string; format: string | null; teamCount: number | null } | null
  /** Opponent label, when the caller knows one. */
  opponentLabel?: string | null
  deadlineLabel?: string | null
}) {
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The deal under construction, which is the source of truth for what gets
   * analysed. The engine's echo of it (`result.players`) is used only for the
   * prices it resolved — a line the manager added must not disappear because
   * the feed could not price it.
   */
  const [giveAssets, setGiveAssets] = useState<PickedAsset[]>([])
  const [getAssets, setGetAssets] = useState<PickedAsset[]>([])
  const [picking, setPicking] = useState<'give' | 'get' | null>(null)
  const [draftNote, setDraftNote] = useState<string | null>(null)

  /** Prices the engine resolved, keyed by name, merged onto what was added. */
  const pricedBy = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const l of [...(result?.players?.give ?? []), ...(result?.players?.get ?? [])]) {
      m.set(l.name.toLowerCase(), l.marketValue ?? null)
    }
    return m
  }, [result])

  const toLines = useCallback(
    (assets: PickedAsset[]): Line[] =>
      assets.map((a) =>
        a.kind === 'player'
          ? {
              name: a.name,
              position: a.position,
              team: a.team,
              /* Engine price wins; the search value is the fallback. */
              marketValue: pricedBy.get(a.name.toLowerCase()) ?? a.value ?? null,
            }
          : a.kind === 'pick'
            ? { name: a.label, position: 'PICK', team: null, marketValue: null }
            : { name: `$${a.amount} FAAB`, position: 'FAAB', team: null, marketValue: null },
      ),
    [pricedBy],
  )

  const give = toLines(giveAssets)
  const get = toLines(getAssets)

  const addAsset = useCallback(
    (side: 'give' | 'get', asset: PickedAsset) => {
      const setter = side === 'give' ? setGiveAssets : setGetAssets
      /* Immutable update — never write into the existing array. */
      setter((prev) => [...prev, asset])
      setPicking(null)
    },
    [],
  )

  const removeAsset = useCallback((side: 'give' | 'get', index: number) => {
    const setter = side === 'give' ? setGiveAssets : setGetAssets
    setter((prev) => prev.filter((_, i) => i !== index))
  }, [])

  /**
   * Take a pending offer from the inbox and make it the deal under
   * construction.
   *
   * ⚠ REPLACES, NEVER APPENDS. Merging an incoming offer into whatever was
   * already on the board would produce a deal nobody proposed, and the verdict
   * would be about that invented deal.
   *
   * ⚠ CLEARS THE VERDICT. The score on screen belongs to the previous deal.
   * Leaving it up while the assets change underneath is the one way this page
   * can state something false.
   */
  const loadOffer = useCallback(
    (give: PickedAsset[], get: PickedAsset[], note: string | null) => {
      setGiveAssets(give)
      setGetAssets(get)
      setResult(null)
      setError(null)
      setDraftNote(note ?? 'Offer loaded — analyse it to get a verdict.')
    },
    [],
  )

  /*
   * ⚠ THE BLOCKED STATE LEADS AND SUPPRESSES THE VERDICT. When the format says
   * this deal cannot happen, a fairness score is arithmetic about an impossible
   * transaction — showing it beneath a blocking banner would still invite
   * someone to read it.
   */
  const blocked = (result?.formatNotes ?? []).length > 0 && /cannot|does not exist|not a deal/i.test(
    (result?.formatNotes ?? [])[0] ?? '',
  )

  const noSignal = useMemo(() => {
    if (!result) return false
    const allUnpriced = [...give, ...get].every((l) => l.marketValue == null)
    return Boolean(result.degraded) || (give.length + get.length > 0 && allUnpriced)
  }, [result, give, get])

  const analyze = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/trade-value/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter: 'ALL',
          leagueId: props.league?.id ?? null,
          /*
           * ⚠ BOTH OF THESE ARE REQUIRED BY THE ROUTE'S SCHEMA, NOT OPTIONAL
           * EXTRAS. `strategy` and `teamContext` carry no `.default()` in
           * app/api/trade-value/analyze/route.ts, so omitting them fails zod
           * and the request comes back 400 before any analysis runs — the
           * button looked wired and never was.
           *
           * 'neutral' is the honest posture: this page does not ask the manager
           * whether they are contending, and guessing one would tilt the
           * narrative on an assumption they never made. 'my_team' is a fact,
           * not a guess — the give side IS the viewer's roster.
           */
          strategy: 'neutral',
          teamContext: 'my_team',
          sideGive: giveAssets.map(toInput),
          sideGet: getAssets.map(toInput),
        }),
      })
      const j = (await r.json().catch(() => ({}))) as AnalyzeResult & { error?: string }
      if (!r.ok) {
        setError(j.error ?? 'Analysis failed.')
        setResult(null)
        return
      }
      setResult(j)
    } catch {
      setError('Network error.')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }, [props.league?.id, giveAssets, getAssets])

  /*
   * ⚠ A LETTER PER SIDE, OR NO LETTER AT ALL. `projectedLetterFor` returns null
   * without signal rather than leaving that judgement to this component, so an
   * unpriced deal shows no badge instead of a C that reads as "even".
   *
   * `percentDiff` is signed from the viewer's side, so the opponent's grade is
   * the mirror of it.
   */
  const yourGrade = projectedLetterFor({
    percentDiff: result?.percentDiff ?? null,
    hasSignal: Boolean(result) && !noSignal,
  })
  const theirGrade = projectedLetterFor({
    percentDiff: result?.percentDiff != null ? -result.percentDiff : null,
    hasSignal: Boolean(result) && !noSignal,
  })

  /*
   * ── Draft persistence ──────────────────────────────────────────
   *
   * ⚠ DEVICE-LOCAL, AND THE UI SAYS SO. No table exists for trade drafts and no
   * JSON column on any user row is a sensible home — stuffing one into, say,
   * `dashboardOnboarding` would confuse the next person to read it far more than
   * it would help here. So a draft lives in this browser and the banner tells
   * the manager that, because "Save draft" with no qualifier implies it will be
   * on their phone later and it will not.
   *
   * A real table is the right end state; this is the version that ships without
   * a production migration.
   */
  const draftKey = props.league?.id ? `af-trade-draft:${props.league.id}` : null

  const saveDraft = useCallback(() => {
    if (!draftKey) return
    try {
      window.localStorage.setItem(
        draftKey,
        JSON.stringify({ give: giveAssets, get: getAssets, at: Date.now() }),
      )
      setDraftNote('Saved on this device.')
    } catch {
      /* Private browsing and full quotas both throw. Say so rather than
         silently doing nothing, which reads as success. */
      setDraftNote('This browser would not store the draft.')
    }
  }, [draftKey, giveAssets, getAssets])

  const restoreDraft = useCallback(() => {
    if (!draftKey) return
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) {
        setDraftNote('No saved draft for this league on this device.')
        return
      }
      const parsed = JSON.parse(raw) as { give?: PickedAsset[]; get?: PickedAsset[] }
      setGiveAssets(Array.isArray(parsed.give) ? parsed.give : [])
      setGetAssets(Array.isArray(parsed.get) ? parsed.get : [])
      /* A restored deal is not an analysed one. */
      setResult(null)
      setDraftNote('Draft restored — analyse it again to get a verdict.')
    } catch {
      setDraftNote('That saved draft could not be read.')
    }
  }, [draftKey])

  const intel = result?.tradeIntelligence

  /*
   * Hand the deal to Chimmy.
   *
   * ⚠ PREFILL, NEVER SEND. The comms contract is explicit: a screen that fires a
   * question off on the user's behalf has spent their request allowance on
   * something they never typed and cannot take back. The question lands in the
   * box and they press send.
   *
   * The prefill names the actual assets rather than saying "this trade", because
   * the drawer does not carry the builder's state and a vague question produces
   * a vague answer.
   */
  const askChimmy = useCallback(() => {
    const side = (label: string, lines: Line[]) =>
      lines.length > 0 ? `${label}: ${lines.map((l) => l.name).join(', ')}` : null

    const parts = [side('I give', give), side('I get', get)].filter(Boolean).join('. ')
    const league = props.league?.name ? ` in ${props.league.name}` : ''
    const verdict = result?.labels?.fairnessLabel
      ? ` The analyzer says: ${result.labels.fairnessLabel}.`
      : ''

    window.dispatchEvent(
      new CustomEvent(COMMS_OPEN_EVENT, {
        detail: {
          tab: 'chimmy',
          prefill: parts
            ? `Explain this trade${league}. ${parts}.${verdict} What am I missing?`
            : `Help me think about a trade${league}.`,
        },
      }),
    )
  }, [give, get, props.league?.name, result])

  return (
    <div className="af-tc">
      <header className="af-tc-head">
        <div className="af-label">Core · Trades</div>
        <h1>Trade Center</h1>
        <p className="af-tc-lede">
          Build a deal across any asset class this league allows. Context below the verdict is
          additive — it never touches the score above it.
        </p>
      </header>

      {props.league ? (
        <div className="af-tc-context">
          <span className="af-tc-context-name">{props.league.name}</span>
          <span className="af-tc-context-meta">
            {[props.league.format, props.league.teamCount ? `${props.league.teamCount} teams` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="af-tc-spacer" />
          {props.opponentLabel ? <span className="af-tc-chip">{props.opponentLabel}</span> : null}
          {props.deadlineLabel ? (
            <span className="af-tc-chip af-tc-chip--deadline">{props.deadlineLabel}</span>
          ) : null}
        </div>
      ) : null}

      {/* The full asset vocabulary, shown regardless of what this deal contains. */}
      <div className="af-tc-legend">
        <span className="af-tc-legend-label">Asset types supported</span>
        {ASSET_TYPES.map((a) => (
          <span key={a.key} className="af-tc-asset-pill">
            <span className="af-tc-glyph" style={{ background: a.color }}>
              {a.glyph}
            </span>
            {a.label}
          </span>
        ))}
      </div>

      {/*
        ⚠ FORMAT BLOCKERS LEAD THE PAGE. This is a correctness statement rather
        than another piece of advice, which is why it is not styled like the
        note cards below.
      */}
      {blocked ? (
        <div className="af-tc-banner af-tc-banner--blocked">
          <span className="af-tc-banner-glyph">!</span>
          <div>
            <p className="af-tc-banner-title">This trade can&rsquo;t be evaluated as shown</p>
            {(result?.formatNotes ?? []).map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </div>
      ) : null}

      {draftKey ? (
        <div className="af-tc-draft">
          <span>Drafts are kept in this browser only — they will not follow you to another device.</span>
          <span className="af-tc-spacer" />
          <button type="button" className="af-btn af-btn--ghost" onClick={restoreDraft}>
            Restore draft
          </button>
          {draftNote ? <span className="af-tc-row-sub">{draftNote}</span> : null}
        </div>
      ) : null}

      {/*
        Inbox and Sent sit ABOVE the builder because that is the order of the
        job: read what was offered, then price it. Below the builder they would
        be a footnote to a deal the manager had already hand-built.
      */}
      <TradeInbox leagueId={props.league?.id ?? null} onLoad={loadOffer} />

      <div className="af-tc-builder">
        {([
          { side: 'give' as const, label: 'Your team', handle: '@you', isYou: true, lines: give },
          {
            side: 'get' as const,
            label: props.opponentLabel ?? 'Their team',
            handle: '',
            isYou: false,
            lines: get,
          },
        ]).map((side) => (
          <div key={side.label} className="af-tc-team">
            <div className="af-tc-team-head">
              <span className="af-tc-team-name">{side.label}</span>
              {side.handle ? <span className="af-tc-team-handle">{side.handle}</span> : null}
              {side.isYou ? <span className="af-tc-you">YOU</span> : null}
            </div>
            <span className="af-tc-sends">Sends</span>

            {side.lines.length === 0 ? (
              <p className="af-tc-row-sub">Nothing added yet.</p>
            ) : (
              side.lines.map((l, i) => (
                <div key={`${side.label}-${l.name}-${i}`} className="af-tc-row">
                  <span className="af-tc-glyph" style={{ background: ASSET_TYPES[0]!.color }}>
                    P
                  </span>
                  <span className="af-tc-row-body">
                    <span className="af-tc-row-name">{l.name}</span>
                    <span className="af-tc-row-sub">
                      {[l.position, l.team].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span
                    className="af-tc-row-value"
                    data-unpriced={l.marketValue == null ? 'true' : undefined}
                  >
                    {money(l.marketValue)}
                  </span>
                  <button
                    type="button"
                    className="af-tc-remove"
                    onClick={() => removeAsset(side.side, i)}
                    aria-label={`Remove ${l.name}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}

            {picking === side.side ? (
              <TradeAssetPicker
                sport={null}
                onClose={() => setPicking(null)}
                onPick={(a) => addAsset(side.side, a)}
              />
            ) : (
              <button
                type="button"
                className="af-tc-add"
                onClick={() => setPicking(side.side)}
              >
                + Add asset
              </button>
            )}

            <div className="af-tc-total">
              <span>Total</span>
              <b>{totalOf(side.lines)}</b>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="af-tc-nosignal">{error}</p> : null}

      {/*
        ⚠ THE VERDICT IS SUPPRESSED WHEN THE FORMAT BLOCKS THE DEAL. A score
        beneath a "this cannot happen" banner still gets read as a score.
      */}
      {result && !blocked ? (
        <section className="af-tc-verdict">
          {yourGrade || theirGrade ? (
            <div className="af-tc-grade-row">
              {[
                { label: 'You', letter: yourGrade },
                { label: props.opponentLabel ?? 'Them', letter: theirGrade },
              ].map((g) =>
                g.letter ? (
                  <div key={g.label} className="af-tc-grade" data-letter={g.letter}>
                    <span className="af-tc-grade-letter">{g.letter}</span>
                    <span className="af-tc-grade-for">{g.label}</span>
                  </div>
                ) : null,
              )}
            </div>
          ) : null}

          <div className="af-tc-labels">
            <strong>{result.labels?.fairnessLabel ?? 'No verdict'}</strong>
            {result.labels?.confidenceLabel ? (
              <span className="af-tc-conf">· {result.labels.confidenceLabel}</span>
            ) : null}
          </div>

          {typeof result.fairnessScore === 'number' ? (
            <div className="af-tc-track">
              <span
                className="af-tc-dot"
                style={{ left: `${Math.max(0, Math.min(100, result.fairnessScore))}%` }}
              />
            </div>
          ) : null}

          {/*
            gradeScale.ts: C spans a wide band, so a trade we know nothing about
            lands mid-C and reads identically to a genuinely even one. This is
            the callout that keeps those apart.
          */}
          {noSignal ? (
            <p className="af-tc-nosignal">
              We could not price enough of this deal to stand behind a verdict. An even-looking
              score here means we have no signal, not that the trade is fair.
            </p>
          ) : null}

          {(result.dataGaps ?? []).length > 0 ? (
            <>
              <div className="af-label">What we couldn&rsquo;t see</div>
              <ul className="af-tc-gaps">
                {(result.dataGaps ?? []).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {/* Additive context. Never merged with the verdict above. */}
      {result ? (
        <div className="af-tc-notes">
          {NOTE_GROUPS.map((g) => {
            const notes = (result[g.key] as string[] | undefined) ?? []
            if (notes.length === 0) return null
            return (
              <div key={g.tone} className="af-tc-note" data-tone={g.tone}>
                <p className="af-tc-note-title">{g.title}</p>
                {notes.map((n) => (
                  <p key={n}>{n}</p>
                ))}
              </div>
            )
          })}
        </div>
      ) : null}

      {intel ? (
        <section className="af-tc-dos">
          <div className="af-label">Decision OS · this deal</div>
          {intel.why ? <p className="af-tc-why">{intel.why}</p> : null}

          <div className="af-tc-pairs">
            <div className="af-tc-pair">
              <div className="af-tc-pair-label">Wins now</div>
              <div className="af-tc-pair-value">{intel.whoWinsNow ?? '—'}</div>
            </div>
            <div className="af-tc-pair">
              <div className="af-tc-pair-label">Wins long term</div>
              <div className="af-tc-pair-value">{intel.whoWinsLongTerm ?? '—'}</div>
            </div>
          </div>

          {(intel.tradeWarnings ?? []).length > 0 ? (
            <>
              <div className="af-label">Warnings</div>
              <ul className="af-tc-list af-tc-list--warn">
                {(intel.tradeWarnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          ) : null}

          {(intel.rebalanceSuggestions ?? []).length > 0 ? (
            <>
              <div className="af-label">Rebalance ideas</div>
              <ul className="af-tc-list">
                {(intel.rebalanceSuggestions ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}

          {(intel.alternateTargets ?? []).length > 0 ? (
            <>
              <div className="af-label">Counter targets</div>
              <ul className="af-tc-list">
                {(intel.alternateTargets ?? []).map((t) => (
                  <li key={t.name}>
                    {t.name}
                    {t.position ? ` · ${t.position}` : ''} — {money(t.marketValue)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {intel.alternateTargetsNote ? (
            <p className="af-tc-row-sub">{intel.alternateTargetsNote}</p>
          ) : null}
        </section>
      ) : null}

      {/*
        The proposal sits AFTER the verdict, not beside the builder. Sending a
        deal is the last thing you do, and putting the button next to the assets
        invites sending one before it has been priced.
      */}
      <TradeProposePanel
        leagueId={props.league?.id ?? null}
        give={giveAssets}
        get={getAssets}
      />

      <TradeFinderPanel leagueId={props.league?.id ?? null} />

      <div className="af-tc-actions">
        <p className="af-tc-caption">
          Grades here are projected, not realized — they price the deal as it stands today rather
          than how it turns out.
        </p>
        <button
          type="button"
          className="af-btn"
          onClick={analyze}
          disabled={busy || (giveAssets.length === 0 && getAssets.length === 0)}
        >
          {busy ? 'Analyzing…' : 'Analyze this trade'}
        </button>
        <button
          type="button"
          className="af-btn af-btn--ghost"
          onClick={saveDraft}
          disabled={!draftKey || (giveAssets.length === 0 && getAssets.length === 0)}
        >
          Save draft
        </button>
        <button type="button" className="af-btn af-btn--ghost" onClick={askChimmy}>
          Ask Chimmy to explain
        </button>
      </div>
    </div>
  )
}
