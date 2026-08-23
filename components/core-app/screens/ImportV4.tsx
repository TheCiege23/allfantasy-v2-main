'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
/*
 * ⚠ af-core.css FIRST, AND IT IS LOAD BEARING — the same omission that shipped on the landing
 * page and again on LeagueHome. This screen's root is <div className="af-core af-im">, and the
 * `.af-core` token layer (--surface, --line, --accent, --text2 …) plus the shared primitives it
 * carries (.af-platform, .af-btn, .af-label, .af-chip, .af-readonly, .af-num) all live in
 * af-core.css. af-import.css defines only the `af-im-*` rules on top of them.
 *
 * Without this import nothing throws and nothing 404s: every var() resolves to nothing, so the
 * platform cards paint transparent with 0px borders, the buttons lose their chrome and render as
 * bare text, and the screen reads as a broken/older design. It looked FINE whenever the user
 * arrived by client-side navigation from a screen that had already imported af-core.css (AuthV4,
 * LandingV4, PricingV4 …) and broken on a direct load or hard refresh of /import — which is what
 * made it appear to "keep reverting".
 *
 * It has to be a JS import, not an `@import` inside af-import.css: per app/layout.tsx, an @import
 * inside a route-bundled CSS file is dropped whenever another af-*.css is concatenated ahead of it.
 */
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import.css'
import {
  IMPORT_PROVIDER_UI_OPTIONS,
  getImportProviderLabel,
  isImportProviderAvailable,
  supportsImportProviderDiscovery,
} from '@/lib/league-import/provider-ui-config'
import {
  discoverProviderLeagues,
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import type { ImportProvider } from '@/lib/league-import/types'

/**
 * Import & connect — the "landing, auth & import" handoff, wired to the real job.
 *
 * ⚠ THIS DRIVES THE SAME PIPELINE AS THE LIVE IMPORT, VIA THE SAME CLIENT SERVICE.
 * discover → preview → commit, through LeagueCreationImportSubmissionService, which
 * is what components/unified-import-ui/LeagueImportFlow.tsx already uses. Nothing
 * here re-implements a fetch against /api/leagues/import/*: a second copy of that
 * sequence would drift from the first, and the error mapping alone (verification,
 * age gate, "Connect Yahoo in League Sync", ESPN cookie expiry) is a body of
 * knowledge worth exactly one implementation.
 *
 * ⚠ PROVIDER AVAILABILITY COMES FROM provider-ui-config, NEVER FROM THIS FILE.
 * The handoff draws six selectable providers; only sleeper, espn and yahoo are
 * usable end to end. Showing all six is right; letting someone pick one that
 * cannot finish is not.
 *
 * ⚠ YAHOO TAKES NO IDENTIFIER. It lists leagues from the user's CONNECTED Yahoo
 * account over OAuth, so the handoff's "each provider swaps its own field" does
 * not hold for it. Sleeper also discovers from a linked account when the username
 * is left blank, which is why discovery is attempted automatically for both.
 *
 * ⚠ THE ATTESTATION STEP IS NOT OPTIONAL. The server gate returns
 * requiresAttestation when a verified member imports a league they do not
 * commission, or when a provider cannot be auto-verified. Treating that as a plain
 * error would dead-end every such import, so it renders a confirm panel and
 * re-submits with the attestation attached — the same shape the live flow sends.
 */

export type ImportPreviewState = 'pick' | 'connecting' | 'result'

/** Same lockup as the landing, pricing and auth screens. */
function Shield() {
  return (
    <svg width="26" height="28" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}

/**
 * The auth → connect → choose-leagues progress bar (handoffs 4b/4c/4d).
 *
 * Presentational only: the caller derives `current` from real phase, so this
 * cannot drift from what the screen is actually showing.
 */
function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="af-im-steps" role="group" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="af-im-step"
          data-done={i < current ? 'true' : undefined}
          aria-hidden
        />
      ))}
    </div>
  )
}

type DiscoveredLeague = {
  sourceId: string
  name: string
  sport?: string
  season?: string
  totalTeams?: number
}

type Phase =
  | { k: 'idle' }
  | { k: 'discovering' }
  | { k: 'previewing'; sourceId: string }
  | { k: 'attest'; sourceId: string; message: string }
  | { k: 'preview'; sourceId: string; leagueName: string; attested: boolean }
  | { k: 'committing'; sourceId: string }
  | { k: 'done'; leagueId: string; leagueName: string; backfilled: boolean }

const FIELD_BY_PROVIDER: Partial<
  Record<ImportProvider, { label: string; placeholder: string; help: string }>
> = {
  sleeper: {
    label: 'Sleeper username',
    placeholder: 'your-sleeper-username',
    help: 'We look up your public leagues from this username. No password, ever. Leave it blank to use the Sleeper account already linked to your profile.',
  },
  espn: {
    label: 'ESPN league ID',
    placeholder: '123456',
    /*
     * ⚠ "Public leagues import directly" WAS NOT TRUE, and it cost a real user a
     * long detour. ESPN import is gated on finding YOUR team in the league, which
     * commissionerGate resolves from the SWID cookie -- so a connected ESPN account
     * is required for every ESPN league, public ones included. The old copy sent
     * people to type an ID that could not work, and the failure then pointed at
     * League Sync rather than at the settings page that actually fixes it.
     */
    help: 'Connect ESPN once under Settings → Connected Accounts, then paste a league ID here. We read the league as you — we never ask for your ESPN password.',
  },
}

/** Why an unavailable provider cannot be used, in the user's terms. */
const BLOCKED_REASON: Partial<Record<ImportProvider, string>> = {
  fantrax: 'Upload pipeline is not accepting new leagues yet.',
  mfl: 'Private MFL leagues need an API key, and there is no way to enter one yet.',
  fleaflicker: 'No connected path from this flow yet.',
}

/**
 * Some gate failures name a prerequisite without saying where to satisfy it —
 * "Link your Sleeper account…", "Connect Yahoo in League Sync…", "Reconnect ESPN…".
 * Observed live: the Sleeper commissioner check returns exactly that and the
 * screen had no way forward, which turns a solvable setup step into a dead end.
 * LeagueSyncDashboard (/leagues) is where every one of those connections is made,
 * so the message gets a destination.
 *
 * Matched on the action words rather than on exact strings: these sentences come
 * from several gates and are edited independently, and a literal match would
 * quietly stop working the first time one is reworded.
 */
function needsConnectionSetup(message: string): boolean {
  return /\b(link|connect|reconnect)\b/i.test(message)
}

/**
 * Per-league outcome of a bulk run, in the user's terms. "Already imported" is a
 * success state, not a failure — the league is present and was not overwritten.
 */
const BULK_STATUS_LABEL: Record<
  'importing' | 'done' | 'exists' | 'needs-attestation' | 'failed',
  string
> = {
  importing: 'Importing…',
  done: 'Imported',
  exists: 'Already imported',
  'needs-attestation': 'Needs your confirmation',
  failed: 'Failed',
}

/**
 * Where Yahoo's OAuth round-trip starts, and where it comes back to. `returnTo`
 * carries the provider so the user lands on the Yahoo tab they chose rather than
 * the default Sleeper one.
 */
const YAHOO_CONNECT_HREF = `/api/auth/yahoo?returnTo=${encodeURIComponent('/import?provider=yahoo')}`

/**
 * Yahoo's own description is the useful half. "This application is not authorized to
 * perform this action" names the exact missing permission and is actionable in the
 * Yahoo console; `user_fetch_failed` is actionable by nobody. Prefer Yahoo's words,
 * and only fall back to our own when it gave none.
 */
function describeYahooError(code: string, description?: string): string {
  if (description) return description
  switch (code) {
    case 'not_configured':
      return 'Yahoo is not configured on this deployment yet.'
    case 'invalid_state':
      return 'That Yahoo sign-in expired before it finished. Please try again.'
    case 'no_code':
      return 'Yahoo did not send back an authorisation code. Please try again.'
    case 'token_failed':
      return 'Yahoo would not exchange that sign-in for a token. Please try again.'
    case 'user_fetch_failed':
      return 'Yahoo signed you in, but would not share your fantasy account.'
    default:
      return `Yahoo returned an error: ${code}`
  }
}

/**
 * 6a build rule 2: the read / never-do split IS the trust contract for the whole import flow, and
 * it has to appear on this first screen rather than being discovered later. It replaces the older
 * one-line promise, which said the same thing but only in the abstract — "we only read your league
 * history" does not tell anyone whether we can set their lineup.
 *
 * The two halves are deliberately concrete and symmetrical: every item on the right is a thing a
 * competitor's integration CAN do, which is what makes the left column mean anything.
 */
function ReadOnlyPromise() {
  return (
    <div className="af-im-trust">
      <div className="af-im-trust-col">
        <span className="af-label af-im-trust-read">What we read</span>
        <p className="af-im-trust-body">
          Teams · rosters · matchups · scoring settings · past seasons
        </p>
      </div>
      <div className="af-im-trust-col">
        <span className="af-label af-im-trust-never">What we never do</span>
        <p className="af-im-trust-body">
          Set lineups · make trades · post in chat · ask for your platform password
        </p>
      </div>
    </div>
  )
}

/**
 * ⚠ INDETERMINATE ON PURPOSE — THE HANDOFF'S DETERMINATE BAR CANNOT BE HONEST HERE.
 * /api/leagues/import/commit is synchronous: it returns the persisted league and
 * never a job id, so there is nothing to poll and no percentage that means
 * anything. The previous version animated a hardcoded 40% and "2 of 5", which is
 * an invented number on the one screen whose entire promise is that the data is
 * real. This says what is happening and admits it does not know how long.
 */
function Working({ label }: { label: string }) {
  return (
    <div className="af-im-working" role="status" aria-live="polite">
      <span className="af-im-spinner" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

/**
 * ⚠ THESE PROPS ARE NOT DECORATION — THEY ARE THE PAGE'S EXISTING ENTRY POINTS.
 * /import is linked to with `?provider=`, `?username=`, `?leagueId=`/`?sourceId=`
 * and `?returnTo=` from the legacy funnel, the create-league flow and the
 * source-platform deep links. Rendering this screen without honouring them would
 * silently drop every one of those into a blank Sleeper form — the link would
 * still "work", it would just ignore what it was asked to do.
 */
export type ImportV4Props = {
  state?: ImportPreviewState
  defaultProvider?: ImportProvider
  initialAccount?: string
  initialLeagueSourceId?: string
  /** Where "not now" goes back to. Validated by the server as a relative path. */
  returnTo?: string
  /** Outcome of a Yahoo OAuth round-trip, read off the query by the server. */
  yahooError?: string
  /** Yahoo's own sentence, when it gave one. Far more useful than the code. */
  yahooErrorDesc?: string
  yahooConnected?: boolean
}

export function ImportV4({
  state,
  defaultProvider,
  initialAccount,
  initialLeagueSourceId,
  returnTo,
  yahooError,
  yahooErrorDesc,
  yahooConnected,
}: ImportV4Props) {
  const [provider, setProvider] = useState<ImportProvider>(defaultProvider ?? 'sleeper')
  const [account, setAccount] = useState(initialAccount ?? '')
  const [leagues, setLeagues] = useState<DiscoveredLeague[]>([])
  const [accountLabel, setAccountLabel] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ k: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const selectable = isImportProviderAvailable(provider)
  // Provider display name comes from the shared config, never a local literal — the same
  // reason availability does (see the header note).
  const providerLabel = getImportProviderLabel(provider)
  const field = FIELD_BY_PROVIDER[provider]
  const canDiscover = supportsImportProviderDiscovery(provider)
  // Yahoo has no identifier at all; Sleeper falls back to the linked account.
  const usesConnectedAccount = provider === 'yahoo'

  const reset = useCallback(() => {
    setLeagues([])
    setAccountLabel(null)
    setPhase({ k: 'idle' })
    setError(null)
  }, [])

  const runDiscover = useCallback(
    async (identifier: string) => {
      setError(null)
      setLeagues([])
      setPhase({ k: 'discovering' })
      const res = await discoverProviderLeagues(provider, identifier, { sport: 'nfl' })
      if (!res.ok) {
        // The service already translates the gate's codes into sentences a person
        // can act on ("Connect Yahoo in League Sync…"), so it is surfaced as-is.
        const message = res.error || 'We could not look up leagues for that account.'
        /**
         * Yahoo takes no identifier, so "not connected yet" is not a mistake the user
         * made -- it is simply the next step, and the only next step. Rendering that
         * sentence with a second link to click turned connecting Yahoo into a
         * three-screen errand: pick Yahoo, press Connect, read an error, press
         * another Connect. Send them straight to Yahoo instead.
         *
         * Only for yahoo: Sleeper and ESPN failures are genuinely actionable on this
         * screen (wrong username, expired ESPN cookie), so those still surface.
         */
        if (provider === 'yahoo' && needsConnectionSetup(message)) {
          window.location.href = YAHOO_CONNECT_HREF
          return
        }
        setError(message)
        setPhase({ k: 'idle' })
        return
      }
      const payload = res.data as { leagues?: DiscoveredLeague[]; accountLabel?: string }
      setLeagues(payload?.leagues ?? [])
      setAccountLabel(payload?.accountLabel ?? null)
      setPhase({ k: 'idle' })
    },
    [provider]
  )

  /*
   * Sleeper (linked account) and Yahoo (connected OAuth) can list leagues with no
   * input at all, so the lookup runs on selection rather than making someone press
   * a button that needs nothing from them. A failure here is silent by design — it
   * usually means "not connected yet", which is not an error until they ask.
   */
  useEffect(() => {
    if (!isImportProviderAvailable(provider)) return
    if (!supportsImportProviderDiscovery(provider)) return
    let cancelled = false
    void discoverProviderLeagues(provider, '', { sport: 'nfl' }).then((res) => {
      if (cancelled || !res.ok) return
      const payload = res.data as { leagues?: DiscoveredLeague[]; accountLabel?: string }
      if (!payload?.leagues?.length) return
      setLeagues(payload.leagues)
      setAccountLabel(payload.accountLabel ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [provider])

  /*
   * ⚠ A DEEP LINK CARRYING A LEAGUE ID GOES STRAIGHT TO PREVIEW, ONCE. That link
   * is someone clicking "import this league" from somewhere else; making them
   * re-find it in a discovery list would discard the only thing the link knew.
   * The ref guard matters because `runPreview` is rebuilt whenever provider
   * changes, and re-firing would restart a preview the user had already moved on
   * from.
   */
  const deepLinked = useRef(false)

  const runPreview = useCallback(
    async (sourceId: string, attest = false) => {
      setError(null)
      setPhase({ k: 'previewing', sourceId })
      const res = await fetchImportPreview(provider, sourceId, attest ? { accepted: true } : undefined)
      if (!res.ok) {
        if (res.requiresAttestation) {
          setPhase({
            k: 'attest',
            sourceId,
            message: res.error || 'Confirm you want to import this league.',
          })
          return
        }
        setError(res.error || 'We could not read that league.')
        setPhase({ k: 'idle' })
        return
      }
      const payload = res.data as { league?: { name?: string } }
      setPhase({
        k: 'preview',
        sourceId,
        leagueName: payload?.league?.name?.trim() || 'Your league',
        attested: attest,
      })
    },
    [provider]
  )

  useEffect(() => {
    if (!initialLeagueSourceId || deepLinked.current) return
    if (!isImportProviderAvailable(provider)) return
    deepLinked.current = true
    void runPreview(initialLeagueSourceId)
  }, [initialLeagueSourceId, provider, runPreview])

  const runCommit = useCallback(
    async (sourceId: string, attested: boolean) => {
      setError(null)
      setPhase({ k: 'committing', sourceId })
      const res = await submitImportCreation(
        provider,
        sourceId,
        '',
        attested ? { accepted: true } : undefined
      )
      if (!res.ok) {
        /**
         * ⚠ COMMIT CAN DEMAND AN ATTESTATION THAT PREVIEW DID NOT. The commit route
         * passes `requireCommissioner: true`; preview does not. Its comment calls
         * that a no-op for non-Sleeper providers, but it is not: checkEspn returns
         * `isCommissioner: undefined` whenever the viewer is absent from ESPN's own
         * commissioner list, and undefined is not false -- the gate asks for the
         * attestation instead.
         *
         * runPreview has always routed that to the confirm panel. This did not, so
         * an ESPN member who is not a detected commissioner reached "Ready to
         * import", pressed the button, and was returned to an empty screen with a
         * sentence they could not act on -- the confirm panel they needed only ever
         * appeared on the preview path. Observed in production: preview 200, commit
         * 403, no league created.
         */
        if (res.requiresAttestation) {
          setPhase({
            k: 'attest',
            sourceId,
            message: res.error || 'Confirm you are authorized to import this league.',
          })
          return
        }
        setError(res.error || 'We could not finish that import.')
        setPhase({ k: 'idle' })
        return
      }
      const data = res.data as unknown as {
        leagueId?: string
        name?: string
        league?: { id: string; name: string }
        historicalBackfill?: unknown
      }
      const leagueId = data?.leagueId || data?.league?.id || ''
      setPhase({
        k: 'done',
        leagueId,
        leagueName: data?.name || data?.league?.name || 'Your league',
        backfilled: Boolean(data?.historicalBackfill),
      })
    },
    [provider]
  )

  /**
   * ── Bulk import ("Import all") ──────────────────────────────────────────────
   *
   * Restores a capability the previous flow had and this screen shipped without:
   * components/unified-import-ui/LeagueImportFlow.tsx has had `runBulkImport`
   * throughout. Someone with 55 discovered Sleeper leagues had to press Import 55
   * times here.
   *
   * ⚠ SEQUENTIAL, THROUGH THE SAME COMMIT CALL AS A SINGLE IMPORT. Not a new
   * endpoint and not a parallel fan-out: identical commissioner gate, identical
   * normalisation and backfill. Running these concurrently would multiply provider
   * calls and races for no benefit the user can see.
   *
   * ⚠ EVERY OUTCOME IS REPORTED. imported / already imported / needs commissioner
   * confirmation / failed. A league already present is NOT an error and is never
   * overwritten -- reporting it as failed would push people to re-import leagues
   * that are already fine.
   */
  type BulkStatus = 'importing' | 'done' | 'exists' | 'needs-attestation' | 'failed'
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkDone, setBulkDone] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<Record<string, BulkStatus>>({})

  /*
   * ── Which discovered leagues to bring in (handoff 4d) ──────────────────────
   *
   * The design puts a checkbox on every row and labels the button with the live
   * count. This sits ON TOP of the bulk machinery below rather than replacing
   * it: same sequential `submitImportCreation` loop, same per-league outcome
   * reporting, just over a chosen subset instead of everything.
   *
   * ⚠ EVERYTHING DEFAULTS CHECKED, WHICH DEPARTS FROM 4d BUILD RULE 1. That rule
   * says archived leagues default unchecked — and it is a good rule. But the
   * discovery payload is `{ sourceId, name, sport?, season?, totalTeams? }` with
   * NO archived or status field, so there is nothing to test. Inferring it from
   * `season` would be a guess, and a wrong guess silently drops a league the
   * user wanted while the button still reads as if it took everything. Defaulting
   * checked fails in the recoverable direction: the rows are visible and
   * unticking one takes a single click. Restore the rule the moment discovery
   * carries a real status.
   */
  const [excluded, setExcluded] = useState<Record<string, true>>({})
  const selectedLeagues = leagues.filter((l) => !excluded[l.sourceId])

  const toggleLeague = useCallback((sourceId: string) => {
    setExcluded((prev) => {
      const next = { ...prev }
      if (next[sourceId]) delete next[sourceId]
      else next[sourceId] = true
      return next
    })
  }, [])

  const runBulkImport = useCallback(async () => {
    if (bulkRunning || selectedLeagues.length === 0) return
    setBulkRunning(true)
    setBulkDone(false)
    setBulkStatus({})
    setError(null)
    for (const league of selectedLeagues) {
      setBulkStatus((prev) => ({ ...prev, [league.sourceId]: 'importing' }))
      const res = await submitImportCreation(provider, league.sourceId, '')
      /*
       * Attestation is deliberately NOT auto-accepted here. The server asks for it
       * when someone imports a league they do not commission, and answering that on
       * their behalf across dozens of leagues would be attesting to something they
       * never read. Those are surfaced for a one-by-one decision instead.
       */
      /*
       * ⚠ `res.ok` ALONE CANNOT MEAN "IMPORTED". The commit route 200s for an
       * idempotent replay too — a league already imported short-circuits on the
       * import-run key and never reaches the 409 path, which only fires for a
       * league that has never completed a run. A production bulk run over 55
       * leagues reported "33 imported" while importing exactly none of them.
       */
      const status: BulkStatus = res.ok
        ? res.existed
          ? 'exists'
          : 'done'
        : res.status === 409
          ? 'exists'
          : res.requiresAttestation
            ? 'needs-attestation'
            : 'failed'
      setBulkStatus((prev) => ({ ...prev, [league.sourceId]: status }))
    }
    setBulkRunning(false)
    setBulkDone(true)
  }, [bulkRunning, selectedLeagues, provider])

  const bulkCounts = (() => {
    const v = Object.values(bulkStatus)
    return {
      done: v.filter((s) => s === 'done').length,
      exists: v.filter((s) => s === 'exists').length,
      needsAttestation: v.filter((s) => s === 'needs-attestation').length,
      failed: v.filter((s) => s === 'failed').length,
      processed: v.filter((s) => s !== 'importing').length,
    }
  })()

  /*
   * ⚠ DESIGN-PREVIEW ESCAPE HATCH, NOT THE DEFAULT. `?state=` renders the static
   * connecting/result frames so the handoff can still be reviewed without running
   * a real import. Everything else on this screen is live.
   */
  const forcedState = state && state !== 'pick' ? state : null

  /*
   * Which of the three journey segments are filled, derived rather than typed.
   *
   * Reaching this screen at all means sign-up is behind you, so the floor is 2.
   * Once discovery has returned leagues the reader is on 4d ("choose leagues"),
   * which the handoff draws as all three filled.
   */
  const stepsFilled = leagues.length > 0 ? 3 : 2

  /*
   * The header chip becomes "<PLATFORM> CONNECTED" on 4d, per the handoff. Only
   * claimed once discovery has actually returned that provider's leagues —
   * saying "connected" before anything came back would be asserting a state we
   * have not observed.
   */
  const connectedLabel =
    leagues.length > 0
      ? `${(IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider)?.label ?? provider).toUpperCase()} CONNECTED`
      : null

  return (
    <div className="af-core af-im">
      {/*
        ── Top bar, per handoffs 4c/4d ──────────────────────────────────
        Brand left; on the right the READ-ONLY chip that every signed-in screen
        carries, and an escape hatch. 4c build rule 5: this step is never a
        forced gate, so "Skip for now" has to stay reachable — someone who
        arrived here from sign-up must be able to reach the product without
        connecting a platform first.
      */}
      <div className="af-im-topbar">
        <Link href="/" className="af-im-brand" aria-label="AllFantasy — home">
          <Shield />
          <span className="af-im-wordmark">AllFantasy</span>
        </Link>
        <div className="af-im-topbar-right">
          {connectedLabel ? (
            <span className="af-im-connected af-num">{connectedLabel}</span>
          ) : (
            <span
              className="af-im-readonly af-num"
              title="We only ever read from your platform. Nothing here changes your lineup, roster or league."
            >
              Read-only
            </span>
          )}
          <Link href="/dashboard" className="af-im-skip">
            Skip for now
          </Link>
        </div>
      </div>

      {/*
        ⚠ STEP 2 OF 3, AND THE STEPS ARE REAL. The handoff defines an
        auth → connect → choose-leagues journey (4b → 4c → 4d): sign-up fills
        one segment, this screen two, and the league picker below fills all
        three. `stepsFilled` is derived from the live phase rather than being
        typed per branch, so the bar cannot claim a step the screen is not on.

        The sign-up screen draws its own copy of this bar (AuthV4). Unifying
        them into one shared component is worth doing once both have landed —
        deliberately not done here, because AuthV4 sits on a different unmerged
        branch and a shared file would collide.
      */}
      <StepBar current={stepsFilled} total={3} />

      <header className="af-im-head">
        <span className="af-label">Connect your league to AllFantasy</span>
        <h1 className="af-im-title">Connect your league in seconds.</h1>
        <p className="af-im-sub">
          Pick your platform and drop in your Sleeper username or league ID. We build a read-only
          copy of your real teams, matchups and scoring &mdash; AllFantasy analyzes your league but
          never changes anything on the external platform.
        </p>
      </header>

      {/*
        The outcome of a Yahoo round-trip. Both of these were previously written to
        the query string and read by nothing, so a failed connect looked identical
        to never having tried.
      */}
      {yahooError ? (
        <div className="af-im-error" role="alert">
          <p className="af-im-error-text">{describeYahooError(yahooError, yahooErrorDesc)}</p>
          <a className="af-im-error-link" href={YAHOO_CONNECT_HREF}>
            Try connecting Yahoo again →
          </a>
        </div>
      ) : yahooConnected ? (
        <div className="af-im-note" role="status">
          <p>Yahoo is connected. Your Yahoo leagues are listed below.</p>
        </div>
      ) : null}

      {/* ── Step 1: provider picker ─────────────────────────────────── */}
      <section className="af-im-card">
        {/*
          The section heading used to repeat the h1 verbatim ("Where do you already play?"),
          so the page asked the same question twice in a row. 6a asks it once, in the h1.
        */}
        <div className="af-im-providers">
          {IMPORT_PROVIDER_UI_OPTIONS.map((opt) => {
            const available = opt.available
            const active = provider === opt.provider
            return (
              <button
                key={opt.provider}
                type="button"
                className="af-im-provider"
                data-active={active}
                data-available={available}
                disabled={!available}
                aria-disabled={!available}
                onClick={() => {
                  if (!available) return
                  setProvider(opt.provider)
                  setAccount('')
                  reset()
                }}
              >
                <span className="af-im-provider-top">
                  <span className="af-platform af-im-mark" data-platform={opt.provider}>
                    {opt.label.charAt(0)}
                  </span>
                  <span className="af-im-provider-label">{opt.label}</span>
                  {!available ? <span className="af-im-soon af-num">soon</span> : null}
                </span>
                <span className="af-im-provider-meta">
                  {available
                    ? supportsImportProviderDiscovery(opt.provider)
                      ? 'Finds your leagues automatically'
                      : 'League ID · read-only'
                    : BLOCKED_REASON[opt.provider] ?? 'Not connectable yet.'}
                </span>
                <span className="af-im-provider-sports af-num">
                  {opt.supportedSports.join(' · ')}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Step 2: the provider's own field ──────────────────────── */}
        {selectable && phase.k !== 'done' ? (
          <div className="af-im-field-block">
            {field ? (
              <label className="af-im-field">
                <span className="af-label">{field.label}</span>
                <input
                  type="text"
                  placeholder={field.placeholder}
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (canDiscover) void runDiscover(account.trim())
                    else if (account.trim()) void runPreview(account.trim())
                  }}
                />
                <span className="af-im-field-help">{field.help}</span>
              </label>
            ) : (
              <div className="af-im-field">
                <span className="af-label">Yahoo account</span>
                <p className="af-im-field-help">
                  Yahoo lists leagues from the account you connect — there is no username to enter.
                  You will be sent to Yahoo to approve read-only access.
                </p>
              </div>
            )}

            <button
              type="button"
              className="af-btn af-im-submit"
              disabled={phase.k === 'discovering' || phase.k === 'previewing'}
              onClick={() => {
                if (canDiscover) void runDiscover(account.trim())
                else if (account.trim()) void runPreview(account.trim())
                else setError('Enter a league ID to continue.')
              }}
            >
              {/*
                "Find my leagues" only makes sense when there is something to
                search from. Yahoo supports discovery but takes no identifier, so
                the same label there would promise a search of something never
                entered.
              */}
              {usesConnectedAccount
                ? 'Connect Yahoo'
                : canDiscover
                  ? 'Find my leagues'
                  : 'Connect'}
            </button>

            {/*
              6a: the account line that sits directly under the connect action. The promise it
              makes ("read-only, no password, ever") is the same one the trust card below spells
              out, and it belongs here because this is the moment someone decides to type.
            */}
            <p className="af-im-account-note">
              <span aria-hidden>🔒</span> Create a free account to connect your{' '}
              {providerLabel} league — read-only, no password, ever.
            </p>

            {phase.k === 'discovering' ? <Working label="Looking up your leagues…" /> : null}

            {error ? (
              <div className="af-im-error" role="alert">
                <p className="af-im-error-text">{error}</p>
                {needsConnectionSetup(error) ? (
                  provider === 'yahoo' ? (
                    /*
                      Yahoo used to send the user to /leagues to "connect in League Sync",
                      which meant: leave this screen, find the sync dashboard, authorise,
                      then come back here and start over. Six pages to import one league.
                      This starts the OAuth directly and returns to this screen, already
                      on the Yahoo tab. Plain <a>, not <Link> -- the target is an API
                      route that answers with a redirect, so client-side nav must not
                      intercept it.
                    */
                    <a
                      href={YAHOO_CONNECT_HREF}
                      className="af-im-error-link"
                    >
                      Connect Yahoo →
                    </a>
                  ) : (
                    /*
                      ESPN is fixed in Settings → Connected Accounts, where the
                      cookie form lives -- not in League Sync. Sending an ESPN user
                      to /leagues gave them a page with no ESPN control on it, which
                      is how a solvable setup step read as "import is broken".
                    */
                    <Link
                      href={provider === 'espn' ? '/settings' : '/leagues'}
                      className="af-im-error-link"
                    >
                      {provider === 'espn'
                        ? 'Connect ESPN in Settings →'
                        : 'Connect your accounts in League Sync →'}
                    </Link>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <ReadOnlyPromise />
      </section>

      {/* ── Discovered leagues ──────────────────────────────────────── */}
      {leagues.length > 0 && phase.k !== 'done' ? (
        <section className="af-im-card">
          <header className="af-im-result-head">
            <h2 className="af-label">
              {accountLabel ? `Leagues for ${accountLabel}` : 'Leagues we found'}
            </h2>
            <span className="af-chip af-num">{leagues.length}</span>
          </header>

          {/*
            Import all. Only worth offering when there is more than one, and hidden
            once a single import has taken over the screen.
          */}
          {leagues.length > 1 ? (
            <div className="af-im-bulk">
              {/*
                ⚠ THE LABEL COUNTS WHAT IS TICKED, NOT WHAT WAS FOUND (4d build
                rule 3). A button reading "Import 4 leagues" beside three ticked
                boxes is the kind of small lie that costs trust at the last step
                of a funnel — and this IS the last step.
              */}
              <button
                type="button"
                className="af-btn af-im-bulk-btn"
                disabled={
                  bulkRunning ||
                  selectedLeagues.length === 0 ||
                  phase.k === 'previewing' ||
                  phase.k === 'committing'
                }
                onClick={() => void runBulkImport()}
              >
                {bulkRunning
                  ? `Importing… ${bulkCounts.processed} of ${selectedLeagues.length}`
                  : selectedLeagues.length === 0
                    ? 'Pick at least one league'
                    : `Import ${selectedLeagues.length} ${selectedLeagues.length === 1 ? 'league' : 'leagues'}`}
              </button>
              {bulkDone ? (
                <p className="af-im-bulk-summary" role="status">
                  {[
                    bulkCounts.done ? `${bulkCounts.done} imported` : null,
                    bulkCounts.exists ? `${bulkCounts.exists} already imported` : null,
                    bulkCounts.needsAttestation
                      ? `${bulkCounts.needsAttestation} need you to confirm you can import them — do those individually`
                      : null,
                    bulkCounts.failed ? `${bulkCounts.failed} failed` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="af-im-league-list">
            {leagues.map((l) => {
              const busy =
                (phase.k === 'previewing' || phase.k === 'committing') && phase.sourceId === l.sourceId
              return (
                <li
                  key={l.sourceId}
                  className="af-im-league"
                  data-picked={!excluded[l.sourceId] && leagues.length > 1 ? 'true' : undefined}
                >
                  {/*
                    Only offered when there is more than one league — a lone
                    result has nothing to choose between, and a checkbox there
                    would imply the single "Import" button below it might not
                    apply to it.
                  */}
                  {leagues.length > 1 ? (
                    <input
                      type="checkbox"
                      className="af-im-league-check"
                      checked={!excluded[l.sourceId]}
                      disabled={bulkRunning || Boolean(bulkStatus[l.sourceId])}
                      onChange={() => toggleLeague(l.sourceId)}
                      aria-label={`Include ${l.name} in the import`}
                    />
                  ) : null}
                  <span className="af-im-league-main">
                    <span className="af-im-league-name">{l.name}</span>
                    <span className="af-im-league-meta af-num">
                      {[l.season, l.sport?.toUpperCase(), l.totalTeams ? `${l.totalTeams} teams` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {bulkStatus[l.sourceId] ? (
                    <span
                      className={`af-im-league-status af-im-league-status--${bulkStatus[l.sourceId]}`}
                      role="status"
                    >
                      {BULK_STATUS_LABEL[bulkStatus[l.sourceId]]}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="af-btn af-btn--ghost af-im-league-btn"
                      disabled={busy || bulkRunning}
                      onClick={() => void runPreview(l.sourceId)}
                    >
                      {busy ? 'Reading…' : 'Import'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Attestation gate ────────────────────────────────────────── */}
      {phase.k === 'attest' ? (
        <section className="af-im-card">
          <h2 className="af-label">One confirmation first</h2>
          <p className="af-im-attest">{phase.message}</p>
          <div className="af-im-actions">
            <button
              type="button"
              className="af-btn af-im-submit"
              onClick={() => void runPreview(phase.sourceId, true)}
            >
              Confirm and continue
            </button>
            <button type="button" className="af-btn af-btn--ghost" onClick={reset}>
              Cancel
            </button>
          </div>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Preview, then commit ────────────────────────────────────── */}
      {phase.k === 'preview' ? (
        <section className="af-im-card">
          <header className="af-im-result-head">
            <h2 className="af-label">Ready to import</h2>
          </header>
          <p className="af-im-league-name af-im-preview-name">{phase.leagueName}</p>
          <p className="af-im-field-help">
            We read this league from {provider}. Importing builds a read-only copy — nothing changes
            on {provider}.
          </p>
          <div className="af-im-actions">
            <button
              type="button"
              className="af-btn af-im-submit"
              onClick={() => void runCommit(phase.sourceId, phase.attested)}
            >
              Import this league
            </button>
            <button type="button" className="af-btn af-btn--ghost" onClick={reset}>
              Back
            </button>
          </div>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Working ─────────────────────────────────────────────────── */}
      {phase.k === 'committing' || forcedState === 'connecting' ? (
        <section className="af-im-card">
          <h2 className="af-label">Importing</h2>
          <Working label="Building your read-only copy — rosters, matchups and scoring. This can take a minute." />
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Done ────────────────────────────────────────────────────── */}
      {phase.k === 'done' ? (
        <section className="af-im-card">
          <header className="af-im-result-head">
            <h2 className="af-label">Imported</h2>
          </header>
          <p className="af-im-preview-name">{phase.leagueName}</p>
          <p className="af-im-field-help">
            {phase.backfilled
              ? 'Rosters, matchups, scoring and past seasons are in. '
              : 'Rosters, matchups and scoring are in. '}
            Nothing was changed on {provider}.
          </p>
          <div className="af-im-actions">
            {phase.leagueId ? (
              <Link href={`/league/${phase.leagueId}`} className="af-btn af-im-submit">
                Open your league
              </Link>
            ) : null}
            {/*
              ⚠ THE ONLY WAY BACK TO THE FORM. Both other actions navigate AWAY, so
              anyone with a second league to add had to leave and re-enter /import,
              and anyone whose ESPN league ID needed correcting could not retype it
              at all -- the field is not rendered in this phase. Reported as "it
              doesn't even let me input the league ID again".
            */}
            <button type="button" className="af-btn af-btn--ghost" onClick={reset}>
              Import another league
            </button>
            {/*
              ⚠ THE RETURN PATH IS OFFERED, NOT FORCED. Someone who arrived from
              create-league came here to finish THAT flow and would otherwise be
              stranded on a success screen with no way back to it. It sits beside
              "Open your league" rather than replacing it, because the import
              having succeeded does not tell us which of the two they now want.
            */}
            {returnTo ? (
              <Link href={returnTo} className="af-btn af-btn--ghost">
                Back to where you were
              </Link>
            ) : null}
            <button
              type="button"
              className="af-btn af-btn--ghost"
              onClick={() => {
                setAccount('')
                reset()
              }}
            >
              Import another
            </button>
          </div>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Static result frame, design preview only ────────────────── */}
      {forcedState === 'result' ? (
        <section className="af-im-card">
          <header className="af-im-result-head">
            <h2 className="af-label">What we found</h2>
            <span className="af-chip af-num">layout preview</span>
          </header>
          <p className="af-im-empty">
            Layout preview only — reached via <code>?state=result</code>, so no import has run and
            there are no leagues to list. The live flow above fills this from the real import.
          </p>
          <ReadOnlyPromise />
        </section>
      ) : null}
    </div>
  )
}

export default ImportV4
