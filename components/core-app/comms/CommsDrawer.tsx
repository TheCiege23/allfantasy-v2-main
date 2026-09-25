'use client'

import ThreadPanel from './ThreadPanel'
import { ChimmyTrades } from './ChimmyTrades'
import { LeagueScopePicker } from './LeagueScopePicker'
import { useScopedConversation } from './useScopedConversation'
import {
  ArrowUpRight,
  Eye,
  ImagePlus,
  MessageCircle,
  MessagesSquare,
  Radio,
  Send,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { LeagueConversation } from './LeagueConversation'
import { DM_PRIVACY, HUDDLE_PRIVACY } from './privacyCopy'
import { useCommsKeyboardInset } from './useCommsKeyboardInset'
import LeagueActivityFeed from './LeagueActivityFeed'
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
import { useOverlayContainment } from '../useOverlayContainment'
import { confirmTokenSpend } from '@/lib/tokens/client-confirm'
import '@/components/core-app/af-comms.css'
import type { CoreSurfaceKey } from '@/lib/core-app/coreSurface'
import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import { readActionCards, type ChimmyActionCard as ChimmyActionCardData } from '@/lib/chimmy-chat/actionCards'

/**
 * 23a — the communications drawer. 23b — the same drawer, docked on desktop.
 *
 * ⚠ ONE SHELL, MULTIPLE PANELS — NOT SEPARATE SCREENS. The handoff's build note
 * is explicit, and the reason is the product argument for a drawer at all:
 * "never a page you navigate to and lose your place". Five routes would be five
 * navigations. Header, tab bar and scope chip live here once; each tab supplies
 * only its body.
 *
 * ⚠ DOCKED IS A MODE, NOT A SECOND COMPONENT. `mode="docked"` widens to 392px and
 * sits beside page content instead of over it; `mode="overlay"` is 352px and
 * covers. The handoff asked whether these are one responsive component or two
 * layouts — they are one, because every copy contract below has to hold in both,
 * and two files is how one of them quietly stops holding.
 *
 * ⚠ THE COPY CONTRACTS, AND WHERE EACH LIVES. Every one is a trust disclosure,
 * not decoration, and none of them is conditional:
 *
 *   1. A LEAGUE-TAB ANSWER SAYS IT IS PUBLIC — `PUBLIC_ANSWER_NOTICE`, rendered
 *      on every @chimmy answer in the league tab. Everyone in the league sees it.
 *   2. HUDDLE SAYS IT CANNOT SEE ROSTERS — `HUDDLE_PRIVACY`, rendered on the
 *      panel every time it opens, not once on first visit.
 *   3. DMs SAY THEY ARE ALLFANTASY-ONLY — `DM_PRIVACY`. We do not read or mirror
 *      Sleeper or ESPN messages, and saying so is the commitment.
 *   4. CHIMMY ALWAYS SHOWS ITS CURRENT SCOPE — the chip in the header. A user must
 *      never have to guess what an answer was grounded in.
 *   5. DISCORD SAYS WHO CONTROLS IT — `DISCORD_PRIVACY`. Only the commissioner
 *      can connect, disconnect, or re-map the bridge; the tab shows a real
 *      invite (`createOrReuseChannelInvite`, minted with the bot's actual
 *      CREATE_INSTANT_INVITE grant) rather than pretending the server can be
 *      created on someone's behalf — Discord's own API refuses that past 10
 *      guilds, so the flow is always "join the one your commissioner made".
 *
 * ⚠ AUTO-SCOPE IS FUNCTIONALLY REAL, NOT ILLUSTRATIVE. 23b's core value prop is
 * that a docked Chimmy follows the page: open it on a league's roster and the
 * scope reads that league, not "Global". `pageLeagueId` is passed from the route
 * and applied on open — see the effect below. The handoff warns specifically
 * against shipping this as copy over a static mock.
 *
 * ⚠ EVERY ROSTER RECOMMENDATION ENDS AT THE SOURCE PLATFORM. "Open Sleeper to set
 * it", never "Set lineup". AllFantasy is read-only and this is a hard product
 * constraint, so the phrasing pattern is centralised in `platformHandoff` rather
 * than retyped per answer.
 */

export type CommsTab = 'league' | 'chimmy' | 'huddle' | 'dms' | 'discord'

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

export type CommsDrawerProps = {
  /** Keys the saved Chimmy conversations, so one account's chat never loads for another. */
  userId?: string
  mode?: 'overlay' | 'docked'
  open: boolean
  onClose: () => void
  leagues: CommsLeague[]
  /**
   * The league the CURRENT PAGE is about. Drives 23b's auto-scoping. Null on
   * cross-league screens, where Global is the honest scope.
   */
  pageLeagueId: string | null
  /** Tokens per Chimmy message, read from the real pricing matrix. */
  chimmyTokenCost: number | null
  /**
   * The caller's included Chimmy answers today, when their plan includes Chimmy (AF Pro: 100 a day).
   * Null for everyone else — they see the token price. Refreshed from every answer's meta after that.
   */
  chimmyPlanAllowance?: ChimmyPlanAllowanceView | null
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals?: string | null
  /** Validated server-side and used only to describe the Core workflow in view. */
  pageSurface?: CoreSurfaceKey | null
  initialTab?: CommsTab
  /**
   * Seeds the private Chimmy composer with a question a screen wants asked.
   *
   * ⚠ DELIBERATELY NOT PASSED TO THE LEAGUE TAB. That panel posts its answers
   * to everyone in the league, and putting words a user never typed into a
   * public composer is a different act from putting them in a private one.
   */
  initialDraft?: string | null
  /**
   * The latest explicit open request, numbered so a repeat of the same request still applies.
   * `initialTab` follows only a CHANGE of tab, so asking twice for the tab the user has since
   * left did nothing; `seq` changes every time. `leagueId` rescopes the drawer.
   */
  openRequest?: { seq: number; tab: CommsTab | null; leagueId: string | null } | null
}

const PUBLIC_ANSWER_NOTICE = 'Everyone in the league can see this answer.'

/* HUDDLE_PRIVACY and DM_PRIVACY live in ./privacyCopy — the league page shows the same two. */

/*
 * 2026-09-14 (user's call): the fuller notice. The earlier text said only what
 * the BOT can see, which left out the part a member most needs — Discord's own
 * roles decide who can read the channel, and a server's owners and admins can
 * read private channels regardless of anything AllFantasy does.
 */
const DISCORD_PRIVACY =
  "Your league's Discord is your league's space. AllFantasy doesn't read it unless your commissioner turns " +
  'on two-way, and private AllFantasy DMs are never copied there. Discord roles and channel permissions ' +
  'decide who sees each channel; server owners and admins can read every channel.'

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

const TABS: Array<{ id: CommsTab; label: string; audience: string }> = [
  { id: 'league', label: 'League', audience: 'Everyone in one league' },
  { id: 'chimmy', label: 'Chimmy', audience: 'Just you' },
  { id: 'huddle', label: 'Huddle', audience: 'Only this Huddle’s members' },
  { id: 'dms', label: 'DMs', audience: 'One person' },
  { id: 'discord', label: 'Discord', audience: "Everyone in one league's server" },
]

const TAB_ICONS: Record<CommsTab, typeof Sparkles> = {
  league: MessagesSquare,
  chimmy: Sparkles,
  huddle: Users,
  dms: MessageCircle,
  discord: Radio,
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

function ChimmyPanel({
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

        let res = await fetch('/api/chat/chimmy', { method: 'POST', body: buildForm(false) })
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
          res = await fetch('/api/chat/chimmy', { method: 'POST', body: buildForm(true) })
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
          throw new Error(describeChimmyError(payload.code ?? payload.error))
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
        /* A failed send hands the question back rather than losing what was typed. */
        setDraft(question)
        if (activeScope.current === scopeId) { setScreenshot(attached); setError(e instanceof Error ? e.message : 'Chimmy could not answer that.') }
      } finally {
        setBusy(false)
      }
    },
    [answerMode, busy, connectedMembers.length, homeSignals, includedLeagueIds, leagues, pageSurface, planStatus, publicMode, scope, scopeId, turns, screenshot, setDraft, setTurns],
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
                  entry={questionEntry({ coreSurface: pageSurface })}
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

// ── League chat panel ──────────────────────────────────────────────────

/*
 * The conversation itself — load, poll, reactions, votes, pins, edit/delete, search, typing,
 * reply and the composer — is `LeagueConversation`, shared with the league page and the draft
 * room. This panel adds only what belongs to the drawer: the league picker, the cross-league
 * activity feed when no league is picked, and the public @chimmy mode.
 */
function LeaguePanel({
  leagues,
  scopeId,
  onScope,
  chimmyTokenCost,
  chimmyPlanAllowance = null,
  userId,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
  chimmyTokenCost: number | null
  chimmyPlanAllowance?: ChimmyPlanAllowanceView | null
  userId?: string
}) {
  const [askChimmy, setAskChimmy] = useState(false)

  const scope = useMemo(() => leagues.find((l) => l.id === scopeId) ?? null, [leagues, scopeId])

  if (!scopeId) {
    return (
      <div className="af-cm-panel">
        <div className="af-cm-scope">
          <span className="af-cm-scope-label">League</span>
          <LeagueScopePicker leagues={leagues} value={scopeId} onChange={onScope} />
          <p className="af-cm-scope-note">
            League chat belongs to one league. Pick which one — chat is per league.
          </p>
        </div>

        {/*
          With no league picked, the useful thing is what has happened ACROSS
          them. Chat stays per-league (the note above still holds); this is the
          cross-league half the tab was missing, and every row names its own
          league because "somebody dropped a kicker" is unreadable across 60 of
          them.
        */}
        <div className="af-cm-thread">
          <p className="af-cm-scope-label">Recent activity, all leagues</p>
          <LeagueActivityFeed onOpenLeague={onScope} />
        </div>
      </div>
    )
  }

  /*
   * @chimmy in the league tab answers PUBLICLY. That is the whole reason the
   * league tab and the Chimmy tab are different tabs, so the toggle is explicit
   * and the disclosure is attached to every answer it produces.
   */
  if (askChimmy) {
    return (
      <div className="af-cm-panel">
        <div className="af-cm-publicbar">
          <b>@chimmy in {scope?.name}</b>
          <span>{PUBLIC_ANSWER_NOTICE}</span>
          <button type="button" className="af-cm-linkbtn" onClick={() => setAskChimmy(false)}>
            Back to chat
          </button>
        </div>
        {/*
          ⚠ NO HOME SIGNALS ON THE PUBLIC TAB. Answers here are posted to
          everyone in the league. Grounding one in this user's own home state
          would put their other leagues' problems in front of their rivals.
        */}
        <ChimmyPanel
          leagues={leagues}
          scopeId={scopeId}
          onScope={onScope}
          tokenCost={chimmyTokenCost}
          planAllowance={chimmyPlanAllowance}
          publicMode
          homeSignals={null}
          pageSurface={null}
          userId={userId}
        />
      </div>
    )
  }

  return (
    <LeagueConversation
      leagueId={scopeId}
      leagueName={scope?.name ?? null}
      isCommissioner={Boolean(scope?.isCommissioner)}
      leagues={leagues}
      viewerId={userId ?? null}
      surface="drawer"
      onAskChimmy={() => setAskChimmy(true)}
      toolbarLead={
        <>
          <span className="af-cm-scope-label">League</span>
          <LeagueScopePicker leagues={leagues} value={scopeId} onChange={onScope} />
          <button type="button" className="af-cm-summon" onClick={() => setAskChimmy(true)}>
            @chimmy — ask the league&apos;s AI, publicly
          </button>
        </>
      }
    />
  )
}

/**
 * Huddle and DMs.
 *
 * ⚠ NEITHER HAS A BACKEND IN THIS REPO, AND THIS SAYS SO RATHER THAN FAKING ONE.
 * There is no cross-league social feed (`/api/feed` is tournament-scoped and
 * requires a tournamentId) and no direct-message store of any kind. Rendering
 * invented posts and threads behind a real-looking tab is worse than an empty
 * tab, because a user cannot tell the difference until they try to reply.
 *
 * The privacy copy is rendered anyway, because it is the load-bearing part of
 * both designs and it is what the eventual implementation must carry.
 */

// ── Discord panel ──────────────────────────────────────────────────────

type DiscordStatus = {
  botConfigured: boolean
  isCommissioner: boolean
  missingPermissions: string[] | null
  /** Null when no channel is linked yet, or Discord couldn't be reached just now. */
  inviteUrl: string | null
  channel: {
    channelName: string | null
    guildName: string | null
    channelUrl: string
  } | null
}

/**
 * 32a's `/core/discord` screen is the commissioner's full configuration surface
 * (direction picker, member linking, surface mapping). This tab is deliberately
 * smaller: a member-facing entry point that answers "is there a Discord for this
 * league, and how do I get into it" without leaving the drawer. Commissioners get
 * a link out to the full screen; nobody gets a control this tab cannot back with
 * a real API call — there is no "create a server" button here, because Discord's
 * own API refuses bot-created guilds past a 10-guild cap, so the honest flow is
 * always "join the one your commissioner already made".
 */
function DiscordPanel({
  leagues,
  scopeId,
  onScope,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
}) {
  const [status, setStatus] = useState<DiscordStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scope = useMemo(() => leagues.find((l) => l.id === scopeId) ?? null, [leagues, scopeId])

  useEffect(() => {
    if (!scopeId) {
      setStatus(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/discord/league?leagueId=${encodeURIComponent(scopeId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Discord status returned ${res.status}`)
        return res.json() as Promise<DiscordStatus>
      })
      .then((data) => {
        if (!cancelled) setStatus(data)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? `Could not load Discord status (${e.message}).`
              : 'Could not load Discord status.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scopeId])

  if (!scopeId) {
    return (
      <div className="af-cm-panel">
        <div className="af-cm-scope">
          <span className="af-cm-scope-label">League</span>
          <LeagueScopePicker leagues={leagues} value={scopeId} onChange={onScope} />
          <p className="af-cm-scope-note">
            Discord belongs to one league at a time. Pick which one.
          </p>
        </div>
        {/*
          This used to stop at the picker and leave the rest of the panel blank, so someone who has
          never used Discord got no idea what the tab is for.
        */}
        <div className="af-cm-empty af-cm-empty--grow">
          <p className="af-cm-empty-t">Give your league its own Discord</p>
          <p className="af-cm-empty-b">
            A private server for your league&apos;s trash talk, voice chats and draft nights, run by your
            commissioner. AllFantasy doesn&apos;t read it. Pick a league above to find its server, or set
            one up if you run the league.
          </p>
          {leagues.length === 0 ? (
            <Link href="/import" className="af-cm-linkbtn">
              Add a league first →
            </Link>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="af-cm-panel">
      <div className="af-cm-scope">
        <span className="af-cm-scope-label">League</span>
        <LeagueScopePicker leagues={leagues} value={scopeId} onChange={onScope} />
      </div>

      <div className="af-cm-privacy">{DISCORD_PRIVACY}</div>

      <div className="af-cm-empty af-cm-empty--grow">
        {loading ? (
          <p className="af-cm-empty-t">Checking Discord…</p>
        ) : error ? (
          <>
            <p className="af-cm-empty-t">Couldn&apos;t load Discord</p>
            <p className="af-cm-empty-b">{error}</p>
          </>
        ) : !status?.botConfigured ? (
          <>
            <p className="af-cm-empty-t">Discord isn&apos;t set up on this deployment</p>
            <p className="af-cm-empty-b">There is no bot configured to relay for any league right now.</p>
          </>
        ) : !status.channel ? (
          status.isCommissioner ? (
            <>
              <p className="af-cm-empty-t">No Discord channel yet for {scope?.name}</p>
              <p className="af-cm-empty-b">
                Discord setup walks you through it in five steps: make the league&apos;s server, add
                AllFantasy, make the channel, and share the invite.
              </p>
              <Link href={`/core/discord?league=${encodeURIComponent(scopeId)}`} className="af-cm-linkbtn">
                Set up Discord →
              </Link>
            </>
          ) : (
            <>
              <p className="af-cm-empty-t">No Discord yet for {scope?.name}</p>
              <p className="af-cm-empty-b">
                Your commissioner hasn&apos;t connected a Discord server to this league.
              </p>
            </>
          )
        ) : (
          <>
            <p className="af-cm-empty-t">
              #{status.channel.channelName ?? 'channel'}
              {status.channel.guildName ? ` in ${status.channel.guildName}` : ''}
            </p>
            {status.missingPermissions && status.missingPermissions.length > 0 ? (
              <p className="af-cm-empty-b af-cm-warn">
                This server is missing permissions it needs ({status.missingPermissions.join(', ')})
                {status.isCommissioner
                  ? ' — re-invite the bot from Discord settings.'
                  : ' — ask your commissioner to reconnect the bot.'}
              </p>
            ) : null}
            <div className="af-cm-actions">
              {status.inviteUrl ? (
                <a
                  href={status.inviteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="af-cm-linkbtn"
                >
                  Join our Discord ↗
                </a>
              ) : null}
              <a
                href={status.channel.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="af-cm-linkbtn"
              >
                Open channel ↗
              </a>
              {status.isCommissioner ? (
                <Link href={`/core/discord?league=${encodeURIComponent(scopeId)}`} className="af-cm-linkbtn">
                  Manage Discord
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── The drawer ─────────────────────────────────────────────────────────

export function CommsDrawer({
  mode = 'overlay',
  open,
  onClose,
  leagues,
  pageLeagueId,
  chimmyTokenCost,
  chimmyPlanAllowance = null,
  homeSignals = null,
  pageSurface = null,
  initialTab = 'chimmy',
  initialDraft = null,
  openRequest = null,
  userId,
}: CommsDrawerProps) {
  const [tab, setTab] = useState<CommsTab>(initialTab)
  const [scopeId, setScopeId] = useState<string | null>(pageLeagueId)
  const panelRef = useRef<HTMLElement | null>(null)
  /** The backdrop. A SIBLING of the panel, so it needs an inert exemption — see below. */
  const scrimRef = useRef<HTMLButtonElement | null>(null)

  /*
   * ⚠ 23b's CORE VALUE PROP, AND IT IS REAL. A docked drawer follows the page:
   * open it on a league's roster and Chimmy is already scoped to that league
   * rather than to "Global". This effect is that behaviour. Once the user picks a
   * different scope by hand, their choice stands until the page itself changes.
   *
   * 🛑 IT USED TO RUN ON EVERY OPEN, WHICH BROKE THE SENTENCE ABOVE. Closing the
   * bubble and opening it again threw a hand-picked league away and put the
   * page's scope (often "All leagues") back (user report, 2026-09-16). It now
   * follows only an actual change of the page's league, compared against the
   * last one it followed — the drawer stays mounted across navigations, so a
   * change made while it is closed is still picked up.
   */
  const followedPageLeague = useRef(pageLeagueId)
  useEffect(() => {
    if (followedPageLeague.current === pageLeagueId) return
    followedPageLeague.current = pageLeagueId
    setScopeId(pageLeagueId)
  }, [pageLeagueId])

  /*
   * CommsDock keeps this instance mounted and changes `initialTab` when an open
   * request names a tab ("ask Chimmy about this"). Read once in useState, that
   * request was ignored whenever the drawer had already been opened on another
   * tab. It follows the prop when the prop changes — not on every open — so a
   * plain reopen still returns to the tab the user left.
   */
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const openRequestSeq = openRequest?.seq ?? 0
  useEffect(() => {
    if (!openRequest) return
    if (openRequest.tab) setTab(openRequest.tab)
    if (openRequest.leagueId && leagues.some((l) => l.id === openRequest.leagueId)) {
      setScopeId(openRequest.leagueId)
    }
    // Keyed on the sequence number alone: each request applies once, when it is made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestSeq])

  /*
   * Opening the Chimmy tab is reading Chimmy's weekly lineup and waiver checks, so they stop counting
   * toward the bubble. Once per visit to the tab; the bubble re-reads its number when the drawer closes.
   */
  useEffect(() => {
    if (!open || tab !== 'chimmy' || !userId) return
    void fetch('/api/chat/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'chimmy' }),
    }).catch(() => {})
  }, [open, tab, userId])

  /*
   * Full-screen overlay hygiene, from the one place that owns it: Escape, the
   * background scroll lock, background inertness, focus in on open and focus
   * back out on close.
   *
   * ⚠ `active` CARRIES THE MODE TEST, NOT JUST `open`. Docked (23b) sits BESIDE
   * page content rather than over it, so it is not modal and must take none of
   * this — trapping focus in a panel the user can see the page around, and
   * locking a page nothing is covering, are both worse than doing nothing.
   *
   * Three behaviours moved out of this file, none of which could stay local:
   *   - Escape was bound on `window` here and on `document` in the player card,
   *     so ONE keypress closed both. The hook's stack answers with the topmost.
   *   - the scroll lock captured `document.body.style.overflow` as though this
   *     drawer were its only owner. Open the player card first and this captured
   *     `'hidden'`, then wrote it back on close — leaving a page locked with no
   *     overlay on it. The hook reference-counts one lock instead.
   *   - focus landed on the panel and was never restored, dropping keyboard
   *     users on <body> at the top of the roster they came from.
   */
  /*
   * 🛑 THE SCRIM MUST BE NAMED, OR THE HOOK INERTS IT AND BACKDROP-CLOSE DIES.
   *
   * `applyInertForTopmost` walks the container's ancestor chain and marks every
   * sibling inert. This drawer renders its scrim as a SIBLING of the panel, so
   * the scrim was in that sweep — measured in Chromium at 1100×900:
   * `scrimHasInertAttr: true`, and a click at (8,8) left the drawer open. Inert
   * removes hit testing, so the scrim's `onClick` never fired.
   *
   * `PlayerCardSheet` escaped this only by accident of markup: its scrim WRAPS
   * the panel, so it is an ancestor, and ancestors are never inerted. The two
   * shapes are not interchangeable, and this one needs the exemption.
   */
  const keepClickable = useMemo(() => [scrimRef], [])

  useOverlayContainment({
    active: open && mode === 'overlay',
    containerRef: panelRef,
    onClose,
    keepClickableRefs: keepClickable,
  })

  /* The composer must stay above the on-screen keyboard — see the hook. */
  useCommsKeyboardInset(panelRef, open)

  if (!open) return null

  const scopeName = leagues.find((l) => l.id === scopeId)?.name ?? null

  return (
    <>
      {mode === 'overlay' ? (
        <button
          type="button"
          ref={scrimRef}
          className="af-cm-scrim"
          aria-label="Close communications"
          onClick={onClose}
        />
      ) : null}

      <aside
        className="af-cm"
        data-mode={mode}
        ref={panelRef}
        tabIndex={-1}
        role={mode === 'overlay' ? 'dialog' : 'complementary'}
        aria-modal={mode === 'overlay' ? true : undefined}
        aria-label="Communications"
      >
        <header className="af-cm-head">
          <div className="af-cm-headtop">
            <span className="af-cm-brand">
              <MessagesSquare size={15} aria-hidden />
              <h2 className="af-cm-title">Communications</h2>
            </span>
            {/* Contract 4: current scope, always visible. */}
            <span className="af-cm-scopechip" data-global={scopeId == null}>
              {scopeName ?? 'GLOBAL'}
            </span>
            <button type="button" className="af-cm-close" onClick={onClose} aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </div>

          <nav className="af-cm-tabs" role="tablist">
            {TABS.map((t) => {
              const Icon = TAB_ICONS[t.id]
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className="af-cm-tab"
                  data-on={tab === t.id}
                  onClick={() => setTab(t.id)}
                  title={t.audience}
                >
                  <Icon size={14} aria-hidden />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/*
            Who can see what you type here. The tabs' whole distinction — so it says so, rather than
            leaving "Just you" floating under the tabs with nothing to say what it answers.
          */}
          <p className="af-cm-audience">
            <Eye size={12} aria-hidden />
            <span>Who sees this: {TABS.find((t) => t.id === tab)!.audience}</span>
          </p>
        </header>

        {tab === 'league' ? (
          <LeaguePanel
            leagues={leagues}
            scopeId={scopeId}
            onScope={setScopeId}
            chimmyTokenCost={chimmyTokenCost}
            chimmyPlanAllowance={chimmyPlanAllowance}
            userId={userId}
          />
        ) : tab === 'chimmy' ? (
          <ChimmyPanel
            key={userId ?? 'anonymous'}
            leagues={leagues}
            scopeId={scopeId}
            onScope={setScopeId}
            tokenCost={chimmyTokenCost}
            planAllowance={chimmyPlanAllowance}
            publicMode={false}
            homeSignals={homeSignals}
            pageSurface={pageSurface}
            initialDraft={initialDraft}
            userId={userId}
          />
        ) : tab === 'huddle' ? (
          <ThreadPanel kind="group" privacy={HUDDLE_PRIVACY} />
        ) : tab === 'dms' ? (
          <ThreadPanel kind="dm" privacy={DM_PRIVACY} />
        ) : (
          <DiscordPanel leagues={leagues} scopeId={scopeId} onScope={setScopeId} />
        )}

        <footer className="af-cm-foot">
          <Link href="/settings?tab=notifications" className="af-cm-footlink">
            Notification settings
          </Link>
          <span className="af-cm-footnote">Read-only · AllFantasy never writes to your platform</span>
        </footer>
      </aside>
    </>
  )
}

export default CommsDrawer
