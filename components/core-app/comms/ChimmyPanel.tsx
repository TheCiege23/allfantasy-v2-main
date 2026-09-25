'use client'

import { ChimmyTrades } from './ChimmyTrades'
import { LeagueScopePicker } from './LeagueScopePicker'
import { useScopedConversation } from './useScopedConversation'
import { ArrowUpRight, ImagePlus, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { ChimmyEvidenceBlock, type ChimmyEvidence } from './ChimmyEvidence'
import { ChimmyRichText } from './ChimmyRichText'
import { ChimmyScenarioCard } from './ChimmyScenario'
import { ChimmyAdviceFollow, type ChimmyAdviceRef } from './ChimmyAdviceFollow'
import { ChimmyAnswerRating } from './ChimmyAnswerRating'
import { PushOptInPrompt } from '@/components/notifications/PushOptInPrompt'
import {
  ChimmyAnswerModeToggle,
  answeredMode,
  answeredModeLabel,
  useChimmyAnswerMode,
  type CoreAnswerMode,
} from './ChimmyAnswerMode'
import { MAX_ADVICE_KEY_LENGTH } from '@/lib/chimmy-advice/adviceKeys'
import { readReadyScenario, type ReadyChimmyScenario } from '@/lib/chimmy/tradeScenarioTypes'
import { readFollowUps } from '@/lib/chimmy/followUps'
import { drawerFeedbackSurface, type ChimmyFeedbackValue } from '@/lib/chimmy-chat/feedback-events'
import { questionEntry } from '@/lib/chimmy-context/telemetry/questionEntry'
import {
  describeAllowanceNote,
  describeAnswerAllowance,
  readPlanAllowanceView,
  type ChimmyPlanAllowanceView,
} from '@/lib/chimmy/planAllowanceView'
import { describeOutOfAnswers, type OutOfAnswers } from '@/lib/chimmy/outOfAnswers'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirmTokenSpend } from '@/lib/tokens/client-confirm'
import '@/components/core-app/af-comms.css'
import type { CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import { readActionCards, type ChimmyActionCard as ChimmyActionCardData } from '@/lib/chimmy-chat/actionCards'

/**
 * Chimmy's private chat — ONE component, shown in two places:
 *
 *   - the Chimmy tab of the comms drawer (`CommsDrawer`, on every /core screen), and
 *   - the full-page `/chimmy/chat` (`app/chimmy/chat/ChimmyChatPageClient.tsx`).
 *
 * ⚠ MOVED HERE, NOT COPIED. It lived inside CommsDrawer.tsx. The owner's call (2026-09-25) was that
 * the full page be "the same look and features as the chat drawer's Chimmy tab, just full-screen".
 * Two copies of this send path is how one of them quietly stops sending `confirmTokenSpend`, or
 * stops rendering the grounding line, while the other keeps working — so the page renders this
 * exact component and every drawer contract below holds on both surfaces.
 *
 * The code is the drawer's, byte for byte, apart from `export` and two optional props that only the
 * page passes (`sport`, `source`). With neither set, the request the drawer sends is unchanged.
 */

export type CommsLeague = {
  id: string
  name: string
  platform: string
  /**
   * The id the SOURCE PLATFORM knows this league by -- never `id`, which is an
   * AllFantasy uuid and resolves nowhere off-site. Null when we never recorded
   * one, which is why the hand-off has an in-app fallback.
   */
  platformLeagueId: string | null
  /**
   * Commissioner of THIS league. Carries the `@global` affordance: a broadcast
   * can only target leagues you actually run, and `/api/chat/global-broadcast`
   * re-checks it server-side — this field decides whether the option is offered
   * at all, never whether it is allowed.
   */
  isCommissioner?: boolean
  /** Shown in the `@global` league picker so a broadcast names its audience size. */
  teamCount?: number
  hub?: {
    id: string
    name: string
    members: Array<{ id: string; name: string; platform: string }>
  }
}

export const PUBLIC_ANSWER_NOTICE = 'Everyone in the league can see this answer.'

/**
 * The only phrasing allowed when Chimmy suggests a roster change.
 *
 * AllFantasy holds no write access to any platform, so an imperative like "Set
 * lineup" would promise something the product cannot do. Centralised so the
 * pattern cannot drift per answer.
 */
function platformHandoff(platform: string): string {
  const p = platform.toLowerCase()
  if (p === 'sleeper') return 'Open Sleeper to set it'
  if (p === 'espn') return 'Open ESPN to set it'
  if (p === 'yahoo') return 'Open Yahoo to set it'
  return 'Open your platform to set it'
}

/**
 * Where the hand-off actually points.
 *
 * WARNING: SLEEPER DEEP LINKS TAKE `platformLeagueId`, NOT `id`. `id` is the
 * AllFantasy uuid, so sleeper.com/leagues/<uuid> is a 404 -- a hand-off that
 * looked live and dead-ended every manager who followed it. Where we hold no
 * platform id we send the user back into the app rather than emit a URL that
 * cannot resolve. ESPN and Yahoo take no id here; those are league-picker
 * landings and are unchanged.
 */
function platformHandoffHref(league: CommsLeague): string {
  const inApp = `/core?league=${encodeURIComponent(league.id)}`
  switch (league.platform.toLowerCase()) {
    case 'sleeper':
      return league.platformLeagueId
        ? `https://sleeper.com/leagues/${encodeURIComponent(league.platformLeagueId)}`
        : inApp
    case 'espn':
      return 'https://fantasy.espn.com/football/league'
    case 'yahoo':
      return 'https://football.fantasysports.yahoo.com/'
    default:
      return inApp
  }
}

type ChatTurn = {
  id: string
  role: 'you' | 'chimmy'
  text: string
  /** League-tab answers are public and must say so. */
  isPublic?: boolean
  /** Rendered under an answer that recommends a roster change. */
  handoff?: { label: string; href: string } | null
  /** Charged tokens, shown alongside the answer rather than hidden. */
  cost?: number | null
  /**
   * What the answer was grounded on, straight from the route's `meta`. Rendered
   * so an ungrounded answer LOOKS ungrounded — otherwise the only way to notice
   * Chimmy cannot see your league is to already know the roster and spot that
   * the answer is wrong.
   */
  grounding?: ChimmyGrounding | null
  connectedScope?: Array<{ leagueId: string; leagueName: string; rosterStatus: 'available' | 'unavailable'; playerCount: number }> | null
  /** Players the answer named, with headshots. */
  players?: ChimmyPlayerCard[] | null
  /**
   * Confidence, freshness, what was read and what was missing — assembled from
   * `meta` + `contract` by `readEvidence`. See ChimmyEvidence.tsx for why this
   * arrives with every answer and used to be discarded.
   */
  evidence?: ChimmyEvidence | null
  /** A trade, add/drop or start/sit before/after, computed from the league's rosters. Only a resolved one arrives. */
  scenario?: ReadyChimmyScenario | null
  /** Advice this answer put on file — renders "Did it / Not doing it", and keeps the vote. */
  advice?: ChimmyAdviceRef | null
  /** The answer mode the SERVER says shaped this answer; absent when it did not say. */
  mode?: CoreAnswerMode | null
  /** On a "which league?" refusal: the leagues offered, as buttons that re-ask the question there. */
  choices?: Array<{ leagueId: string; leagueName: string }> | null
  /** The question that refusal answered, so a picked league can re-ask it. */
  retryQuestion?: string | null
  /** Brought in from another scope's conversation when the scope changed. */
  carried?: boolean
  /** What to ask next, from the server. Tapping fills the composer; it never sends. */
  followUps?: string[] | null
  /** What this answer did to the plan's included answers, when the caller's plan includes Chimmy. */
  plan?: ChimmyPlanAllowanceView | null
  /**
   * Set only on a delivered answer — never on a refusal, a carried turn or an error — and it is
   * what makes the thumbs render. Unique, because turn ids repeat across scopes and sessions.
   */
  answerId?: string | null
  /** The tools the answer used, from the route's `meta.toolsUsed`. What a rating is about. */
  tools?: string[] | null
  /** The thumbs the user gave this answer, kept so reopening the drawer shows it. */
  rating?: ChimmyFeedbackValue | null
  /**
   * "Start Kyren over Pollard" / "send Chase for Jefferson": the confirm cards from `meta.actionCards`.
   * A card changes nothing until the user taps Confirm on it; see lib/chimmy/actions/confirmAction.ts.
   */
  actionCards?: ChimmyActionCardData[] | null
}

/** How many earlier turns follow the user into another scope. */
const CARRIED_TURNS = 6

/**
 * Turns as they travel into another scope's thread: the words only. Hand-offs, scenarios, advice
 * buttons and refusal choices belong to the scope they were answered in, and a "set lineup on
 * Sleeper" link carried into a different league would point at the wrong roster.
 */
function carryable(turns: ChatTurn[], fromThread: string): ChatTurn[] {
  return turns.slice(-CARRIED_TURNS).map((t) => ({
    // Tagged with the thread it came from: two scopes both have a `you-2`.
    id: t.id.startsWith('carried:') ? t.id : `carried:${fromThread}:${t.id}`,
    role: t.role,
    text: t.text,
    carried: true,
  }))
}

type ChimmyGrounding =
  | { grounded: true; leagueId?: string | null; leagueName?: string | null; lastSyncedAt?: string | null }
  | { grounded: false; reason?: string; message?: string }

/**
 * A player the answer named. `imageUrl` is null whenever no headshot could be
 * derived — rendered as initials, never as a placeholder image, so a missing
 * face never reads as a real one.
 */
type ChimmyPlayerCard = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  isStarter: boolean
}

/**
 * Turn an API error CODE into something a person can act on.
 *
 * ⚠ THE RAW CODE WAS BEING RENDERED TO USERS. A non-admin account asking a
 * perfectly ordinary question ("what games are on tonight in NFL?") saw
 * "VERIFICATION_REQUIRED Nothing was charged." — an internal identifier, in red,
 * with no hint that the fix is to verify an email and no way to get there. Every
 * other consumer of this error in the app routes to /verify; the chat drawer
 * alone printed the constant.
 *
 * ⚠ AND IT LOOKS LIKE A CRASH RATHER THAN A DOOR. That matters more than the
 * wording: an unverified user cannot use Chimmy AT ALL, and the message gave
 * them no reason to think verifying would change that. This repo has already
 * lost a funnel to exactly this shape — a requireVerifiedUser handler behind a
 * surface that never explained itself.
 */
const CHIMMY_ERROR_COPY: Record<string, string> = {
  VERIFICATION_REQUIRED:
    'Verify your email to use Chimmy — open Settings, or go to /verify. Your question was not sent.',
  AGE_REQUIRED: 'Confirm your date of birth in Settings to use Chimmy. Your question was not sent.',
  PROFILE_REQUIRED: 'Finish setting up your profile to use Chimmy. Your question was not sent.',
  insufficient_token_balance:
    'You are out of tokens, so this answer was not bought. Top up and ask again.',
  token_confirmation_required: 'Confirm the token spend and ask again.',
  ai_spend_disabled: 'AI answers are switched off right now. Nothing was attempted.',
}

function describeChimmyError(code: unknown): string {
  if (typeof code !== 'string' || !code) return 'Chimmy could not answer that.'
  const known = CHIMMY_ERROR_COPY[code]
  if (known) return known
  /*
   * An UNKNOWN code is still not something to show raw. SCREAMING_SNAKE and
   * lower_snake identifiers are internal by definition — if one reaches here it
   * is a gap in the map above, and the reader should get a sentence rather than
   * a constant while that gap is closed.
   */
  if (/^[A-Z][A-Z0-9_]*$/.test(code) || /^[a-z][a-z0-9_]*$/.test(code)) {
    return 'Chimmy could not answer that.'
  }
  return code
}

/**
 * What went wrong, in words, and whether sending the same question again could fix it.
 *
 * 🛑 "Chimmy could not answer that." IN RED, AND NOTHING ELSE, WAS THE WHOLE FAILURE UI (live test
 * 2026-09-25: a question left the drawer, 90 seconds later that line appeared, with the question
 * printed in the transcript AND back in the box). It said nothing about why and offered no way on.
 * A gate (verify, age, tokens) keeps its own sentence and gets no retry — asking again cannot pass
 * it. A dropped connection, a timeout, a rate limit or a server fault can clear on its own, so those
 * say which one it was and offer Try again.
 *
 * ⚠ NONE OF THESE SAYS WHETHER TOKENS WERE SPENT. The route can fail after the spend (see the note
 * on the error line below), so "nothing was charged" is a promise a 500 cannot keep.
 */
export function describeChimmyFailure(status: number | null, code: unknown): { message: string; retryable: boolean } {
  if (typeof code === 'string' && CHIMMY_ERROR_COPY[code]) return { message: CHIMMY_ERROR_COPY[code], retryable: false }
  if (status === null) return { message: 'Could not reach Chimmy. Check your connection.', retryable: true }
  if (status === 408 || status === 504 || status === 524) return { message: 'Chimmy took too long on that one.', retryable: true }
  if (status === 429) return { message: 'Too many questions at once. Give it a few seconds.', retryable: true }
  if (status >= 500) return { message: 'Chimmy hit a snag on our side.', retryable: true }
  return { message: describeChimmyError(code), retryable: false }
}

/** A failed ask, carrying whether a retry is worth offering. */
class ChimmyAskError extends Error {
  readonly retryable: boolean
  constructor(failure: { message: string; retryable: boolean }) {
    super(failure.message)
    this.retryable = failure.retryable
  }
}

function playerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function PlayerChips({ players }: { players: ChimmyPlayerCard[] }) {
  return (
    <div className="af-cm-players">
      {players.map((p) => (
        <span key={p.playerId} className="af-cm-player" data-starter={p.isStarter}>
          {p.imageUrl ? (
            /*
             * A broken CDN URL must degrade to initials rather than a broken-image
             * glyph, so the element removes itself and reveals the fallback beneath.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="af-cm-playerimg"
              src={p.imageUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : null}
          <span className="af-cm-playerfallback" aria-hidden>
            {playerInitials(p.name)}
          </span>
          <span className="af-cm-playermeta">
            <span className="af-cm-playername">{p.name}</span>
            {p.position || p.team ? (
              <span className="af-cm-playerpos">
                {[p.position, p.team].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * The response envelope, as far as this drawer reads it.
 *
 * ⚠ `contract` IS A SIBLING OF `meta`, NOT A FIELD INSIDE IT. The route returns
 * `{ response, sessionId, contract, meta }` — the confidence block with the
 * rationale and the missing-inputs list lives on `contract.confidence`, while
 * the percentage, the sources and the freshness live on `meta`. Reading only
 * one of the two gets you half an evidence block and no way to tell that is
 * what happened.
 */
type ChimmyEnvelope = {
  response?: string
  error?: string
  /** Machine-readable reason. `error` is a sentence; this is the map key. */
  code?: string
  preview?: { ruleCode?: string }
  /**
   * On a 409 consent request or a 402 out-of-tokens refusal: the caller's Chimmy allowance when
   * their plan includes Chimmy (used up, or they would not be paying). Validated by
   * `readPlanAllowanceView`; it decides whether the out-of-answers card offers AF Pro.
   */
  planAllowance?: unknown
  /** `choices` rides a 412 "which league?" — the caller's own leagues, from the route's lookup. */
  details?: { message?: string; choices?: Array<{ leagueId?: unknown; leagueName?: unknown }> }
  contract?: {
    confidence?: {
      level?: 'high' | 'medium' | 'low'
      rationale?: string
      freshness?: 'fresh' | 'partial' | 'stale' | 'unknown'
      basedOn?: string[]
      missing?: string[]
      leagueContext?: 'available' | 'partial' | 'missing'
    }
  }
  meta?: {
    leagueGrounding?: ChimmyGrounding
    connectedFranchise?: Array<{ leagueId: string; leagueName: string; rosterStatus: 'available' | 'unavailable'; playerCount: number }>
    players?: ChimmyPlayerCard[]
    /** Validated by `readReadyScenario` before anything renders it. */
    scenario?: unknown
    /** Set only when the route recorded this answer's advice. */
    advice?: { key?: unknown; type?: unknown; playerName?: unknown }
    /** The assistant mode that shaped the answer, when the route says so. */
    mode?: unknown
    /** Answered without spending anything — do not print a price on it. */
    free?: boolean
    /**
     * What the server ACTUALLY charged. Present only on the path that
     * spends; the deterministic, usage and off-topic paths never set it.
     */
    tokenSpend?: { tokenCost?: number }
    confidencePct?: number
    dataSources?: string[]
    sourceLinks?: { label: string; href: string }[]
    staleness?: { staleMinutes?: number | null; warning?: unknown }
    syncFreshness?: { sportsDigest?: { overallLastSyncedAt?: string | null } }
    /** Validated by `readFollowUps` before anything renders it. */
    followUps?: unknown
    /** The tools a tool-loop answer used, in order. Validated by `readToolsUsed`. */
    toolsUsed?: unknown
    /** Validated by `readPlanAllowanceView` before anything renders it. */
    planAllowance?: unknown
  }
}

/**
 * Fold the envelope down to what the evidence block renders.
 *
 * ⚠ EVERY FIELD IS OPTIONAL BECAUSE FIVE PATHS IN THAT ROUTE ANSWER WITHOUT A
 * CONTRACT. The deterministic answer sends `confidencePct: 100` and a one-entry
 * `dataSources` and nothing else; the off-topic deflection sends `0`; the tool
 * loop sends its tool names as the sources. All of those are real answers with
 * real evidence, and a parser that insisted on the full PECR shape would render
 * nothing under any of them — which is exactly the state this change exists to
 * end. Missing means missing, never zero.
 */
function readEvidence(payload: ChimmyEnvelope): ChimmyEvidence | null {
  const meta = payload.meta
  const confidence = payload.contract?.confidence
  if (!meta && !confidence) return null

  return {
    confidencePct: typeof meta?.confidencePct === 'number' ? meta.confidencePct : null,
    level: confidence?.level ?? null,
    rationale: confidence?.rationale ?? null,
    freshness: confidence?.freshness ?? null,
    leagueContext: confidence?.leagueContext ?? null,
    basedOn: confidence?.basedOn ?? [],
    missing: confidence?.missing ?? [],
    dataSources: meta?.dataSources ?? [],
    sourceLinks: meta?.sourceLinks ?? [],
    syncedAt: meta?.syncFreshness?.sportsDigest?.overallLastSyncedAt ?? null,
    staleMinutes: meta?.staleness?.staleMinutes ?? null,
  }
}

/**
 * The advice an answer put on file, or null. Only an `add` with a key and a name is kept — a
 * half-shaped object would render a button that sends an unusable vote.
 */
/** The tool names an answer reports, or an empty list. Anything that is not a short name is dropped. */
export function readToolsUsed(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((t): t is string => typeof t === 'string' && /^[\w.:-]{1,64}$/.test(t)).slice(0, 12)
}

function newAnswerId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto : undefined
  if (c?.randomUUID) return c.randomUUID()
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function readAdvice(payload: ChimmyEnvelope): ChimmyAdviceRef | null {
  const a = payload.meta?.advice
  if (!a || a.type !== 'add') return null
  const key = typeof a.key === 'string' ? a.key.trim() : ''
  const playerName = typeof a.playerName === 'string' ? a.playerName.trim() : ''
  if (!key || key.length > MAX_ADVICE_KEY_LENGTH || !playerName) return null
  return { key, type: 'add', playerName, vote: null }
}

// ── Chimmy panel ───────────────────────────────────────────────────────

export function ChimmyPanel({
  leagues,
  scopeId,
  onScope,
  tokenCost,
  publicMode,
  homeSignals,
  pageSurface,
  initialDraft,
  userId,
  planAllowance = null,
  sport = null,
  source = null,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
  tokenCost: number | null
  /** Included Chimmy answers left today, when the plan includes Chimmy. See CommsDrawerProps. */
  planAllowance?: ChimmyPlanAllowanceView | null
  /** League tab: answers are visible to the whole league and say so. */
  publicMode: boolean
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals: string | null
  pageSurface: CoreSurfaceKey | null
  /** A question a screen asked us to seed. Never auto-sent. */
  initialDraft?: string | null
  /** Keys the saved conversation, so one account's chat never loads for another. */
  userId?: string
  /**
   * The sport a page was opened for (`/chimmy/chat?sport=NBA`, e.g. from the player-compare view).
   * Sent ONLY while no league is in scope: the route lets a league's own sport outrank this field,
   * and a sport left over from a link has no business steering a question about a league the user
   * has since picked. The drawer never sets it.
   */
  sport?: string | null
  /**
   * Which surface asked, in the question row's own vocabulary (`questionEntry`) — so a thumbs-down
   * joins the question it is about. The drawer names its /core screen through `pageSurface` and
   * never sets this; `/chimmy/chat` sends `messages_ai`, the name that page has always recorded.
   */
  source?: string | null
}) {
  /*
   * Kept per scope in sessionStorage, so closing the bubble does not throw the
   * conversation away.
   *
   * ⚠ A PUBLIC LEAGUE ANSWER AND A PRIVATE CHAT ABOUT THE SAME LEAGUE ARE
   * DIFFERENT CONVERSATIONS. Keyed on the league alone, a private thread
   * would reappear under the league tab's public mode — rendered as though
   * the whole league could see it. The `public:` prefix keeps them apart.
   */
  const threadKey = useCallback(
    (id: string | null) => `${publicMode ? 'public:' : ''}${id ?? 'global'}`,
    [publicMode],
  )
  const { turns, draft, setTurns, setDraft, carryInto } = useScopedConversation<ChatTurn>(
    userId,
    threadKey(scopeId),
  )
  /*
   * The plan's included answers, as last reported: from the page on open, then from every answer's
   * meta — so "37 of 100 left" moves as the user asks, without another request to find out.
   */
  const [planStatus, setPlanStatus] = useState<ChimmyPlanAllowanceView | null>(planAllowance)

  /*
   * 🛑 SWITCHING SCOPE STARTED A CONVERSATION FROM NOTHING. Threads are kept per scope, so moving to a
   * league and asking "is he worth trading for there?" sent none of the earlier turns, and "he" meant
   * nothing (user report, 2026-09-16: "even after opening the league, Chimmy was lost"). The last few
   * turns now come along — into an empty thread only, unless `appendLast` asks for more.
   */
  const moveToScope = useCallback(
    (nextId: string | null, from: ChatTurn[] = turns, appendLast = 0) => {
      if (nextId === scopeId) return
      carryInto(threadKey(nextId), carryable(from, threadKey(scopeId)), appendLast)
      onScope(nextId)
    },
    [carryInto, onScope, scopeId, threadKey, turns],
  )

  /*
   * A question asked from "All leagues" that Chimmy answered about ONE of the user's leagues moves the
   * conversation there, so the follow-up is scoped too. Applied in an effect, after the answer is in
   * `turns`: the question and its answer join that league's thread, then the scope follows.
   */
  const [pendingAdopt, setPendingAdopt] = useState<string | null>(null)
  useEffect(() => {
    if (!pendingAdopt) return
    setPendingAdopt(null)
    if (scopeId !== null || !leagues.some((l) => l.id === pendingAdopt)) return
    moveToScope(pendingAdopt, turns, 2)
  }, [pendingAdopt, scopeId, leagues, moveToScope, turns])

  /* A "which league?" choice re-asks the question once its league is in scope. */
  const pendingResend = useRef<{ scope: string; question: string } | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * The question behind a failure that a retry could fix. Tied to the message it was raised with, so
   * any later error (a screenshot too large, a declined spend) hides Try again rather than offering to
   * resend under a sentence about something else.
   */
  const [retryAsk, setRetryAsk] = useState<{ message: string; question: string } | null>(null)
  /* Out of tokens: a card with ways to keep going, not an error line. See lib/chimmy/outOfAnswers.ts. */
  const [outOfAnswers, setOutOfAnswers] = useState<OutOfAnswers | null>(null)
  /* Fast or Deep, per user. Sent with every question; see ChimmyAnswerMode.tsx. */
  const [answerMode, setAnswerMode] = useChimmyAnswerMode(userId)
  const endRef = useRef<HTMLDivElement | null>(null)
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const screenshotRef = useRef<HTMLInputElement | null>(null)
  const activeScope = useRef(scopeId)
  activeScope.current = scopeId

  /* An attachment belongs to the scope it was picked in; switching scope drops it. */
  useEffect(() => {
    setScreenshot(null)
    setError(null)
    setOutOfAnswers(null)
    if (screenshotRef.current) screenshotRef.current.value = ''
  }, [scopeId])

  const scope = useMemo(
    () => leagues.find((l) => l.id === scopeId) ?? null,
    [leagues, scopeId],
  )
  const connectedMembers = scope?.hub?.members ?? []
  const [includedLeagueIds, setIncludedLeagueIds] = useState<string[]>([])
  useEffect(() => {
    setIncludedLeagueIds(connectedMembers.map((member) => member.id))
  }, [scope?.hub?.id])

  useEffect(() => {
    /* Nothing to scroll to on an empty thread — scrolling there jumped the empty state. */
    if (turns.length || busy) endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns.length, busy])

  /*
   * A later open with a different question re-seeds the box, but never over
   * something the user has already started typing — overwriting a half-written
   * message to insert our own is the one way this could cost someone anything.
   */
  useEffect(() => {
    if (initialDraft) setDraft((d) => (d.trim() ? d : initialDraft))
  }, [initialDraft])

  const send = useCallback(
    async (text: string) => {
      const question = text.trim()
      /* Captured once: the retry after a consent prompt must send the same file. */
      const attached = screenshot
      if ((!question && !attached) || busy) return
      setDraft('')
      setError(null)
      setOutOfAnswers(null)
      setBusy(true)
      setScreenshot(null)
      if (screenshotRef.current) screenshotRef.current.value = ''
      setTurns((t) => [
        ...t,
        { id: `you-${t.length}`, role: 'you', text: question || `Screenshot: ${attached?.name ?? 'image'}` },
      ])

      try {
        /*
         * /api/chat/chimmy takes multipart form data, not JSON — see the call in
         * MockDraftSleeperRoomClient, which is the reference implementation. No
         * new route: the repo sits at Vercel's hard 2048-route ceiling and a
         * drawer is not worth one.
         */
        const buildForm = (confirmed: boolean) => {
          const form = new FormData()
          form.append('message', question)
          if (confirmed) form.append('confirmTokenSpend', 'true')
          /* The route validates it (validateScreenshotFile); the 5 MB cap is also checked at pick time. */
          if (attached) form.append('image', attached)
          if (scopeId) form.append('leagueId', scopeId)
          if (!publicMode && connectedMembers.length > 1) {
            form.append('connectedLeagueIds', JSON.stringify(includedLeagueIds))
          }
          /*
           * What the home is telling this user right now, so the assistant they
           * opened from the brief holds the brief's own facts instead of
           * re-deriving them and disagreeing on the same screen. Ids and counts
           * only; the server resolves names it has already confirmed they hold.
           */
          if (homeSignals) form.append('homeSignals', homeSignals)
          if (pageSurface) form.append('coreSurface', pageSurface)
          /* Page-only context (see the props). Neither is ever set by the drawer. */
          if (source) form.append('source', source)
          if (sport && !scopeId) form.append('sport', sport)
          form.append('assistantMode', answerMode)
          form.append(
            'conversation',
            JSON.stringify(
              turns.slice(-6).map((t) => ({
                role: t.role === 'chimmy' ? 'assistant' : 'user',
                content: t.text,
              })),
            ),
          )
          return form
        }

        /* Only the request itself failing means the connection — a bug further down is not a network error. */
        const post = (confirmed: boolean) =>
          fetch('/api/chat/chimmy', { method: 'POST', body: buildForm(confirmed) }).catch(() => {
            throw new ChimmyAskError(describeChimmyFailure(null, null))
          })
        let res = await post(false)
        /*
         * ⚠ READ THE WHOLE ENVELOPE. This used to destructure `response` and
         * `error` alone and drop the rest, so `meta.leagueGrounding` — the only
         * signal saying whether Chimmy could actually see this league — was
         * thrown away before it could be rendered. A grounding bug is invisible
         * from the UI if the UI never looks.
         */
        let payload = (await res.json().catch(() => ({}))) as ChimmyEnvelope

        /*
         * Out of tokens is not a failure to report, it is a choice to offer: the question goes back
         * into the composer (so buying and re-asking is one click and one send), and the card says
         * how to keep going. The plan comes from the refusal itself when the route sent it, else
         * from what this drawer last knew.
         */
        const outOfTokens = (from: ChimmyEnvelope) => {
          setTurns((t) => (t.length && t[t.length - 1].role === 'you' ? t.slice(0, -1) : t))
          setDraft(question)
          if (activeScope.current === scopeId) {
            setScreenshot(attached)
            setOutOfAnswers(describeOutOfAnswers(readPlanAllowanceView(from.planAllowance) ?? planStatus))
          }
        }

        /*
         * 🛑 EVERY PAID ANSWER FROM THIS DRAWER WAS REFUSED. `/api/chat/chimmy`
         * returns 409 `token_confirmation_required` unless the request carries
         * `confirmTokenSpend`, and every token rule is seeded with
         * `requiresConfirmation: true` — so the drawer, which never sent the
         * flag and had no way to, answered every paid question with "Confirm the
         * token spend and ask again" and no control to do it.
         *
         * The fix is the app's own consent flow, not a new one: the draft room
         * answers the same 409 by asking through `confirmTokenSpend` (the preview
         * says whether a prompt is even needed) and retrying ONCE with the flag.
         * A decline spends nothing and hands the question back unsent.
         */
        if (res.status === 409 && payload.code === 'token_confirmation_required') {
          const consent = await confirmTokenSpend(payload.preview?.ruleCode ?? 'ai_chimmy_chat_message')
          if (!consent.preview.canSpend) {
            outOfTokens(payload)
            return
          }
          if (!consent.confirmed) {
            setTurns((t) => (t.length && t[t.length - 1].role === 'you' ? t.slice(0, -1) : t))
            setDraft(question)
            setError('No tokens were spent — your question was not sent.')
            return
          }
          res = await post(true)
          payload = (await res.json().catch(() => ({}))) as typeof payload
        }

        if (res.status === 402 && payload.code === 'insufficient_token_balance') {
          outOfTokens(payload)
          return
        }

        if (!res.ok) {
          /*
           * A refusal is a first-class answer, not a crash. The route returns 412
           * when it will not guess about a league it cannot read; `details.message`
           * says which case it was, and it belongs in the transcript where the
           * question was asked rather than in the generic error strip.
           */
          const refusal = payload.details?.message
          if (refusal) {
            /*
             * 🛑 THE LEAGUES A "WHICH LEAGUE?" REFUSAL OFFERED WERE THROWN AWAY, leaving the user to
             * find the picker and ask again. They are buttons now — only leagues this drawer can
             * scope to, so a button always lands somewhere real.
             */
            const offered = (payload.details?.choices ?? [])
              .map((c) => (typeof c?.leagueId === 'string' ? leagues.find((l) => l.id === c.leagueId) : undefined))
              .filter((l): l is CommsLeague => Boolean(l))
              .slice(0, 8)
              .map((l) => ({ leagueId: l.id, leagueName: l.name }))
            setTurns((t) => [
              ...t,
              {
                id: `chimmy-${t.length}`,
                role: 'chimmy',
                text: refusal,
                isPublic: publicMode,
                handoff: null,
                cost: null,
                grounding: { grounded: false, reason: 'refused' },
                choices: offered.length ? offered : null,
                retryQuestion: offered.length && question ? question : null,
              },
            ])
            return
          }
          throw new ChimmyAskError(describeChimmyFailure(res.status, payload.code ?? payload.error))
        }

        /*
         * Only meaningful when the user actually picked a league. On a GLOBAL
         * question the route reports `no_league_selected`, which is not a
         * grounding failure — rendering it as one would put "could not read your
         * league" under every cross-league answer and teach people to ignore the
         * line that matters.
         */
        const reported = payload.meta?.leagueGrounding ?? null
        const grounding =
          reported && !(reported.grounded === false && reported.reason === 'no_league_selected')
            ? reported
            : null

        const answer = payload.response ?? 'Chimmy did not return a message.'

        /*
         * When the answer reads as a roster recommendation, attach the platform
         * hand-off rather than leaving the user to work out where to act. Never
         * an in-app "Set lineup" — we hold no write access.
         */
        const recommendsRoster = /\b(start|sit|flex|bench|lineup|claim|drop|add)\b/i.test(answer)
        /*
         * Only ever under a GROUNDED answer. "Go make this change on Sleeper" is
         * the most action-shaped thing the drawer renders, and pointing someone
         * at their real roster on the strength of an answer Chimmy gave without
         * reading that roster is the exact trust failure the grounding work here
         * exists to close.
         */
        const handoff =
          recommendsRoster && scope && grounding?.grounded === true
            ? {
                label: platformHandoff(scope.platform),
                href: platformHandoffHref(scope),
              }
            : null

        const answeredPlan = readPlanAllowanceView(payload.meta?.planAllowance)
        setTurns((t) => [
          ...t,
          {
            id: `chimmy-${t.length}`,
            role: 'chimmy',
            text: answer,
            isPublic: publicMode,
            handoff,
            /*
             * ⚠ WAS UNCONDITIONAL — any 200 got the price label, taken from a
             * prop rather than from what happened. FOUR paths in that route
             * answer for free: the off-topic deflection, the deterministic
             * answer, the league-data-usage answer, and the empty-message
             * prompt. All of them were being billed 10 tokens on screen.
             *
             * Now it prints what the server says it spent, and nothing when it
             * spent nothing. `tokenCost` remains only as the composer's
             * "an answer costs this much" estimate, which is a different claim.
             */
            cost: payload.meta?.tokenSpend?.tokenCost ?? null,
            grounding,
            connectedScope: payload.meta?.connectedFranchise ?? null,
            players: payload.meta?.players ?? null,
            evidence: readEvidence(payload),
            /*
             * Only a well-formed, resolved scenario is kept. The route never sends anything else,
             * but a card that renders a half-shaped object would print "undefined" into a number
             * cell — a wrong number is worse than no card.
             */
            scenario: readReadyScenario(payload.meta?.scenario),
            advice: readAdvice(payload),
            mode: answeredMode(payload.meta),
            followUps: readFollowUps(payload.meta?.followUps),
            plan: answeredPlan,
            answerId: newAnswerId(),
            tools: readToolsUsed(payload.meta?.toolsUsed),
            actionCards: readActionCards(payload.meta),
          },
        ])
        if (answeredPlan) setPlanStatus(answeredPlan)
        // Asked from "All leagues", answered about one of yours: the conversation moves there.
        if (!scopeId && grounding?.grounded === true && typeof grounding.leagueId === 'string') {
          setPendingAdopt(grounding.leagueId)
        }
      } catch (e) {
        /*
         * A failed send hands the question back rather than losing what was typed — and takes it out
         * of the transcript, as the decline and out-of-tokens paths already do. Left in, it printed
         * twice (bubble and box), Try again added a third copy, and the next question sent it to the
         * model as an unanswered turn. Only when the thread still ends on THIS question: a scope
         * switch mid-request means the last turn is someone else's.
         */
        setDraft(question)
        if (activeScope.current === scopeId) {
          const shown = question || `Screenshot: ${attached?.name ?? 'image'}`
          setTurns((t) => (t.length && t[t.length - 1].role === 'you' && t[t.length - 1].text === shown ? t.slice(0, -1) : t))
          setScreenshot(attached)
          const failure =
            e instanceof ChimmyAskError ? e : { message: 'Chimmy hit a snag on that one.', retryable: true }
          setError(failure.message)
          setRetryAsk(failure.retryable ? { message: failure.message, question } : null)
        }
      } finally {
        setBusy(false)
      }
    },
    [answerMode, busy, connectedMembers.length, homeSignals, includedLeagueIds, leagues, pageSurface, planStatus, publicMode, scope, scopeId, turns, screenshot, setDraft, setTurns, source, sport],
  )

  useEffect(() => {
    const pending = pendingResend.current
    if (!pending || pending.scope !== scopeId || busy) return
    pendingResend.current = null
    void send(pending.question)
  }, [scopeId, busy, send])

  /** Re-ask a refused question in the league the user picked, carrying what came before it. */
  const askIn = useCallback(
    (leagueId: string, question: string, refusalId: string) => {
      const at = turns.findIndex((t) => t.id === refusalId)
      // Everything before the refused question: the question itself is sent again, not carried.
      const before = at > 0 ? turns.slice(0, at - 1) : []
      pendingResend.current = { scope: leagueId, question }
      if (leagueId === scopeId) {
        pendingResend.current = null
        void send(question)
        return
      }
      moveToScope(leagueId, before)
    },
    [turns, scopeId, send, moveToScope],
  )

  /*
   * Lead with what Chimmy now COMPUTES from the league — the best lineup, the season simulation,
   * this week's win probability — rather than questions any chatbot would take.
   */
  const quickPrompts = scope
    ? ['Set my best lineup for this week', 'What are my playoff odds?', 'How does my matchup look?', 'Find me a trade that fills my weakest spot']
    : ['Which league needs me most?', 'Which of my matchups are coin flips this week?', 'What locks first today?']

  /* Follow-up chips render under the newest answer only; older ones would be stale suggestions. */
  const lastChimmyId = [...turns].reverse().find((t) => t.role === 'chimmy')?.id ?? null

  return (
    <div className="af-cm-panel">
      {/* Scope selector. The current scope is always visible, by contract. */}
      <div className="af-cm-scope">
        <span className="af-cm-scope-label">Scope</span>
        {/*
          A searchable picker, not chips. The chips showed the first six leagues
          and silently dropped the rest — on a 60-league account, most leagues
          could not be scoped to from here at all.
        */}
        <LeagueScopePicker leagues={leagues} value={scopeId} onChange={(id) => moveToScope(id)} allowGlobal />
        {/*
          * ⚠ "ONLY" WAS A PROMISE THE SYSTEM DELIBERATELY DOES NOT KEEP. Scoped
          * to KBFL and asked "who can I pick up in the zombie league?", Chimmy
          * answers about Beta 1 Zombie League — `find_league_by_name` rebinds
          * the scope after verifying membership, which is the RIGHT call: a
          * league named in the question is a clearer signal than a chip left
          * selected from earlier. The behaviour is correct and the copy was
          * wrong, so the copy moved. It now also teaches the override, which
          * the "All leagues" line beside it already advertised.
          */}
        <p className="af-cm-scope-note">
          {scope
            ? `Answers default to ${scope.name}. Name another of your leagues in the question to ask about that one instead.`
            : 'Answers cover every league you play. Ask about one by name, or pick it above.'}
        </p>
        {!publicMode && connectedMembers.length > 1 ? (
          <fieldset className="af-cm-franchise-scope">
            <legend>{scope?.hub?.name ?? 'Connected franchise'} rosters</legend>
            <p>Choose which connected rosters Chimmy may use for this answer.</p>
            <div>
              {connectedMembers.map((member) => {
                const checked = includedLeagueIds.includes(member.id)
                return (
                  <label key={member.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy || (checked && includedLeagueIds.length === 1)}
                      onChange={() => setIncludedLeagueIds((ids) => checked ? ids.filter((id) => id !== member.id) : [...ids, member.id])}
                    />
                    <span>{member.name}</span>
                    <small>{member.platform}</small>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ) : null}
        <ChimmyAnswerModeToggle value={answerMode} onChange={setAnswerMode} disabled={busy} />
      </div>

      <div className="af-cm-thread">
        {scopeId && <ChimmyTrades key={scopeId} leagueId={scopeId} onAsk={setDraft} />}
        {turns.length === 0 ? (
          <div className="af-cm-empty">
            <Sparkles className="af-cm-welcome-icon" size={28} aria-hidden />
            <p className="af-cm-empty-t">Nothing asked yet.</p>
            <p className="af-cm-empty-b">
              Opening this costs nothing. The first question is yours.
            </p>
            <div className="af-cm-quick">
              {quickPrompts.map((q) => (
                /*
                 * Fills the box rather than sending. One tap on a suggestion used
                 * to spend tokens on a question the user had not finished choosing.
                 */
                <button key={q} type="button" className="af-cm-quickbtn" onClick={() => setDraft(q)}>
                  <span>{q}</span>
                  <ArrowUpRight size={13} aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t) => (
            <div key={t.id} className="af-cm-turn" data-role={t.role} data-carried={t.carried ? 'true' : undefined}>
              <span className="af-cm-turn-author">
                {t.role === 'chimmy' ? 'Chimmy' : 'You'}
                {t.carried ? ' · earlier' : ''}
              </span>
              {t.role === 'chimmy' ? (
                <ChimmyRichText text={t.text} className="af-cm-turn-text af-cm-rich" />
              ) : (
                <p className="af-cm-turn-text">{t.text}</p>
              )}

              {t.role === 'chimmy' && t.choices?.length && t.retryQuestion ? (
                <div className="af-cm-quick af-cm-choices" role="group" aria-label="Ask in one of these leagues">
                  {t.choices.map((c) => (
                    <button
                      key={c.leagueId}
                      type="button"
                      className="af-cm-quickbtn"
                      disabled={busy}
                      onClick={() => askIn(c.leagueId, t.retryQuestion as string, t.id)}
                    >
                      <span>Ask in {c.leagueName}</span>
                      <ArrowUpRight size={13} aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Contract 1: a public answer says so. */}
              {t.role === 'chimmy' && t.isPublic ? (
                <p className="af-cm-public">{PUBLIC_ANSWER_NOTICE}</p>
              ) : null}

              {/*
                Contract: an answer says what it could see. Grounded names the
                league; ungrounded says so in as many words. There is deliberately
                no third "unknown" rendering — if the route did not report, that is
                the ungrounded case and it should read like one.
              */}
              {t.role === 'chimmy' && t.grounding ? (
                t.grounding.grounded ? (
                  <p className="af-cm-grounding" data-grounded="true">
                    Read from {t.grounding.leagueName ?? 'your league'}
                    {t.grounding.lastSyncedAt
                      ? ` · synced ${new Date(t.grounding.lastSyncedAt).toLocaleString()}`
                      : ' · never synced'}
                  </p>
                ) : (
                  <p className="af-cm-grounding" data-grounded="false">
                    Chimmy could not read your league for this answer.
                  </p>
                )
              ) : null}
              {t.role === 'chimmy' && t.connectedScope?.length ? (
                <div className="af-cm-connected-used">
                  <strong>Connected rosters used</strong>
                  <div>{t.connectedScope.map((league) => (
                    <span key={league.leagueId} data-available={league.rosterStatus === 'available' || undefined}>
                      {league.leagueName} · {league.rosterStatus === 'available' ? `${league.playerCount} players` : 'unavailable'}
                    </span>
                  ))}</div>
                </div>
              ) : null}

              {/*
                Directly under the grounding line, because the two are one
                statement: grounding says WHICH league it could see, this says
                what inside it the answer actually rests on and what it could
                not read. Above the platform hand-off on purpose — "go make this
                change on Sleeper" is the most action-shaped thing here, and the
                caveats belong before the action, not under it.
              */}
              {t.role === 'chimmy' && t.evidence ? (
                <ChimmyEvidenceBlock evidence={t.evidence} />
              ) : null}

              {t.role === 'chimmy' && t.scenario ? <ChimmyScenarioCard scenario={t.scenario} /> : null}

              {t.role === 'chimmy' && t.actionCards?.length
                ? t.actionCards.map((card) => <ChimmyActionCard key={card.actionId} card={card} />)
                : null}

              {t.role === 'chimmy' && t.advice ? (
                <ChimmyAdviceFollow
                  advice={t.advice}
                  onVoted={(vote) =>
                    setTurns((all) =>
                      all.map((x) => (x.id === t.id && x.advice ? { ...x, advice: { ...x.advice, vote } } : x)),
                    )
                  }
                />
              ) : null}

              {t.role === 'chimmy' && t.players?.length ? (
                <PlayerChips players={t.players} />
              ) : null}

              {t.role === 'chimmy' && t.handoff ? (
                <a
                  className="af-cm-handoff"
                  href={t.handoff.href}
                  target={t.handoff.href.startsWith('http') ? '_blank' : undefined}
                  rel={t.handoff.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  {t.handoff.label} ↗
                </a>
              ) : null}

              {/* Which answer mode shaped this reply — only when the server said so. */}
              {t.role === 'chimmy' && answeredModeLabel(t.mode) ? (
                <span className="af-cm-mode-tag" data-mode={t.mode ?? undefined}>
                  {answeredModeLabel(t.mode)}
                </span>
              ) : null}

              {/* Cost sits alongside the answer — never hidden until checkout. */}
              {/* 0 is only ever reported for a charge refunded because no answer was delivered. */}
              {t.role === 'chimmy' && t.cost != null ? (
                <span className="af-cm-cost af-num">{t.cost === 0 ? 'Not charged' : `${t.cost} tokens`}</span>
              ) : null}
              {/* An answer the plan covered says so — "Included with AF Pro · 37 of 100 today". */}
              {t.role === 'chimmy' && t.plan ? (
                <span className="af-cm-cost af-cm-plan af-num" data-included={t.plan.included ? 'true' : 'false'}>
                  {describeAnswerAllowance(t.plan)}
                </span>
              ) : null}

              {/*
                Thumbs up / down — delivered answers only. Tagged with the tools the answer used
                and the screen it was asked from, so a rating joins to the question it is about.
              */}
              {t.role === 'chimmy' && t.answerId ? (
                <ChimmyAnswerRating
                  answerId={t.answerId}
                  rating={t.rating ?? null}
                  leagueId={(t.grounding?.grounded === true ? t.grounding.leagueId : null) ?? scopeId ?? null}
                  surface={drawerFeedbackSurface(pageSurface, Boolean(scopeId))}
                  mode={t.mode ?? answerMode}
                  entry={questionEntry({ coreSurface: pageSurface, source })}
                  tools={t.tools ?? []}
                  onRated={(rating) => setTurns((all) => all.map((x) => (x.id === t.id ? { ...x, rating } : x)))}
                />
              ) : null}

              {/*
                Right after a useful answer is when "want this on your phone?" makes sense — the
                only other asks live on settings screens (measured 2026-09-25: 0 of 110 users had
                push on). Under the latest delivered answer only; it hides itself for anyone who
                has already answered, and for two weeks after "Not now".
              */}
              {t.role === 'chimmy' && t.id === lastChimmyId && t.answerId && !busy ? (
                <PushOptInPrompt className="af-cm-pushask" />
              ) : null}

              {/*
                What to ask next. Same contract as the quick prompts: a tap fills the box and
                spends nothing — sending is still the user's decision.
              */}
              {t.role === 'chimmy' && t.id === lastChimmyId && t.followUps?.length && !busy ? (
                <div className="af-cm-quick af-cm-followups" role="group" aria-label="Ask next">
                  {t.followUps.map((q) => (
                    <button key={q} type="button" className="af-cm-quickbtn" onClick={() => setDraft(q)}>
                      <span>{q}</span>
                      <ArrowUpRight size={13} aria-hidden />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {busy ? <div className="af-cm-turn" data-role="chimmy"><p className="af-cm-turn-text af-cm-typing">Chimmy is thinking…</p></div> : null}
        {/*
          * ⚠ "Nothing was charged." USED TO BE APPENDED TO EVERY ERROR, and it is
          * not always true: route.ts:2848 returns a 500 AFTER the spend at 1883,
          * so a charged request could report itself as free. A blanket
          * reassurance about money is the one kind you cannot bluff.
          *
          * Each message in CHIMMY_ERROR_COPY now states the charge outcome only
          * where it is KNOWN — the gates say the question was not sent, the
          * balance case says the answer was not bought. The generic fallback
          * says nothing about charging, which is the honest position when we
          * genuinely do not know.
          */}
        {error ? <p className="af-cm-error">{error}</p> : null}
        {error && retryAsk?.message === error ? (
          <div className="af-cm-retryrow">
            <span>Your question is back in the box.</span>
            <button
              type="button"
              className="af-cm-retry"
              disabled={busy}
              onClick={() => {
                setRetryAsk(null)
                void send(retryAsk.question)
              }}
            >
              <RotateCcw size={13} aria-hidden />
              Try again
            </button>
          </div>
        ) : null}
        {outOfAnswers ? (
          <div className="af-cm-outofanswers" role="status">
            <p className="af-cm-outofanswers-title">{outOfAnswers.title}</p>
            <p className="af-cm-outofanswers-body">{outOfAnswers.body}</p>
            <div className="af-cm-outofanswers-actions">
              {outOfAnswers.actions.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="af-cm-outofanswers-btn"
                  data-primary={a.primary ? 'true' : undefined}
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {screenshot ? (
        <div className="af-cm-replybar">
          <span className="af-cm-replybar-label">Screenshot</span>
          <span className="af-cm-replybar-text">{screenshot.name}</span>
          <button
            type="button"
            className="af-cm-replybar-x"
            aria-label="Remove screenshot"
            onClick={() => {
              setScreenshot(null)
              if (screenshotRef.current) screenshotRef.current.value = ''
            }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
      <form
        className="af-cm-composer"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <input
          ref={screenshotRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file && file.size > 5 * 1024 * 1024) {
              setError('Screenshot must be 5 MB or smaller.')
            } else if (file) {
              setScreenshot(file)
              setError(null)
            }
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="af-cm-icon"
          aria-label="Attach screenshot"
          title="Attach screenshot"
          disabled={busy}
          onClick={() => screenshotRef.current?.click()}
        >
          <ImagePlus size={18} aria-hidden />
        </button>
        {/*
          One line that grows as you type (CSS `field-sizing: content`, capped), not a two-line box
          with a resize grip — the grip was the only thing in the composer that looked broken.
        */}
        <textarea
          rows={1}
          className="af-cm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={e => {
            const file = Array.from(e.clipboardData.files).find(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type))
            if (!file) return
            e.preventDefault()
            if (file.size > 5 * 1024 * 1024) setError('Screenshot must be 5 MB or smaller.')
            else { setScreenshot(file); setError(null) }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft) }
          }}
          placeholder={publicMode ? 'Ask the league, or @chimmy…' : 'Ask Chimmy…'}
          aria-label="Message"
          disabled={busy}
        />
        <button
          type="submit"
          className="af-cm-send"
          aria-label="Send to Chimmy"
          title="Send to Chimmy"
          disabled={busy || (!draft.trim() && !screenshot)}
        >
          <Send size={16} aria-hidden />
        </button>
      </form>
      {/*
        Cost before the spend, in the chrome, not after the click. "May": four
        paths in the route answer for free, so "each answer costs" was untrue.
      */}
      <p className="af-cm-costnote">
        {planStatus
          ? describeAllowanceNote(planStatus, tokenCost)
          : tokenCost != null
            ? `Chimmy answers may cost ${tokenCost} tokens. Free lookups and typing cost nothing.`
            : 'Chimmy answers are included in your plan.'}
      </p>
    </div>
  )
}
