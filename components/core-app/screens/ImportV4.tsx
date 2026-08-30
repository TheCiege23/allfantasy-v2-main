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
import { FantraxUpload } from '@/components/core-app/import/FantraxUpload'
import { EspnConnectPanel } from '@/components/core-app/import/EspnConnectPanel'
import { ImportProgress, type ImportStep } from '@/components/core-app/import/ImportProgress'
import { ImportDone, type ImportDoneStat } from '@/components/core-app/import/ImportDone'
import { readBackfillOutcome } from '@/lib/league-import/backfillOutcome'
import { resolveSourceLink } from '@/lib/league-links/sourceLinkResolver'
import {
  discoverProviderLeagues,
  fetchImportPreview,
  submitImportCreation,
} from '@/lib/league-import/LeagueCreationImportSubmissionService'
import type { ImportProvider } from '@/lib/league-import/types'
import { toYahooLeagueKey } from '@/lib/league-import/yahooLeagueKey'

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
  | {
      k: 'done'
      leagueId: string
      leagueName: string
      backfilled: boolean
      /*
       * 6d's "seasons of history" card. NULLABLE on purpose: readBackfillOutcome
       * exists precisely because a resolved backfill promise does not mean seasons
       * were written, and it returns null when the provider's answer is unreadable.
       * Null means "we do not know", which 6d renders by omitting the card rather
       * than by printing a 0 that would read as "no history found".
       */
      seasonsImported: number | null
      sourceId: string
      existed: boolean
      skipped: boolean
      attested: boolean
    }

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
    /*
     * ⚠ THIS SENT PEOPLE TO SETTINGS, AND SETTINGS IS NO LONGER WHERE IT HAPPENS.
     * The connect panel is on this screen now (6b), so naming another page would
     * send someone away from the control that is already in front of them — the
     * same errand the /settings error link used to be.
     */
    help: 'Connect ESPN above, then paste a league ID here. We read the league as you — we never ask for your ESPN password.',
  },
  /*
   * ⚠ THIS IS A LEAGUE ID, NOT A SNAPSHOT ID — the provider changed shape under
   * this entry. Fantrax has a real read API (`fxea`), so a league is readable
   * from the id in its URL and the CSV export is no longer the only way in.
   *
   * ⚠ AND IT IS NOT THE SECRET ID. Fantrax also issues a per-user Secret ID that
   * would list every league someone is in — it is a credential, it is never
   * asked for here, and discovery works from the public league id instead.
   */
  fantrax: {
    label: 'Fantrax league ID',
    placeholder: 'v2kzedypmm8jp61b, or paste the league URL',
    help: 'The ID is the code in your league URL — fantrax.com/fantasy/league/THIS-PART/home. Paste either. We will show you the teams so you can pick yours. Never your Fantrax password or Secret ID.',
  },
  /*
   * ⚠ THE ONLY PROVIDER HERE THAT ASKS FOR NOTHING BUT A NUMBER. Fleaflicker's
   * JSON API is public, so there is no account to connect, no cookie to paste
   * and no key to find — which is worth saying, because every other tile on
   * this screen has taught the user to expect a setup step first.
   */
  /*
   * ⚠ NAMES THE SETUP STEP, LIKE ESPN'S DOES. MFL's export API takes an API key
   * on every call — private leagues and public ones alike — so a user who pastes
   * a league id without saving a key first gets a failure that is about setup,
   * not about their league. ESPN learned this the expensive way; the copy here
   * starts where that one ended up.
   */
  mfl: {
    label: 'MFL league ID',
    placeholder: '12345, or paste the league URL',
    help: 'Save your MFL API key once under Settings → Connected Accounts, then paste a league ID here. MFL needs the key for every league, public ones included. The key is not your password.',
  },
  fleaflicker: {
    label: 'Fleaflicker league ID',
    placeholder: '206154, or paste the league URL',
    help: 'The number in your league URL — fleaflicker.com/nfl/leagues/THIS-PART. Nothing to connect first: Fleaflicker publishes league data, so we read it without an account.',
  },
}

/**
 * What the tile promises, where the generic line would be wrong.
 *
 * ⚠ "FINDS YOUR LEAGUES AUTOMATICALLY" IS THE DEFAULT FOR ANY PROVIDER WITH
 * DISCOVERY, AND FOR FANTRAX IT IS FALSE. Fantrax discovery cannot enumerate an
 * account without the Secret ID, which is a credential — it takes a league id
 * and lists that league's teams. Sleeper and Yahoo really do find leagues on
 * their own, so they keep the generic line.
 */
const PROVIDER_TAGLINE: Partial<Record<ImportProvider, string>> = {
  fantrax: 'League ID · pick your team',
  /* No account, no cookie, no key — the only tile here that needs nothing first. */
  fleaflicker: 'League ID · nothing to connect',
  /* The key is not optional and not private-league-only; say so on the tile. */
  mfl: 'League ID · API key required',
}

/** Why an unavailable provider cannot be used, in the user's terms. */
const BLOCKED_REASON: Partial<Record<ImportProvider, string>> = {
  /*
   * Empty, and kept rather than deleted: every provider on this screen is
   * selectable today, and the next one added will need somewhere to say why it
   * is not. The tile falls back to "Not connectable yet." if a provider is ever
   * marked unavailable without an entry here.
   */
}

/**
 * Some gate failures name a prerequisite without saying where to satisfy it —
 * "Link your Sleeper account…", "Connect Yahoo in League Sync…", "Reconnect ESPN…".
 * Observed live: the Sleeper commissioner check returns exactly that and the
 * screen had no way forward, which turns a solvable setup step into a dead end.
 * /leagues is where those messages point, so the message gets a destination.
 * (It used to name LeagueSyncDashboard, which is retired — the route survives it.)
 *
 * Matched on the action words rather than on exact strings: these sentences come
 * from several gates and are edited independently, and a literal match would
 * quietly stop working the first time one is reworded.
 */
function needsConnectionSetup(message: string): boolean {
  return /\b(link|connect|reconnect)\b/i.test(message)
}

/**
 * What to say when the lookup worked and found nothing.
 *
 * ⚠ "NO LEAGUES" IS AN ANSWER, NOT AN ABSENCE OF ONE. Rendering it as a blank
 * screen is the single worst option: it is indistinguishable from a dead button,
 * and it hides the two things the person could actually act on.
 *
 * ⚠ IT MUST NOT CLAIM WHICH CAUSE IT WAS. For Yahoo, an empty list is consistent
 * with an approval that omitted fantasy read access AND with the leagues living
 * on a different Yahoo account, and this screen cannot tell those apart — Yahoo
 * answers both with an empty collection rather than an error. Naming one would be
 * a confident guess, so it names both and offers the step that resolves either.
 */
function emptyDiscoveryMessage(provider: ImportProvider): string {
  if (provider === 'yahoo') {
    return (
      'Yahoo answered, and listed no NFL leagues on the connected account. ' +
      'That happens when the Yahoo approval did not include fantasy read access, ' +
      'or when the leagues sit on a different Yahoo account. Reconnect and approve ' +
      'read-only access to try again.'
    )
  }
  if (provider === 'sleeper') {
    /* No setup words here: an empty Sleeper result is usually a typo, and a
       "connect your accounts" link would send someone to fix what is not broken. */
    return (
      'No NFL leagues came back for that Sleeper username this season. Check the ' +
      'spelling, or leave it blank to use the Sleeper account on your profile.'
    )
  }
  return 'The lookup worked, but no NFL leagues came back for that account.'
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
 * The lock beside the account line. An inline glyph rather than the 🔒 emoji it
 * replaced: an emoji renders at whatever size and colour the platform font
 * decides, so it sat a pixel high, ignored `currentColor`, and was announced by
 * screen readers as "locked". This inherits both and is `aria-hidden`, because
 * the sentence next to it already says what it means.
 */
function LockGlyph() {
  return (
    <svg
      className="af-im-lock"
      width="13"
      height="14"
      viewBox="0 0 13 14"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <rect x="1" y="5.75" width="11" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.75 5.75V4a2.75 2.75 0 0 1 5.5 0v1.75" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * The `?` affordance the handoff puts beside the READ-ONLY chip, the field label
 * and "What we read".
 *
 * ⚠ A `title` ATTRIBUTE IS NOT AN AFFORDANCE. The READ-ONLY chip already carried
 * its explanation that way and nobody could tell: a native tooltip has no visible
 * trigger, never appears on touch, and takes about a second to show on hover. The
 * three places this screen has something to explain are exactly the three where a
 * visitor is deciding whether to hand over an account, so the explanation has to
 * be visibly available.
 *
 * A <button> rather than a hover-only span, so it opens on tap and on Enter and is
 * reachable by keyboard. The bubble is rendered, not `title`-driven, so it is
 * styled and legible in every theme.
 */
function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  /*
   * ⚠ TWO FLAGS, NOT ONE — A SINGLE `open` MAKES THE CLICK CLOSE IT. With hover
   * setting the same boolean the click toggles, a mouse user hovers (open), then
   * clicks the `?` and it VANISHES: the pointer is already inside, so the toggle
   * can only run downwards. Caught by driving it: the bubble was hidden the
   * instant it was pressed.
   *
   * Hover and press are different intents and are stored separately. The bubble
   * shows when either is true, so a click while hovering pins it open and a
   * click on a touch screen — where nothing ever hovers — is still the way in.
   */
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const open = hovered || pinned
  return (
    <span className="af-im-hint" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="af-im-hint-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setPinned(true)}
        onBlur={() => setPinned(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(e) => {
          /* Escape closes it, which is the one keyboard behaviour a tooltip owes
             its user beyond opening. */
          if (e.key === 'Escape') setPinned(false)
        }}
      >
        ?
      </button>
      <span className="af-im-hint-bubble" role="tooltip" hidden={!open}>
        {children}
      </span>
    </span>
  )
}

/**
 * The short tag that rides on the pill itself — the slot the handoff draws as
 * "· Coming soon".
 *
 * ⚠ IT SAYS WHAT THE PROVIDER NEEDS, NOT WHETHER IT IS COMING. The handoff was
 * drawn when MFL, Fantrax and Fleaflicker were unbuilt; all six are live in this
 * repo (provider-ui-config.ts is the authority and every one of them is
 * `available: true`), so rendering "Coming soon" against them would be a
 * regression dressed as a design match. The slot is kept and given the fact that
 * is actually true at pick time: what you will be asked for.
 *
 * The pill row is a scanning surface — the full sentence still lands in the
 * context line under it and in the field help, so nothing is lost by keeping this
 * to three words.
 */
/**
 * The letter(s) in the brand circle.
 *
 * ⚠ `label.charAt(0)` GIVES FANTRAX AND FLEAFLICKER THE SAME MARK. Both are "F",
 * and they sit next to each other in the row — so the one visual cue meant to let
 * you find your platform at a glance pointed at two of them. The handoff draws
 * "FL" for Fleaflicker for exactly this reason. Only the ambiguous ones are
 * listed; everything else keeps its initial.
 */
/**
 * The name on the pill.
 *
 * ⚠ "MyFantasyLeague (MFL)" DOES NOT FIT A PILL, and on a 390px screen it did
 * not fit the CARD — the tag beside it ("· league ID + key") was pushed past the
 * right edge and clipped. Every other pill is one short word.
 *
 * Derived from the config label rather than hardcoded, so provider-ui-config
 * stays the single authority on naming: when a label carries a parenthetical
 * abbreviation, the pill shows the abbreviation and the full name still appears
 * wherever there is room for it (`providerLabel` in the field help, the account
 * note and the blocked strip all keep using it).
 */
function providerPillLabel(label: string): string {
  const abbreviation = /\(([^)]+)\)\s*$/.exec(label)
  return abbreviation?.[1]?.trim() || label
}

const PROVIDER_INITIAL: Partial<Record<ImportProvider, string>> = {
  fleaflicker: 'FL',
}

const PROVIDER_PILL_TAG: Partial<Record<ImportProvider, string>> = {
  espn: 'league ID',
  mfl: 'league ID + key',
  fantrax: 'league ID',
  fleaflicker: 'league ID',
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
        <span className="af-label af-im-trust-read">
          What we read
          <Hint label="What we read from your league">
            Everything AllFantasy shows you is built from these. We re-read them on a schedule so
            your numbers stay current — and we read nothing else.
          </Hint>
        </span>
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
  /* Fantrax Secret ID: stored via the same encrypted `leagueAuth` row every other
     provider uses, never held in component state after it is saved. */
  const [fxSecret, setFxSecret] = useState('')
  const [fxSaving, setFxSaving] = useState(false)
  /*
   * 6b: whether ESPN is connected for this user, reported by the connect panel
   * below rather than fetched again here. `null` is "not yet known" and is
   * deliberately distinct from `false` — the panel is still asking, and claiming
   * "not connected" during that window is how a connected account gets told to
   * connect.
   */
  const [espnConnected, setEspnConnected] = useState<boolean | null>(null)

  const selectable = isImportProviderAvailable(provider)
  // Provider display name comes from the shared config, never a local literal — the same
  // reason availability does (see the header note).
  const providerLabel = getImportProviderLabel(provider)
  const field = FIELD_BY_PROVIDER[provider]
  const canDiscover = supportsImportProviderDiscovery(provider)
  /*
   * ⚠ FANTRAX'S DISCOVERED ROWS ARE TEAMS IN ONE LEAGUE, NOT LEAGUES, so every
   * affordance that assumes "these are independent things you might want several
   * of" is wrong here: the tick boxes, the Import-all button and the "Leagues we
   * found" heading. Picking two teams would import the same league twice, once
   * attributed to someone else.
   */
  const rowsAreTeams = provider === 'fantrax'
  // Yahoo has no identifier at all; Sleeper falls back to the linked account.
  const usesConnectedAccount = provider === 'yahoo'

  /*
   * ⚠ MUST BE STABLE, AND THIS IS NOT A STYLE PREFERENCE. The panel's status
   * fetch is a `useCallback` that closes over this prop and is driven by a
   * `useEffect` keyed on it. An inline arrow gets a new identity every render, so
   * the effect would re-fire, set state, re-render, and re-fire — an unbounded
   * loop of GETs against /api/league/auth. `useCallback` with no deps is the
   * whole fix.
   */
  const handleEspnConnectedChange = useCallback((connected: boolean) => {
    setEspnConnected(connected)
  }, [])

  const reset = useCallback(() => {
    setLeagues([])
    setAccountLabel(null)
    setPhase({ k: 'idle' })
    setError(null)
  }, [])

  /**
   * ⚠ RETURNS TO THE DISCOVERED LIST INSTEAD OF DISCARDING IT. `reset` clears
   * `leagues`, which is right when there is nothing to go back to — but every exit
   * from the single-league panels used it, so finishing (or abandoning) ONE league
   * threw away the other fifty-four and forced a re-discovery to reach the next.
   * That is the whole cost of "do those individually": a bulk run over 55 Sleeper
   * leagues leaves a dozen needing confirmation, and each one meant retyping the
   * username and waiting out discovery again.
   *
   * Used only where a list actually exists; the callers fall back to `reset`
   * otherwise, so the no-list behaviour is unchanged.
   */
  const backToList = useCallback(() => {
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
        /*
         * ⚠ AND NOT WHEN WE HAVE JUST COME BACK FROM YAHOO. Without that guard
         * this is a loop, and it is the loop that was reported as "I press
         * connect yahoo and nothing happens":
         *
         *   press Connect → discovery fails → this redirects to Yahoo → Yahoo
         *   already holds consent so it returns immediately → /import renders
         *   with ?success=yahoo_connected → identical screen → press again.
         *
         * Production request logs showed the whole circuit: a 502 from
         * /api/leagues/import/discover, then 307s through /api/auth/yahoo and
         * /api/league/yahoo/callback, then /import, repeating. A real error,
         * reported eight times, and never once rendered — because the redirect
         * fired before anything could be shown.
         *
         * Once they are back with a connection in hand, the honest move is to
         * show what Yahoo said and let them choose.
         */
        if (provider === 'yahoo' && needsConnectionSetup(message) && !yahooConnected) {
          window.location.href = YAHOO_CONNECT_HREF
          return
        }
        setError(message)
        setPhase({ k: 'idle' })
        return
      }
      const payload = res.data as { leagues?: DiscoveredLeague[]; accountLabel?: string }
      const found = payload?.leagues ?? []
      setLeagues(found)
      setAccountLabel(payload?.accountLabel ?? null)
      /*
       * ⚠ A LOOKUP THAT SUCCEEDED AND FOUND NOTHING USED TO RENDER AS NOTHING.
       * This branch cleared the error, set an empty list and returned to idle, so
       * pressing the button repainted the screen identically — no leagues, no
       * message, no failure. Reported live as "I click connect yahoo and nothing
       * happens", with Yahoo connected the whole time and the button working
       * exactly as written.
       *
       * ⚠ ONLY ON THE EXPLICIT PRESS. The lookup that runs on provider select is
       * deliberately silent (see the effect below) — nobody asked it a question,
       * so it has no answer to report. Speaking there would greet someone with an
       * error for a screen they had only just opened.
       */
      if (found.length === 0) setError(emptyDiscoveryMessage(provider))
      setPhase({ k: 'idle' })
    },
    [provider, yahooConnected]
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
  /*
   * ⚠ "NOTHING HAPPENS" WAS THIS, AND THE IMPORT HAD ALREADY WORKED.
   *
   * Every outcome of an action on this screen — the confirmation prompt, "Ready to
   * import", and "Imported" — renders near the BOTTOM of a very long page, below the
   * provider grid, the input, the trust panels and a discovered-league list that can
   * run to a dozen rows. The button that triggers them is far above. So pressing
   * "Import this league" swapped one off-screen panel for another and, from where the
   * page was scrolled, looked like nothing at all.
   *
   * Confirmed against production: a Fantrax league imported successfully — 12 teams,
   * an `import_runs` row, a `leagues` row — while the person who pressed the button
   * was told nothing and reasonably concluded it had failed.
   *
   * Only one of these phases is mounted at a time, so a single ref is enough.
   */
  const outcomeRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (phase.k !== 'attest' && phase.k !== 'preview' && phase.k !== 'done') return
    /* `block: 'center'` rather than 'start': these panels are short, and centring them
       keeps the discovered list visible above so the screen still reads as one flow. */
    outcomeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [phase.k])

  /*
   * ⚠ AN ERROR THE USER CANNOT SEE IS NOT AN ERROR MESSAGE. The failure panel lives
   * in the picker card at the TOP of the page, while the row you pressed can be far
   * below it — the discovered list is as long as the account is deep.
   *
   * Found running a real Sleeper account against staging: `theciege24` returns 55
   * leagues, the page is ~10,800px tall, and a preview failure on a row near the
   * bottom rendered its explanation roughly nine thousand pixels above the click.
   * The button appeared to do nothing. The stubbed fixtures never showed this
   * because three fake leagues fit on one screen.
   *
   * Centred rather than 'start' for the same reason the outcome panels are: it keeps
   * the surrounding context visible so the screen still reads as one flow.
   */
  const errorRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!error) return
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [error])

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
    async (sourceId: string, attested: boolean, force = false) => {
      setError(null)
      setPhase({ k: 'committing', sourceId })
      const res = await submitImportCreation(
        provider,
        sourceId,
        '',
        attested ? { accepted: true } : undefined,
        force ? { force: true } : undefined
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
        /* The persist reports whether this run actually wrote anything, or matched an
           already-completed import and returned it untouched. */
        existed?: boolean
        league_existed?: boolean
        skipped?: boolean
      }
      const leagueId = data?.leagueId || data?.league?.id || ''
      /*
       * Keeps the discovered list truthful for anyone who goes back to it. A league
       * confirmed one-by-one after a bulk run is imported now, and leaving its row
       * reading "Needs your confirmation" would invite a second, pointless pass over
       * work already done. Harmless when there is no list — nothing reads the map.
       */
      setBulkStatus((prev) => (prev[sourceId] ? { ...prev, [sourceId]: 'done' } : prev))
      setPhase({
        k: 'done',
        leagueId,
        leagueName: data?.name || data?.league?.name || 'Your league',
        backfilled: Boolean(data?.historicalBackfill),
        seasonsImported: readBackfillOutcome(data?.historicalBackfill).seasonsImported,
        sourceId,
        attested,
        existed: Boolean(data?.existed ?? data?.league_existed),
        /* Only a short-circuited run means "nothing was re-read". A forced re-import
           still reports existed:true, because the league does still exist. */
        skipped: Boolean(data?.skipped),
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
  /**
   * The server's own sentence for each league that did not go through, keyed by
   * sourceId. Two consumers, and a row is only ever one of the two:
   *   - `needs-attestation` → the attestation panel's prompt, so it reads "you're a
   *     verified member of this league (not its commissioner)…" instead of a generic
   *     line.
   *   - `failed` → the reason, surfaced on the row so "Retry" is an informed choice
   *     rather than a coin flip. A league that failed because it does not exist will
   *     fail identically every time, and the row should say so.
   */
  const [bulkMessage, setBulkMessage] = useState<Record<string, string>>({})

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

  /**
   * One league through the commit call, with its row updated in place.
   *
   * ⚠ SHARED BY THE BULK LOOP AND THE PER-ROW RETRY ON PURPOSE. These two must
   * classify an outcome identically — a retry that read `res.ok` as "imported"
   * where the bulk loop knows better would report a league as freshly imported
   * when it was an idempotent replay, which is exactly the bug the `existed`
   * check below exists to prevent. One function, so they cannot drift.
   */
  const importOneLeague = useCallback(
    async (sourceId: string): Promise<BulkStatus> => {
      setBulkStatus((prev) => ({ ...prev, [sourceId]: 'importing' }))
      const res = await submitImportCreation(provider, sourceId, '')
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
      const message = res.ok ? null : res.error || null
      setBulkMessage((prev) => {
        // Cleared on success so a retry that works does not leave the previous
        // attempt's error sitting on a row that has since imported.
        if (!message) {
          if (!prev[sourceId]) return prev
          const next = { ...prev }
          delete next[sourceId]
          return next
        }
        return { ...prev, [sourceId]: message }
      })
      setBulkStatus((prev) => ({ ...prev, [sourceId]: status }))
      return status
    },
    [provider]
  )

  const runBulkImport = useCallback(async () => {
    if (bulkRunning || selectedLeagues.length === 0) return
    setBulkRunning(true)
    setBulkDone(false)
    setBulkStatus({})
    setBulkMessage({})
    setError(null)
    for (const league of selectedLeagues) {
      await importOneLeague(league.sourceId)
    }
    setBulkRunning(false)
    setBulkDone(true)
  }, [bulkRunning, selectedLeagues, importOneLeague])

  /**
   * Re-runs a single failed league in place. Deliberately NOT a navigation: a
   * failed row is usually a transient provider hiccup partway through a long run,
   * and routing it through the preview → commit panels to recover would cost the
   * list (and, before `backToList`, the other fifty-four rows) for what is one
   * button press. The row shows "Importing…" while it goes and settles on whatever
   * the retry actually returned — including `failed` again, with the new reason.
   */
  const retryLeague = useCallback(
    async (sourceId: string) => {
      if (bulkRunning) return
      setError(null)
      await importOneLeague(sourceId)
    },
    [bulkRunning, importOneLeague]
  )

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

  /*
   * ⚠ 6c IS A TAKEOVER, AND APPENDING IT WAS NOT ENOUGH. Rendered below the picker
   * and the discovered list, the progress ring landed roughly 1,400px down a page
   * the user was not scrolled to — so pressing Import appeared to do nothing, which
   * is the exact failure the screen exists to prevent. The handoff draws it as the
   * only thing on the frame.
   *
   * ⚠ BUT NOT DURING DISCOVERY. A lookup is not an import: it is fast, it is often
   * wrong (a typo'd username), and hiding the field someone needs to correct while
   * they wait is worse than a spinner. Discovery keeps the existing inline
   * `Working` line and leaves the form on screen; the takeover starts once a
   * specific league is being read or written.
   */
  const importTakeover =
    phase.k === 'previewing' ||
    phase.k === 'committing' ||
    /* 6d is the last screen of the flow. Leaving the picker above it means the
       success message lands below a form the user has already finished with. */
    phase.k === 'done' ||
    forcedState === 'connecting'

  /*
   * ── 6c: the checklist, derived from the phase machine ───────────────────────
   *
   * ⚠ THREE STEPS BECAUSE THERE ARE THREE CALLS. See the note at the top of
   * ImportProgress: the handoff draws four, but "matchups and scoring" and "past
   * seasons" both happen inside the single synchronous commit, so sequencing them
   * on screen would invent an order the backend never reports. Every state below
   * is read off `phase`, so the checklist cannot claim a step the screen is not on.
   */
  const progressSteps: ImportStep[] = (() => {
    const discovering = phase.k === 'discovering'
    const previewing = phase.k === 'previewing'
    const committing = phase.k === 'committing'
    const found = leagues.length

    const discoveryDone = !discovering && (found > 0 || previewing || committing)
    /* Real names, capped — the detail line is one row, not a league list. */
    const names = leagues.slice(0, 3).map((l) => l.name).join(', ')
    const extra = found > 3 ? `, +${found - 3} more` : ''

    return [
      {
        key: 'discovery',
        title: found > 0 ? `Discovery · found ${found} ${found === 1 ? 'league' : 'leagues'}` : 'Discovery',
        detail: discovering
          ? `Asking ${providerLabel} what you play in`
          : found > 0
            ? `${names}${extra}`
            : canDiscover
              ? 'Looking up your account'
              : 'Reading the league ID you entered',
        state: discovering ? 'working' : discoveryDone ? 'done' : 'queued',
      },
      {
        key: 'preview',
        title: 'Teams and rosters',
        detail: previewing
          ? 'Reading the league and its teams'
          : committing || phase.k === 'done'
            ? 'Teams, managers and rosters read'
            : 'Reads the league before anything is written',
        state: previewing ? 'working' : committing || phase.k === 'done' ? 'done' : 'queued',
      },
      {
        key: 'commit',
        title: 'Matchups and scoring settings',
        detail: committing
          ? 'Writing your read-only copy'
          : phase.k === 'done'
            ? 'Scoring rules and the matchup schedule are in'
            : 'Scoring rules and the matchup schedule',
        state: committing ? 'working' : phase.k === 'done' ? 'done' : 'queued',
      },
      {
        /*
         * ⚠ THE FOURTH ROW IS REAL, BUT IT DOES NOT GET ITS OWN MOMENT. The handoff
         * draws matchups/scoring and past seasons finishing separately; both happen
         * inside the SAME synchronous commit call, which reports once. So this row
         * cannot go WORKING while the one above is still WORKING without inventing a
         * sequence — the two resolve together, which is why the ring steps 50 → 100
         * rather than passing through 75.
         *
         * What IS separately real is the OUTCOME: readBackfillOutcome gives a genuine
         * `seasonsImported`, and it is nullable by design because a resolved backfill
         * promise does not mean seasons were written. All three answers are
         * distinguishable here — a count, an honest "none found", and "we could not
         * tell" — which is more than the design asked for and less than it implied.
         */
        key: 'seasons',
        title: 'Past seasons',
        detail: committing
          ? 'Reading prior seasons'
          : phase.k === 'done'
            ? typeof phase.seasonsImported === 'number' && phase.seasonsImported > 0
              ? `${phase.seasonsImported} ${phase.seasonsImported === 1 ? 'season' : 'seasons'} imported · powers your career and legacy record`
              : phase.seasonsImported === 0
                ? 'No prior seasons found on this league'
                : 'Imported — the provider did not report how many seasons'
            : 'Powers your career and legacy record',
        state: committing ? 'working' : phase.k === 'done' ? 'done' : 'queued',
      },
    ]
  })()

  /*
   * ── 6d: the stat cards ──────────────────────────────────────────────────────
   *
   * ⚠ A CARD IS OMITTED RATHER THAN GUESSED. Handoff rule 4 wants exact counts from
   * this import; the corollary is that a number this screen cannot source must not
   * appear at all. `seasonsImported` is null whenever the provider's backfill answer
   * was unreadable, and a null is dropped here rather than rendered as 0 — a "0
   * seasons of history" card reports a finding we did not make.
   */
  const doneStats: ImportDoneStat[] = (() => {
    if (phase.k !== 'done') return []
    const out: ImportDoneStat[] = []

    /* Leagues written in THIS run: the bulk tally when a bulk run happened, else 1. */
    const importedCount = bulkDone ? bulkCounts.done : phase.skipped ? 0 : 1
    out.push({
      key: 'leagues',
      value: importedCount,
      label: importedCount === 1 ? 'league imported' : 'leagues imported',
    })

    /*
     * Teams, not "players on your rosters". The commit returns no player count, and
     * the preview's per-manager `players[]` covers every manager in the league — the
     * handoff's figure would need the viewer's own roster, which is not in either
     * payload. This is the adjacent fact we can actually stand behind.
     */
    const teams = leagues.find((l) => l.sourceId === phase.sourceId)?.totalTeams
    if (typeof teams === 'number' && teams > 0) {
      out.push({ key: 'teams', value: teams, label: teams === 1 ? 'team in your league' : 'teams in your league' })
    }

    if (typeof phase.seasonsImported === 'number' && phase.seasonsImported > 0) {
      out.push({
        key: 'seasons',
        value: phase.seasonsImported,
        label: phase.seasonsImported === 1 ? 'season of history' : 'seasons of history',
      })
    }

    /*
     * ⚠ THE "NEEDS YOU" CARD IS ONLY --bad ABOVE ZERO (handoff rule 1), and at zero
     * it becomes a --good "all set" rather than a red 0. What counts as needing you
     * is this run's own unfinished business: leagues the commissioner gate asked you
     * to confirm, plus outright failures. Both are real outcomes of this import and
     * both have an action on this screen.
     */
    const needsYou = bulkDone ? bulkCounts.needsAttestation + bulkCounts.failed : 0
    out.push(
      needsYou > 0
        ? { key: 'needs', value: needsYou, label: needsYou === 1 ? 'thing needs you' : 'things need you', tone: 'bad' }
        : { key: 'needs', value: 0, label: 'left for you to do', tone: 'good' },
    )
    return out
  })()

  /*
   * ── 6d: "Open in {Platform}" ────────────────────────────────────────────────
   *
   * ⚠ RESOLVED, NEVER CONSTRUCTED. `resolveSourceLink` is the one gate for provider
   * URLs in this repo — every href it returns has passed that provider's EXACT-host
   * HTTPS allowlist, and it falls back to the provider homepage rather than guessing
   * a deep link it cannot verify. Building `https://sleeper.com/leagues/${id}` here
   * by hand would sidestep all of that for one button.
   *
   * Null is a real answer: an unknown platform or an unresolvable id yields no link
   * and the button simply does not render.
   */
  const doneSourceLink = (() => {
    if (phase.k !== 'done') return null
    const link = resolveSourceLink({
      platform: provider,
      sourceLeagueId: phase.sourceId,
      leagueName: phase.leagueName,
      action: 'league',
    })
    return link ? { href: link.href, label: `Open in ${link.providerLabel}` } : null
  })()

  /*
   * ── 6d: the Chimmy aside ────────────────────────────────────────────────────
   *
   * ⚠ DERIVED FROM THIS RUN, NOT WRITTEN IN ADVANCE. The handoff's line is an
   * analytical claim about players across rosters; nothing here can compute that.
   * What this screen genuinely knows the moment it renders is what the backfill
   * reported, so that is what Chimmy says — and when the backfill reported nothing
   * knowable, it falls back to the one thing that is always true on this screen.
   */
  const doneChimmyNote = (() => {
    if (phase.k !== 'done') return null
    const seasons = phase.seasonsImported
    if (typeof seasons === 'number' && seasons > 0) {
      return (
        <>
          I pulled {seasons} {seasons === 1 ? 'past season' : 'past seasons'} in alongside this
          one &mdash; that history is what your career and legacy records are built from.
        </>
      )
    }
    return (
      <>
        Nothing on {providerLabel} changed. From here I only ever read this league &mdash; every
        number you see is built from that read-only copy.
      </>
    )
  })()

  /*
   * 6d's outstanding-issue row. Bound to the same bulk outcomes as the card above,
   * so the two can never disagree, and rendered only when there is genuinely
   * something to act on. Its action returns to the discovered list, which is where
   * the per-league confirm panels live.
   */
  const doneIssue =
    phase.k === 'done' && bulkDone && bulkCounts.needsAttestation + bulkCounts.failed > 0
      ? {
          title:
            bulkCounts.needsAttestation > 0
              ? `${bulkCounts.needsAttestation} ${bulkCounts.needsAttestation === 1 ? 'league needs' : 'leagues need'} your confirmation`
              : `${bulkCounts.failed} ${bulkCounts.failed === 1 ? 'league' : 'leagues'} did not import`,
          meta:
            bulkCounts.needsAttestation > 0
              ? `${providerLabel} · confirm you are authorised to import them`
              : `${providerLabel} · open each one to see why`,
          actionLabel: 'Review them',
          onAction: backToList,
        }
      : null

  /*
   * The connect action, hoisted so it can sit ON the field's row for every
   * provider that has a field, and stand alone for Yahoo, which does not. Same
   * button, same handler, same disabled rule — declared once so the two
   * placements cannot drift apart.
   */
  const submitButton = (
    <button
      type="button"
      className="af-btn af-im-submit"
      data-testid="import-discovery-find"
      disabled={phase.k === 'discovering' || phase.k === 'previewing'}
      onClick={() => {
        const typed = account.trim()
        /*
          ⚠ A TYPED YAHOO LEAGUE ID MUST BYPASS DISCOVERY, NOT FEED IT.
          Yahoo supports discovery, so `canDiscover` is true and this used
          to run the account-wide lookup unconditionally — which would
          ignore what was typed and fail in exactly the way the person was
          typing to get around.
        */
        if (usesConnectedAccount && typed) {
          void runPreview(toYahooLeagueKey(typed))
          return
        }
        if (canDiscover) void runDiscover(typed)
        else if (typed) void runPreview(typed)
        else setError('Enter a league ID to continue.')
      }}
    >
      {/*
        "Find my leagues" only makes sense when there is something to
        search from. Yahoo supports discovery but normally takes no
        identifier, so the same label there would promise a search of
        something never entered — unless a league ID has been typed, in
        which case that is precisely what the button will do.
      */}
      {usesConnectedAccount
        ? account.trim()
          ? 'Import this league'
          : 'Connect Yahoo'
        : canDiscover
          ? 'Find my leagues'
          : 'Connect'}
      <span className="af-im-submit-arrow" aria-hidden>
        &rarr;
      </span>
    </button>
  )

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
            <span className="af-im-readonly af-num">Read-only</span>
          )}
          {/*
            6a build rule 4: the chip AND its `?` ride every step of this flow,
            the same way they do on every signed-in screen. It sits outside the
            connected/read-only swap because the explanation is the same either
            way — what changed is which account is connected, not what we do
            with it.
          */}
          <Hint label="What read-only means">
            AllFantasy never changes anything on Sleeper, ESPN or Yahoo. We read your leagues and
            point you to the exact league and screen where you make the change.
          </Hint>
          <Link href="/core" className="af-im-skip">
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
          {/*
            ⚠ THIS SAID "YOUR LEAGUES ARE LISTED BELOW" WHETHER OR NOT ANY WERE.
            An empty list is a real outcome of a successful connect, and pairing it
            with a sentence asserting the opposite is how a working connection reads
            as a broken screen: the banner promised leagues, none appeared, and the
            button beneath it looked dead. All three states are now distinguishable.
          */}
          {leagues.length > 0 ? (
            <p>Yahoo is connected. Your Yahoo leagues are listed below.</p>
          ) : phase.k === 'discovering' ? (
            <p>Yahoo is connected. Looking up your leagues&hellip;</p>
          ) : (
            <p>
              Yahoo is connected, but no leagues have come back yet. Choose Yahoo below
              and press Connect Yahoo to look again.
            </p>
          )}
        </div>
      ) : null}

      {/* ── Step 1: provider picker ─────────────────────────────────── */}
      {importTakeover ? null : (
      <section className="af-im-card">
        {/*
          The section heading used to repeat the h1 verbatim ("Where do you already play?"),
          so the page asked the same question twice in a row. 6a asks it once, in the h1.
        */}
        {/*
          ── 6a: A PILL ROW, NOT A GRID OF CARDS ───────────────────────────────
          This was six stacked tiles, each carrying a mark, a name, a tagline and
          a sports line — 24 lines of text to read before picking the platform
          you already knew you were on. The handoff draws one scannable row, and
          it is right: choosing your platform is recognition, not comparison.

          ⚠ NOTHING WAS DELETED TO GET THERE. The tagline and the supported
          sports both still render — in the context line directly below, for the
          provider actually chosen. That is where they matter (they describe what
          the field beneath is about to ask for), and it is the only place they
          are not competing with five other providers' copy for attention.

          ⚠ AND AVAILABILITY IS STILL provider-ui-config's ANSWER. The handoff
          tags MFL, Fantrax and Fleaflicker "Coming soon"; that was true when it
          was drawn and is not true now. Reading `opt.available` rather than the
          picture keeps the row honest in both directions — it will say "soon"
          again the day a provider is switched off, without an edit here.
        */}
        <div className="af-im-providers" role="group" aria-label="Fantasy platform">
          {IMPORT_PROVIDER_UI_OPTIONS.map((opt) => {
            const available = opt.available
            const active = provider === opt.provider
            const tag = available ? PROVIDER_PILL_TAG[opt.provider] : 'Coming soon'
            return (
              <button
                key={opt.provider}
                type="button"
                className="af-im-provider"
                data-active={active}
                data-available={available}
                data-testid={`import-tab-${opt.provider}`}
                disabled={!available}
                aria-disabled={!available}
                aria-pressed={active}
                onClick={() => {
                  if (!available) return
                  setProvider(opt.provider)
                  setAccount('')
                  reset()
                }}
              >
                <span className="af-platform af-im-mark" data-platform={opt.provider} aria-hidden>
                  {PROVIDER_INITIAL[opt.provider] ?? opt.label.charAt(0)}
                </span>
                <span className="af-im-provider-label">{providerPillLabel(opt.label)}</span>
                {tag ? <span className="af-im-soon af-num">&middot; {tag}</span> : null}
              </button>
            )
          })}
        </div>

        {/*
          What the chosen pill costs you, in one line: what it asks for, and which
          sports it can carry. Both used to sit on every tile at once; here they
          describe the field immediately below them.
        */}
        <p className="af-im-context">
          <span className="af-im-context-meta">
            {selectable
              ? PROVIDER_TAGLINE[provider] ??
                (canDiscover ? 'Finds your leagues automatically' : 'League ID · read-only')
              : BLOCKED_REASON[provider] ?? 'Not connectable yet.'}
          </span>
          <span className="af-im-context-sports af-num">
            {(IMPORT_PROVIDER_UI_OPTIONS.find((o) => o.provider === provider)?.supportedSports ?? [])
              .join(' · ')}
          </span>
        </p>

        {/*
          ── 6a: the coming-soon fallback strip ────────────────────────────────
          ⚠ DORMANT TODAY AND BUILT ANYWAY. Every provider in the config is
          available, so this renders for nobody — but a disabled pill with no
          explanation beside it is exactly the dead end the tiles' `BLOCKED_REASON`
          line used to cover, and deleting the strip because nothing currently
          triggers it is how that regression gets reintroduced the next time a
          provider is switched off. It reads from the same `selectable` flag the
          field block does, so the two can never disagree.
        */}
        {!selectable ? (
          <p className="af-im-blocked" role="status">
            <span className="af-label">{providerLabel} selected?</span>
            <span>{BLOCKED_REASON[provider] ?? `${providerLabel} isn't available yet — coming soon.`}</span>
          </p>
        ) : null}

        {/*
          ⚠ THIS LINK WAS CONDITIONED ON FANTRAX BEING UNAVAILABLE, so making
          Fantrax work removed the only pointer to the CSV uploader. The upload
          is still the second way in — an export carries seasons the live API
          does not expose, and a league the fxea API will not serve has nowhere
          else to go — so the door stays. It is hidden only when the uploader is
          already on screen, which is what it was really guarding.
        */}
        {provider !== 'fantrax' && defaultProvider !== 'fantrax' ? (
          <p className="af-im-fx-link">
            <a href="/import?provider=fantrax">
              Have a Fantrax CSV export? Bank it now →
            </a>
          </p>
        ) : null}

        {/* ── Step 2: the provider's own field ──────────────────────── */}
        {selectable && phase.k !== 'done' ? (
          <div className="af-im-field-block">
            {/*
              ── 6b: ESPN connects HERE, not on another page ─────────────────
              ⚠ THE OLD ANSWER WAS A LINK OUT, AND A LINK OUT ENDS THE IMPORT.
              ESPN is the one provider on this screen that cannot be read without a
              connection — commissionerGate resolves your team from the SWID cookie,
              so a PUBLIC ESPN league needs one too. The screen knew that and handled
              it by pointing at /settings, which means: leave with no league id in
              hand, connect, find your way back, start over. 6a build rule 6 calls
              ESPN's case one click; this is where that click has to be.

              ⚠ AND IT IS SHOWN BEFORE THE FIELD, NOT AFTER A FAILURE. Rendering it
              only once an import had already failed would still be teaching the
              prerequisite by punishment. It leads for as long as ESPN is
              unconnected, and collapses to a one-line confirmation once it is.
            */}
            {provider === 'espn' ? (
              <div className="af-im-espn" data-connected={espnConnected === true ? 'true' : 'false'}>
                {espnConnected === true ? null : (
                  <p className="af-im-espn-lead">
                    <span className="af-label">Connect ESPN first</span>
                    {/*
                      ⚠ SAYS "PRIVATE OR PUBLIC" ON PURPOSE. The previous copy on this
                      screen implied public ESPN leagues imported directly. They do not,
                      and that sentence cost a real user a long detour — it sent them to
                      type an id that could never work.
                    */}
                    <span>
                      ESPN has no sign-in for us to use, so we read your leagues as you.
                      This is needed for every ESPN league, public ones included.
                    </span>
                  </p>
                )}
                <EspnConnectPanel onConnectedChange={handleEspnConnectedChange} />
              </div>
            ) : null}

            {/*
              ── Fantrax: connect once, then there is nothing to type.
              A league id is public and says nothing about who is asking, which is why
              that path has to follow up with "which team is yours". A Secret ID is the
              one thing Fantrax offers that identifies a PERSON, so `getLeagues` returns
              the caller's leagues AND the teams they own in them — no league id, no
              season, no sport, no team picker.
              It posts to the SAME /api/league/auth every other provider's credentials
              use (platform `fantrax`, encrypted `apiKey`), so nothing new stores it and
              it never rides in an import request body.
            */}
            {provider === 'fantrax' ? (
              <div className="af-im-field">
                <span className="af-label">Fantrax Secret ID</span>
                <input
                  type="password"
                  placeholder="paste your Secret ID"
                  value={fxSecret}
                  autoComplete="off"
                  onChange={(e) => setFxSecret(e.target.value)}
                />
                <button
                  type="button"
                  className="af-btn af-btn--ghost"
                  disabled={fxSaving || phase.k === 'discovering'}
                  onClick={() => {
                    const secret = fxSecret.trim()
                    if (!secret) {
                      setError('Paste your Fantrax Secret ID first.')
                      return
                    }
                    setError(null)
                    setFxSaving(true)
                    void (async () => {
                      try {
                        const res = await fetch('/api/league/auth', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ platform: 'fantrax', apiKey: secret }),
                        })
                        if (!res.ok) {
                          const body = (await res.json().catch(() => null)) as { error?: string } | null
                          setError(body?.error || 'That Secret ID could not be saved.')
                          return
                        }
                        // Cleared on success: it is a credential, and it is stored now.
                        setFxSecret('')
                        await runDiscover('')
                      } catch {
                        setError('Could not reach the server to save that Secret ID.')
                      } finally {
                        setFxSaving(false)
                      }
                    })()
                  }}
                >
                  {fxSaving ? 'Connecting…' : 'Connect Fantrax and list my leagues'}
                </button>
                <span className="af-im-field-help">
                  Fantrax → Settings → API Access. Read-only, and it is stored encrypted. With it
                  connected we can name your leagues and your team without you typing either. Prefer
                  not to? Paste a league ID below instead.
                </span>
              </div>
            ) : null}

            {field ? (
              <label className="af-im-field">
                <span className="af-label">
                  {field.label}
                  {/*
                    6a build rule 1: this label and placeholder change with the
                    platform, and the `?` is where that rule is explained rather
                    than merely obeyed. Someone who picked ESPN after typing a
                    Sleeper username needs to know the box now wants something
                    else — the swap alone does not say so.
                  */}
                  <Hint label="Why this field changes">
                    Sleeper connects by username. ESPN, Yahoo, MFL, Fantrax and Fleaflicker connect
                    by league ID — the field swaps when you pick a platform.
                  </Hint>
                </span>
                {/*
                  ⚠ THE ACTION SITS ON THE FIELD'S ROW, NOT UNDER IT. The submit
                  used to be a separate block below the help text, so the thing you
                  press after typing was two paragraphs away from the thing you
                  typed into — and on the one screen whose entire job is "type this,
                  press that". 6a puts them on one row; the button drops beneath the
                  input on narrow screens, where a row would squeeze both.
                */}
                <span className="af-im-field-row">
                  <input
                    type="text"
                    placeholder={field.placeholder}
                    value={account}
                    data-testid="import-discovery-account"
                    onChange={(e) => setAccount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      if (canDiscover) void runDiscover(account.trim())
                      else if (account.trim()) void runPreview(account.trim())
                    }}
                  />
                  {submitButton}
                </span>
                <span className="af-im-field-help">
                  {/*
                    ⚠ "CONNECT ESPN ABOVE" IS WRONG ONCE ESPN IS CONNECTED — it tells
                    someone to do a thing the green badge two rows up says they have
                    already done, which reads as the badge being wrong. The static
                    map cannot know, so the one provider whose help depends on live
                    state gets it swapped here.
                  */}
                  {provider === 'espn' && espnConnected === true
                    ? 'ESPN is connected, so paste a league ID and we will read it as you. We never ask for your ESPN password.'
                    : field.help}
                </span>
              </label>
            ) : (
              <div className="af-im-field">
                <span className="af-label">Yahoo account</span>
                <p className="af-im-field-help">
                  Yahoo lists leagues from the account you connect — there is no username to enter.
                  You will be sent to Yahoo to approve read-only access.
                </p>
                {/*
                  ⚠ A SECOND WAY IN, BECAUSE THE FIRST ONE CAN FAIL AND USED TO BE
                  THE ONLY ONE OFFERED. Yahoo was the single provider on this screen
                  with no way to name a league directly, so when the account-wide
                  list came back refused there was nothing else to try — the tile
                  was a dead end with a working path sitting unused behind it.

                  Deliberately secondary. Connecting is still the good path: it
                  names every league at once and asks nothing of the user. This is
                  for when that path is the broken one.
                */}
                <span className="af-label af-im-yahoo-alt">Or paste one league ID</span>
                <input
                  type="text"
                  placeholder="123456, or paste the league URL"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const typed = account.trim()
                    if (typed) void runPreview(toYahooLeagueKey(typed))
                    else void runDiscover('')
                  }}
                />
                <span className="af-im-field-help">
                  The number in your league&rsquo;s address —
                  football.fantasysports.yahoo.com/f1/<strong>123456</strong>/2. Paste the number or
                  the whole link. This asks Yahoo for that one league instead of for all of them, so
                  it still works when the list above does not. Read as an NFL league.
                </span>
              </div>
            )}

            {/*
              Yahoo's block renders its own input above and has no `field`, so the
              action stays a standalone row there — it is the only branch where
              pressing the button with nothing typed is the NORMAL path.
            */}
            {field ? null : submitButton}

            {/*
              6a: the account line that sits directly under the connect action. The promise it
              makes ("read-only, no password, ever") is the same one the trust card below spells
              out, and it belongs here because this is the moment someone decides to type.
            */}
            <p className="af-im-account-note">
              <LockGlyph /> Create a free account to connect your {providerLabel} league &mdash;
              read-only, no password, ever.
            </p>

            {phase.k === 'discovering' ? <Working label="Looking up your leagues…" /> : null}

            {error ? (
              <div className="af-im-error" role="alert" ref={errorRef}>
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
                  ) : provider === 'espn' ? (
                    /*
                      ⚠ NO LINK, DELIBERATELY. This used to read "Connect ESPN in
                      Settings →" and navigate away mid-import; the connect panel is
                      now a few rows up this same card, so a link would send someone
                      to a second copy of a control already on screen. The sentence
                      points at it instead.

                      (It pointed at /leagues before that, which was worse again —
                      League Sync has no ESPN control on it at all, so a solvable
                      setup step read as "import is broken".)
                    */
                    <span className="af-im-error-link af-im-error-here">
                      Use &ldquo;Connect ESPN&rdquo; above to fix this.
                    </span>
                  ) : (
                    <Link href="/leagues" className="af-im-error-link">
                      Connect your accounts in League Sync →
                    </Link>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <ReadOnlyPromise />
      </section>
      )}

      {/*
        The CSV upload stays, as the second way in rather than the only one.
        Importing now runs from a league id, but an export still carries seasons
        the live API does not expose, and a league whose id will not read (a
        format the fxea API does not serve) has nowhere else to go.
      */}
      {/*
        ⚠ COLLAPSED, NOT DELETED. As a always-open panel this was the first thing a
        Fantrax importer met — a username field, a season, a sport, a file picker — and
        its own heading told them the league-id path did not exist. On a phone, "export
        CSVs from Fantrax and upload them" is where the import ends.
        The capability is still worth keeping for exactly the reason above: an export
        carries past seasons the live API does not expose, and a league whose id will not
        read has nowhere else to go. So it stays one click away instead of in the way.
      */}
      {(provider === 'fantrax' || defaultProvider === 'fantrax') && !importTakeover ? (
        <details className="af-im-fx-disclosure">
          <summary className="af-im-fx-link">Have a Fantrax CSV export? (optional — for past seasons)</summary>
          <FantraxUpload />
        </details>
      ) : null}

      {/* ── Discovered leagues ──────────────────────────────────────── */}
      {leagues.length > 0 && phase.k !== 'done' && !importTakeover ? (
        <section className="af-im-card">
          <header className="af-im-result-head">
            <h2 className="af-label">
              {rowsAreTeams
                ? accountLabel
                  ? `Which team is yours in ${accountLabel}?`
                  : 'Which team is yours?'
                : accountLabel
                  ? `Leagues for ${accountLabel}`
                  : 'Leagues we found'}
            </h2>
            <span className="af-chip af-num">{leagues.length}</span>
          </header>

          {/*
            Import all. Only worth offering when there is more than one, and hidden
            once a single import has taken over the screen.
          */}
          {leagues.length > 1 && !rowsAreTeams ? (
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
                  data-picked={
                    !excluded[l.sourceId] && leagues.length > 1 && !rowsAreTeams ? 'true' : undefined
                  }
                >
                  {/*
                    Only offered when there is more than one league — a lone
                    result has nothing to choose between, and a checkbox there
                    would imply the single "Import" button below it might not
                    apply to it.
                  */}
                  {leagues.length > 1 && !rowsAreTeams ? (
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
                    {/*
                      ⚠ WHY IT FAILED, NOT JUST THAT IT DID. "Failed" on its own makes
                      Retry a coin flip — a league that failed because it does not exist
                      will fail identically however many times it is pressed, and the
                      user has no way to tell that from a timeout worth re-running.
                      Only rendered for `failed`: the `needs-attestation` reason is the
                      attestation panel's job and would be duplicated here.
                    */}
                    {bulkStatus[l.sourceId] === 'failed' && bulkMessage[l.sourceId] ? (
                      <span className="af-im-league-reason">{bulkMessage[l.sourceId]}</span>
                    ) : null}
                  </span>
                  {bulkStatus[l.sourceId] ? (
                    <span className="af-im-league-outcome">
                      <span
                        className={`af-im-league-status af-im-league-status--${bulkStatus[l.sourceId]}`}
                        role="status"
                      >
                        {BULK_STATUS_LABEL[bulkStatus[l.sourceId]]}
                      </span>
                      {/*
                        ⚠ THE BADGE ALONE WAS A DEAD END. Any bulk status replaced the
                        row's "Import" button outright, so the one status that asks the
                        user to DO something -- "Needs your confirmation" -- left them
                        nothing to click. The summary line says "do those individually",
                        and the only way to obey it was to reload /import and re-run
                        discovery. Observed on a real 55-league Sleeper run.

                        Goes straight to the attestation panel rather than re-previewing:
                        the commit already told us this exact league needs one, so routing
                        back through preview -> commit -> 403 -> attest would just make the
                        user re-earn a refusal we have already recorded.
                      */}
                      {bulkStatus[l.sourceId] === 'needs-attestation' ? (
                        <button
                          type="button"
                          className="af-btn af-btn--ghost af-im-league-btn"
                          disabled={busy || bulkRunning}
                          onClick={() =>
                            setPhase({
                              k: 'attest',
                              sourceId: l.sourceId,
                              message:
                                bulkMessage[l.sourceId] ||
                                'Confirm you are authorized to import this league.',
                            })
                          }
                        >
                          Confirm
                        </button>
                      ) : null}
                      {/*
                        A failed row was as much a dead end as an unconfirmed one: the
                        badge replaced the button, so the only way to re-attempt a league
                        that hit a transient provider error midway through a long run was
                        to reload and re-discover. Retries in place instead.
                      */}
                      {bulkStatus[l.sourceId] === 'failed' ? (
                        <button
                          type="button"
                          className="af-btn af-btn--ghost af-im-league-btn"
                          disabled={busy || bulkRunning}
                          onClick={() => void retryLeague(l.sourceId)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="af-btn af-btn--ghost af-im-league-btn"
                      disabled={busy || bulkRunning}
                      onClick={() => void runPreview(l.sourceId)}
                    >
                      {busy ? 'Reading…' : rowsAreTeams ? 'This is my team' : 'Import'}
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
        <section className="af-im-card" ref={outcomeRef}>
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
            {/*
              Backing out of ONE league's confirmation must not discard the other
              fifty-four. `reset` still applies when this panel was reached without a
              discovered list (a deep link, or a pasted league ID).
            */}
            <button
              type="button"
              className="af-btn af-btn--ghost"
              onClick={leagues.length > 0 ? backToList : reset}
            >
              Cancel
            </button>
          </div>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── Preview, then commit ────────────────────────────────────── */}
      {phase.k === 'preview' ? (
        <section className="af-im-card" ref={outcomeRef}>
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
            <button
              type="button"
              className="af-btn af-btn--ghost"
              onClick={leagues.length > 0 ? backToList : reset}
            >
              Back
            </button>
          </div>
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── 6c: Importing ───────────────────────────────────────────── */}
      {importTakeover && phase.k !== 'done' ? (
        <section className="af-im-card">
          <ImportProgress
            providerLabel={providerLabel}
            accountLabel={accountLabel || (account.trim() || null)}
            steps={progressSteps}
            note={
              <>
                Nothing on {providerLabel} changes while this runs. I&rsquo;m building a
                read-only copy &mdash; your lineups, rosters and trades stay exactly as they
                are over there.
              </>
            }
          />
          <ReadOnlyPromise />
        </section>
      ) : null}

      {/* ── 6d: Done ────────────────────────────────────────────────── */}
      {phase.k === 'done' ? (
        <section className="af-im-card" ref={outcomeRef}>
          <ImportDone
            providerLabel={providerLabel}
            /*
              ⚠ THE LAST STEP OF AN IMPORT MUST NOT LAND ON THE OLD SURFACE.
              This once sent a manager who had just finished importing to the
              legacy league page, so the first thing they saw of their new league
              was the screen /core replaces — and it read as the import having gone
              somewhere wrong. The rule outlived the refactor that moved the button
              into ImportDone, so it is restated where the href actually is.
            */
            leagueHref={phase.leagueId ? `/core?league=${phase.leagueId}` : null}
            stats={doneStats}
            issue={doneIssue}
            noteText={
              phase.skipped
                ? 'This league was already imported, so nothing was re-read and nothing was overwritten. Re-import it below if it is missing data.'
                : `${phase.leagueName} is in. Nothing was changed on ${providerLabel}.`
            }
            sourceLink={doneSourceLink}
            note={doneChimmyNote}
            onImportAnother={() => {
              setAccount('')
              reset()
            }}
            extraActions={
              <>
            {phase.skipped ? (
              <button
                type="button"
                className="af-btn af-btn--ghost af-done-alt"
                onClick={() => void runCommit(phase.sourceId, phase.attested, true)}
              >
                Re-import and refresh
              </button>
            ) : null}
            {/*
              ⚠ THE ONLY WAY BACK TO A DISCOVERED LIST. Both primary actions
              navigate away, so anyone with a second league to add from the same
              lookup had to leave and re-enter /import and wait out discovery again.
            */}
            {leagues.length > 0 ? (
              <button
                type="button"
                className="af-btn af-btn--ghost af-done-alt"
                onClick={backToList}
              >
                Back to your leagues
              </button>
            ) : null}
            {/*
              ⚠ OFFERED, NOT FORCED. Someone who arrived from another flow came here
              to finish THAT one and would otherwise be stranded on a success screen
              with no way back to it.
            */}
            {returnTo ? (
              <Link href={returnTo} className="af-btn af-btn--ghost af-done-alt">
                Back to where you were
              </Link>
            ) : null}
              </>
            }
          />
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
