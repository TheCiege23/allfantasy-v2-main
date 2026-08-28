'use client'

import ThreadPanel from './ThreadPanel'
import RichMessage from './RichMessage'
import LeagueActivityFeed from './LeagueActivityFeed'
import { MessageTime } from './MessageTime'
import { PresenceStrip, type PresentViewer } from './PresenceStrip'
import { MessageReactions } from './MessageReactions'
import { QuotedMessage } from './QuotedMessage'
import { censorProfanity } from '@/lib/chat-core/censorProfanity'
import { PinnedBoard } from './PinnedBoard'
import { readPinnedRefs, type PinnedRef } from '@/lib/chat-core/pinnedMessages'
import { readReactions, toggleReactionLocally, type ViewerReaction } from '@/lib/chat-core/messageReactions'
import { notifyMentions, leagueMentionRoomId } from '@/lib/chat-core/notifyMentions'
import { useChatPolling } from '@/lib/chat-core/useChatPolling'
import { ChatComposer, type LeagueComposerPayload } from '@/app/dashboard/components/chat/ChatComposer'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@/components/core-app/af-comms.css'

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
}

export type CommsDrawerProps = {
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
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals?: string | null
  initialTab?: CommsTab
  /**
   * Seeds the private Chimmy composer with a question a screen wants asked.
   *
   * ⚠ DELIBERATELY NOT PASSED TO THE LEAGUE TAB. That panel posts its answers
   * to everyone in the league, and putting words a user never typed into a
   * public composer is a different act from putting them in a private one.
   */
  initialDraft?: string | null
}

const PUBLIC_ANSWER_NOTICE = 'Everyone in the league can see this answer.'

const HUDDLE_PRIVACY =
  'Nothing here can see your rosters. Huddle is a public feed across all of AllFantasy — no league data, ' +
  'no lineups, no trades of yours are readable from it.'

const DM_PRIVACY =
  'AllFantasy DMs are separate from Sleeper and ESPN messages. We do not read them, mirror them, or send ' +
  'anything back to those platforms.'

const DISCORD_PRIVACY =
  "Only your commissioner can connect, disconnect, or change what's bridged. The bot can see the one " +
  'channel they link — nothing else in the server — and edits or deletes made in either place do not sync.'

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
  { id: 'huddle', label: 'Huddle', audience: 'Everyone on AllFantasy' },
  { id: 'dms', label: 'DMs', audience: 'One person' },
  { id: 'discord', label: 'Discord', audience: "Everyone in one league's server" },
]

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
  /** Players the answer named, with headshots. */
  players?: ChimmyPlayerCard[] | null
}

type ChimmyGrounding =
  | { grounded: true; leagueName?: string | null; lastSyncedAt?: string | null }
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

// ── Chimmy panel ───────────────────────────────────────────────────────

function ChimmyPanel({
  leagues,
  scopeId,
  onScope,
  tokenCost,
  publicMode,
  homeSignals,
  initialDraft,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
  tokenCost: number | null
  /** League tab: answers are visible to the whole league and say so. */
  publicMode: boolean
  /** Ids+counts the /core home is showing — see lib/core-app/homeSignals.ts. */
  homeSignals: string | null
  /** A question a screen asked us to seed. Never auto-sent. */
  initialDraft?: string | null
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState(initialDraft ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const scope = useMemo(
    () => leagues.find((l) => l.id === scopeId) ?? null,
    [leagues, scopeId],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
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
      if (!question || busy) return
      setDraft('')
      setError(null)
      setBusy(true)
      setTurns((t) => [...t, { id: `you-${t.length}`, role: 'you', text: question }])

      try {
        /*
         * /api/chat/chimmy takes multipart form data, not JSON — see the call in
         * MockDraftSleeperRoomClient, which is the reference implementation. No
         * new route: the repo sits at Vercel's hard 2048-route ceiling and a
         * drawer is not worth one.
         */
        const form = new FormData()
        form.append('message', question)
        if (scopeId) form.append('leagueId', scopeId)
        /*
         * What the home is telling this user right now, so the assistant they
         * opened from the brief holds the brief's own facts instead of
         * re-deriving them and disagreeing on the same screen. Ids and counts
         * only; the server resolves names it has already confirmed they hold.
         */
        if (homeSignals) form.append('homeSignals', homeSignals)
        form.append(
          'conversation',
          JSON.stringify(
            turns.slice(-6).map((t) => ({
              role: t.role === 'chimmy' ? 'assistant' : 'user',
              content: t.text,
            })),
          ),
        )

        const res = await fetch('/api/chat/chimmy', { method: 'POST', body: form })
        /*
         * ⚠ READ THE WHOLE ENVELOPE. This used to destructure `response` and
         * `error` alone and drop the rest, so `meta.leagueGrounding` — the only
         * signal saying whether Chimmy could actually see this league — was
         * thrown away before it could be rendered. A grounding bug is invisible
         * from the UI if the UI never looks.
         */
        const payload = (await res.json().catch(() => ({}))) as {
          response?: string
          error?: string
          details?: { message?: string }
          meta?: {
            leagueGrounding?: ChimmyGrounding
            players?: ChimmyPlayerCard[]
            /** Answered without spending anything — do not print a price on it. */
            free?: boolean
            /**
             * What the server ACTUALLY charged. Present only on the path that
             * spends; the deterministic, usage and off-topic paths never set it.
             */
            tokenSpend?: { tokenCost?: number }
          }
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
              },
            ])
            return
          }
          throw new Error(describeChimmyError(payload.error))
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
            players: payload.meta?.players ?? null,
          },
        ])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chimmy could not answer that.')
      } finally {
        setBusy(false)
      }
    },
    [busy, publicMode, scope, scopeId, tokenCost, turns],
  )

  const quickPrompts = scope
    ? ['Who should I flex?', 'Any injuries I should know about?', 'Is this trade fair?']
    : ['Which league needs me most?', 'What locks first today?', 'Where am I weakest?']

  return (
    <div className="af-cm-panel">
      {/* Scope selector. The current scope is always visible, by contract. */}
      <div className="af-cm-scope">
        <span className="af-cm-scope-label">Scope</span>
        <div className="af-cm-scope-chips">
          <button
            type="button"
            className="af-cm-chip"
            data-on={scopeId == null}
            onClick={() => onScope(null)}
          >
            All leagues
            <span className="af-cm-chip-badge">GLOBAL</span>
          </button>
          {leagues.slice(0, 6).map((l) => (
            <button
              key={l.id}
              type="button"
              className="af-cm-chip"
              data-on={l.id === scopeId}
              onClick={() => onScope(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
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
            ? `Answers default to ${scope.name} — its scoring, its roster rules, its schedule. Name another of your leagues in the question to ask about that one instead.`
            : 'Answers cover every league you play. Ask about one by name, or pick it above.'}
        </p>
      </div>

      <div className="af-cm-thread">
        {turns.length === 0 ? (
          <div className="af-cm-empty">
            <p className="af-cm-empty-t">Nothing asked yet.</p>
            <p className="af-cm-empty-b">
              Opening this costs nothing. The first question is yours.
            </p>
            <div className="af-cm-quick">
              {quickPrompts.map((q) => (
                <button key={q} type="button" className="af-cm-quickbtn" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t) => (
            <div key={t.id} className="af-cm-turn" data-role={t.role}>
              <p className="af-cm-turn-text">{t.text}</p>

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

              {/* Cost sits alongside the answer — never hidden until checkout. */}
              {t.role === 'chimmy' && t.cost != null ? (
                <span className="af-cm-cost af-num">{t.cost} tokens</span>
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
        <div ref={endRef} />
      </div>

      <form
        className="af-cm-composer"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <input
          className="af-cm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={publicMode ? 'Ask the league, or @chimmy…' : 'Ask Chimmy…'}
          aria-label="Message"
          disabled={busy}
        />
        <button type="submit" className="af-cm-send" disabled={busy || !draft.trim()}>
          {tokenCost != null ? `Send · ${tokenCost}` : 'Send'}
        </button>
      </form>
      {/* Cost before the spend, in the chrome, not after the click. */}
      <p className="af-cm-costnote">
        {tokenCost != null
          ? `Each answer costs ${tokenCost} tokens. Typing costs nothing.`
          : 'Chimmy answers are included in your plan.'}
      </p>
    </div>
  )
}

// ── League chat panel ──────────────────────────────────────────────────

type LeagueMessage = {
  id: string
  /** Set when this message answers another one. */
  parentMessageId: string | null
  /** Needed to tell whether the viewer may close a poll they posted. */
  authorId: string | null
  author: string
  message: string
  createdAt: string
  /**
   * The rich half — GIF, attachments, poll. The API has always returned it; this
   * panel used to drop it on the floor, so anything sent as a GIF arrived as the
   * literal text "🎬 GIF".
   */
  metadata?: Record<string, unknown> | null
}

function LeaguePanel({
  leagues,
  scopeId,
  onScope,
  chimmyTokenCost,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
  chimmyTokenCost: number | null
}) {
  const [messages, setMessages] = useState<LeagueMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [askChimmy, setAskChimmy] = useState(false)
  const [presence, setPresence] = useState<PresentViewer[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  /*
   * In-flight reaction toggles win over whatever the server last said. Without
   * this the 4-8s poll would land mid-request and snap the chip back to its old
   * state, then forward again a tick later.
   */
  const [reactionOverride, setReactionOverride] = useState<Record<string, ViewerReaction[]>>({})
  const [reactionBusy, setReactionBusy] = useState<string | null>(null)
  const [voteBusy, setVoteBusy] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<LeagueMessage | null>(null)
  const [pins, setPins] = useState<PinnedRef[]>([])
  const [pinBusy, setPinBusy] = useState(false)
  const [includeDraft, setIncludeDraft] = useState(false)

  const scope = useMemo(() => leagues.find((l) => l.id === scopeId) ?? null, [leagues, scopeId])

  /*
   * Parents are looked up among the messages already loaded. The panel holds the
   * most recent 40, so a reply to something older finds nothing here — which
   * `QuotedMessage` states rather than rendering an empty quote.
   */
  const byId = useMemo(() => {
    const map = new Map<string, LeagueMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  /*
   * `quiet` exists for polling. Without it every tick would flip the loading flag
   * and flash "Loading league chat…" over a conversation the reader is already
   * looking at, several times a minute.
   */
  const load = useCallback(async (leagueId: string, quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/app/leagues/${encodeURIComponent(leagueId)}/chat?limit=40${includeDraft ? '&includeDraft=1' : ''}`,
      )
      if (!res.ok) throw new Error(`Chat returned ${res.status}`)
      /*
       * Wire shape is /api/league/chat's toClientMessage (reached via the
       * /api/app proxy): flat `authorName` / `text`, not a nested `user` row —
       * that nested shape was the bracket-pool chat's, which this drawer was
       * wrongly pointed at (and 403'd every fantasy league).
       */
      const data = (await res.json()) as {
        viewerUserId?: string | null
        presence?: PresentViewer[]
        messages?: Array<{
          id: string
          text?: string | null
          createdAt: string
          parentMessageId?: string | null
          authorId?: string | null
          authorName?: string | null
          metadata?: Record<string, unknown> | null
        }>
      }
      setPresence(Array.isArray(data.presence) ? data.presence : [])
      setViewerUserId(typeof data.viewerUserId === 'string' ? data.viewerUserId : null)
      setMessages(
        (data.messages ?? []).map((m) => ({
          id: m.id,
          parentMessageId: typeof m.parentMessageId === 'string' ? m.parentMessageId : null,
          authorId: typeof m.authorId === 'string' && m.authorId ? m.authorId : null,
          author: m.authorName || 'Someone',
          message: m.text ?? '',
          createdAt: m.createdAt,
          metadata: m.metadata ?? null,
        })),
      )
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not load this league's chat (${e.message}).`
          : "Could not load this league's chat.",
      )
    } finally {
      if (!quiet) setLoading(false)
    }
    /* Flipping the draft-room view has to re-fetch, so it belongs in here. */
  }, [includeDraft])

  const loadPins = useCallback(async (leagueId: string) => {
    try {
      const res = await fetch(
        `/api/shared/chat/threads/${encodeURIComponent(`league:${leagueId}`)}/pinned`,
      )
      if (!res.ok) return
      const data = (await res.json().catch(() => ({}))) as { pinned?: unknown }
      setPins(readPinnedRefs(data.pinned))
    } catch {
      /* A board that failed to load is not worth an error over a working chat. */
    }
  }, [])

  useEffect(() => {
    if (scopeId) void load(scopeId)
    else {
      setMessages([])
      setPresence([])
    }
    setReactionOverride({})
    setReplyTo(null)
    setPins([])
    if (scopeId) void loadPins(scopeId)
  }, [scopeId, load, loadPins])

  /*
   * Near-realtime. League chat had the same problem as the DM panel: it loaded
   * once when you picked a league and never again, so a reply arrived only if you
   * switched leagues and back.
   */
  useChatPolling({
    refresh: () => (scopeId ? load(scopeId, true) : Promise.resolve()),
    enabled: Boolean(scopeId),
    active: sending,
  })

  /*
   * Reactions. The POST and DELETE behind this have been written, access-checked
   * and live for a long time with no caller anywhere in the app; for a fantasy
   * league they store into `LeagueChatMessage.metadata.reactions`, which is the
   * same metadata this panel already renders GIFs and polls from.
   *
   * ⚠ The endpoint gates on `canAccessLeagueDraft`, which is NOT the predicate
   * the chat GET used to let this reader in. If those two ever disagree, a
   * member can read the thread and get a 403 reacting to it — so a failure says
   * so plainly and puts the chip back, rather than leaving a tap that silently
   * did nothing.
   */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, current: ViewerReaction[]) => {
      if (!scopeId || reactionBusy) return

      const next = toggleReactionLocally(current, emoji)
      const adding = next.some((r) => r.emoji === emoji && r.mine)

      setReactionOverride((prev) => ({ ...prev, [messageId]: next }))
      setReactionBusy(messageId)

      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${scopeId}`)}/messages/${encodeURIComponent(messageId)}/reactions`,
          {
            method: adding ? 'POST' : 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emoji }),
          },
        )
        if (!res.ok) {
          throw new Error(res.status === 403 ? 'you cannot react in this league' : `server said ${res.status}`)
        }
        await load(scopeId, true)
      } catch (e) {
        setError(
          e instanceof Error ? `Reaction did not save — ${e.message}.` : 'Reaction did not save.',
        )
      } finally {
        /* Server state wins from here, right or wrong — the override was only
           ever meant to cover the round trip. */
        setReactionOverride((prev) => {
          const rest = { ...prev }
          delete rest[messageId]
          return rest
        })
        setReactionBusy(null)
      }
    },
    [scopeId, reactionBusy, load],
  )

  /*
   * Poll voting. The vote route had no league branch at all until now, so a poll
   * posted in league chat could be rendered and never answered.
   */
  const votePoll = useCallback(
    async (messageId: string, optionId: string) => {
      if (!scopeId || voteBusy) return
      setVoteBusy(messageId)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${scopeId}`)}/messages/${encodeURIComponent(messageId)}/vote`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ optionId }),
          },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await load(scopeId, true)
      } catch (e) {
        setError(e instanceof Error ? `Vote did not save — ${e.message}.` : 'Vote did not save.')
      } finally {
        setVoteBusy(null)
      }
    },
    [scopeId, voteBusy, load],
  )

  /*
   * The pin, unpin and pinned routes have all had a league branch the whole
   * time and no caller anywhere. Their gate was the same wrong one the reaction
   * route had, fixed alongside this.
   */
  const pinMessage = useCallback(
    async (messageId: string) => {
      if (!scopeId || pinBusy) return
      setPinBusy(true)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${scopeId}`)}/pin`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId }),
          },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await loadPins(scopeId)
      } catch (e) {
        setError(e instanceof Error ? `Could not pin that — ${e.message}.` : 'Could not pin that.')
      } finally {
        setPinBusy(false)
      }
    },
    [scopeId, pinBusy, loadPins],
  )

  const unpinMessage = useCallback(
    async (pinMessageId: string) => {
      if (!scopeId || pinBusy) return
      setPinBusy(true)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${scopeId}`)}/unpin`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pinMessageId }),
          },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await loadPins(scopeId)
      } catch (e) {
        setError(e instanceof Error ? `Could not unpin that — ${e.message}.` : 'Could not unpin that.')
      } finally {
        setPinBusy(false)
      }
    },
    [scopeId, pinBusy, loadPins],
  )

  const closePoll = useCallback(
    async (messageId: string) => {
      if (!scopeId || voteBusy) return
      setVoteBusy(messageId)
      try {
        const res = await fetch(
          `/api/shared/chat/threads/${encodeURIComponent(`league:${scopeId}`)}/messages/${encodeURIComponent(messageId)}/close-poll`,
          { method: 'POST' },
        )
        if (!res.ok) throw new Error(`server said ${res.status}`)
        await load(scopeId, true)
      } catch (e) {
        setError(e instanceof Error ? `Could not close the poll — ${e.message}.` : 'Could not close the poll.')
      } finally {
        setVoteBusy(null)
      }
    },
    [scopeId, voteBusy, load],
  )

  /*
   * Maps the composer's payload onto the metadata shape `/api/league/chat`
   * already stores and `RichMessage` already reads. Kept identical to the
   * dashboard panel's mapping on purpose — two shapes for one feature is how a
   * GIF ends up rendering in one surface and not the other.
   */
  const sendPayload = useCallback(
    async (payload: LeagueComposerPayload) => {
      if (!scopeId || sending) return
      const text = payload.text.trim()
      const metadata: Record<string, unknown> = {}

      if (payload.gifUrl || payload.giphyId) {
        if (payload.gifId) metadata.gifId = payload.gifId
        if (payload.giphyId) metadata.giphyId = payload.giphyId
        if (payload.gifUrl) metadata.gifUrl = payload.gifUrl
        if (payload.previewUrl) metadata.previewUrl = payload.previewUrl
        if (payload.gifTitle) metadata.gifTitle = payload.gifTitle
        metadata.gif = {
          previewUrl: payload.previewUrl ?? payload.gifUrl ?? '',
          url: payload.gifUrl ?? '',
          title: payload.gifTitle ?? 'GIF',
        }
      }

      if (payload.attachments?.length) {
        metadata.attachments = payload.attachments.map((a) => ({
          type: a.type,
          url: a.url,
          duration: a.duration,
          mimeType: a.mimeType,
        }))
      }

      if (payload.poll) {
        metadata.poll = {
          question: payload.poll.question,
          options: payload.poll.options.map((t, i) => ({
            id: `opt-${i}-${Date.now()}`,
            text: t,
            votes: [] as string[],
          })),
          closeAt: payload.poll.closeAt.toISOString(),
          allowMultiple: payload.poll.allowMultiple,
          anonymous: Boolean(payload.poll.anonymous),
        }
      }

      /*
       * A GIF or an image with no words still has to carry SOMETHING as the
       * message body — the row is text-shaped — but the label is a fallback, not
       * the content, and `RichMessage` renders the real thing above it.
       */
      const displayText =
        text ||
        (payload.gifUrl || payload.giphyId ? '🎬 GIF' : '') ||
        (payload.poll ? `📊 ${payload.poll.question}` : '') ||
        (payload.attachments?.length ? '📎 Media' : '')

      if (!displayText && Object.keys(metadata).length === 0) return

      setSending(true)
      try {
        const res = await fetch(`/api/app/leagues/${encodeURIComponent(scopeId)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: displayText,
            ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
            ...(replyTo ? { parentMessageId: replyTo.id } : {}),
          }),
        })
        if (!res.ok) throw new Error(`Send returned ${res.status}`)
        /*
         * The composer offers @mentions and @all; without this the drawer
         * autocompleted them and notified nobody. Fire-and-forget on purpose —
         * the message is already posted, and a failed ping must not read as a
         * failed send.
         */
        const posted = (await res.json().catch(() => ({}))) as { message?: { id?: string } }
        if (posted.message?.id) {
          void notifyMentions({
            threadId: leagueMentionRoomId(scopeId),
            messageId: posted.message.id,
            text: displayText,
          })
        }
        setDraft('')
        /* Only after it actually sent — a failed reply keeps its target. */
        setReplyTo(null)
        await load(scopeId)
      } catch (e) {
        setError(e instanceof Error ? `Message not sent (${e.message}).` : 'Message not sent.')
      } finally {
        setSending(false)
      }
    },
    [load, scopeId, sending, replyTo],
  )

  if (!scopeId) {
    return (
      <div className="af-cm-panel">
        <div className="af-cm-scope">
          <span className="af-cm-scope-label">League</span>
          <div className="af-cm-scope-chips">
            {leagues.slice(0, 8).map((l) => (
              <button key={l.id} type="button" className="af-cm-chip" onClick={() => onScope(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
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
          publicMode
          homeSignals={null}
        />
      </div>
    )
  }

  return (
    <div className="af-cm-panel">
      <div className="af-cm-scope">
        <span className="af-cm-scope-label">League</span>
        <div className="af-cm-scope-chips">
          {leagues.slice(0, 6).map((l) => (
            <button
              key={l.id}
              type="button"
              className="af-cm-chip"
              data-on={l.id === scopeId}
              onClick={() => onScope(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <button type="button" className="af-cm-summon" onClick={() => setAskChimmy(true)}>
          @chimmy — ask the league&apos;s AI, publicly
        </button>
        <PresenceStrip viewers={presence} />
        {/*
          The draft room already mirrors its messages into this league's chat;
          until now nothing read them. This is a view preference, not a league
          setting — one reader turning it on does not change what anybody else
          sees.
        */}
        <button
          type="button"
          className="af-cm-draft-toggle"
          data-on={includeDraft}
          onClick={() => setIncludeDraft((v) => !v)}
          aria-pressed={includeDraft}
        >
          {includeDraft ? 'Hide draft room' : 'Show draft room'}
        </button>
      </div>

      <PinnedBoard
        pins={pins}
        busy={pinBusy}
        onUnpin={(pinId) => void unpinMessage(pinId)}
        onJump={(messageId) =>
          document.getElementById(`af-cm-msg-${messageId}`)?.scrollIntoView({ block: 'center' })
        }
      />

      <div className="af-cm-thread">
        {loading ? (
          <p className="af-cm-loading">Loading {scope?.name ?? 'league'} chat…</p>
        ) : error ? (
          <p className="af-cm-error">{error}</p>
        ) : messages.length === 0 ? (
          <div className="af-cm-empty">
            <p className="af-cm-empty-t">Nobody&apos;s said anything yet.</p>
            <p className="af-cm-empty-b">Be the one who starts it.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="af-cm-msg" id={`af-cm-msg-${m.id}`}>
              {m.parentMessageId ? (
                <QuotedMessage
                  author={byId.get(m.parentMessageId)?.author ?? null}
                  text={
                    byId.has(m.parentMessageId)
                      ? censorProfanity(byId.get(m.parentMessageId)?.message ?? '')
                      : null
                  }
                  onJump={
                    byId.has(m.parentMessageId)
                      ? () =>
                          document
                            .getElementById(`af-cm-msg-${m.parentMessageId}`)
                            ?.scrollIntoView({ block: 'center' })
                      : undefined
                  }
                />
              ) : null}
              <span className="af-cm-msg-head">
                <span className="af-cm-msg-author">{m.author}</span>
                <MessageTime value={m.createdAt} />
                <button
                  type="button"
                  className="af-cm-reply-btn"
                  onClick={() => setReplyTo(m)}
                  aria-label={`Reply to ${m.author}`}
                >
                  Reply
                </button>
                <button
                  type="button"
                  className="af-cm-reply-btn"
                  disabled={pinBusy}
                  onClick={() => void pinMessage(m.id)}
                  aria-label={`Pin the message from ${m.author}`}
                >
                  Pin
                </button>
              </span>
              <p className="af-cm-msg-text">{censorProfanity(m.message)}</p>
              <RichMessage
                metadata={m.metadata}
                viewerUserId={viewerUserId}
                onVote={(optionId) => void votePoll(m.id, optionId)}
                onClosePoll={
                  /*
                   * Only offered to the author or a commissioner. The server
                   * checks the same thing — this just avoids showing a control
                   * that would be refused.
                   */
                  (viewerUserId && m.authorId === viewerUserId) || scope?.isCommissioner
                    ? () => void closePoll(m.id)
                    : undefined
                }
              />
              <MessageReactions
                reactions={reactionOverride[m.id] ?? readReactions(m.metadata, viewerUserId)}
                disabled={reactionBusy === m.id}
                onToggle={(emoji) =>
                  void toggleReaction(
                    m.id,
                    emoji,
                    reactionOverride[m.id] ?? readReactions(m.metadata, viewerUserId),
                  )
                }
              />
            </div>
          ))
        )}
      </div>

      {/*
        What this message will be answering. Shown right above the composer,
        because a reply target you cannot see is one you forget you set — and
        the next thing typed then lands as an answer to something the writer had
        stopped thinking about.
      */}
      {replyTo ? (
        <div className="af-cm-replybar">
          <span className="af-cm-replybar-label">Replying to {replyTo.author}</span>
          <span className="af-cm-replybar-text">{censorProfanity(replyTo.message)}</span>
          <button
            type="button"
            className="af-cm-replybar-x"
            onClick={() => setReplyTo(null)}
            aria-label="Cancel reply"
          >
            ×
          </button>
        </div>
      ) : null}

      {/*
        The full composer, not a text input: GIF search, emoji, polls, uploads,
        @mention autocomplete, @all, and @global for commissioners. All of it
        already existed in `app/dashboard/components/chat` and was reachable from
        exactly one surface; the drawer had a bare <input> beside it.

        `commissionerLeagues` is what makes @global offered — the broadcast
        endpoint re-checks commissioner status against `League.userId`, so this
        decides what is shown, never what is permitted.
      */}
      <ChatComposer
        leagueId={scopeId}
        /* `#` offers these by name alongside players, matched on the client. */
        autocompleteLeagues={leagues.map((l) => ({ id: l.id, name: l.name }))}
        chatType="league"
        placeholder={`Message ${scope?.name ?? 'the league'}…`}
        onSend={sendPayload}
        onAskChimmy={() => setAskChimmy(true)}
        isCommissioner={Boolean(scope?.isCommissioner)}
        commissionerLeagues={leagues
          .filter((l) => l.isCommissioner)
          .map((l) => ({ id: l.id, name: l.name, teamCount: l.teamCount ?? 0 }))}
      />
    </div>
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
          <div className="af-cm-scope-chips">
            {leagues.slice(0, 8).map((l) => (
              <button key={l.id} type="button" className="af-cm-chip" onClick={() => onScope(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
          <p className="af-cm-scope-note">
            Discord belongs to one league at a time. Pick which one.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="af-cm-panel">
      <div className="af-cm-scope">
        <span className="af-cm-scope-label">League</span>
        <div className="af-cm-scope-chips">
          {leagues.slice(0, 6).map((l) => (
            <button
              key={l.id}
              type="button"
              className="af-cm-chip"
              data-on={l.id === scopeId}
              onClick={() => onScope(l.id)}
            >
              {l.name}
            </button>
          ))}
        </div>
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
                Create a server in Discord (or use one you already have), invite the bot in, then link
                a channel from the full Discord settings screen.
              </p>
              <Link href="/core/discord" className="af-cm-linkbtn">
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
                <Link href="/core/discord" className="af-cm-linkbtn">
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
  homeSignals = null,
  initialTab = 'chimmy',
  initialDraft = null,
}: CommsDrawerProps) {
  const [tab, setTab] = useState<CommsTab>(initialTab)
  const [scopeId, setScopeId] = useState<string | null>(pageLeagueId)
  const panelRef = useRef<HTMLElement | null>(null)

  /*
   * ⚠ 23b's CORE VALUE PROP, AND IT IS REAL. A docked drawer follows the page:
   * open it on a league's roster and Chimmy is already scoped to that league
   * rather than to "Global". This effect is that behaviour. It runs on open and
   * on page-league change, and it deliberately does NOT run on every render —
   * once the user picks a different scope by hand, their choice stands until the
   * page itself changes.
   */
  useEffect(() => {
    if (open) setScopeId(pageLeagueId)
  }, [open, pageLeagueId])

  // Escape closes the overlay. A docked panel is part of the page and does not.
  useEffect(() => {
    if (!open || mode !== 'overlay') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mode, onClose])

  /*
   * Full-screen overlay hygiene: the page behind must not scroll, and focus
   * must land inside the dialog so keyboard and screen-reader users arrive
   * where the action is. Docked (23b) is part of the page and gets neither.
   */
  useEffect(() => {
    if (!open || mode !== 'overlay') return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open, mode])

  if (!open) return null

  const scopeName = leagues.find((l) => l.id === scopeId)?.name ?? null

  return (
    <>
      {mode === 'overlay' ? (
        <button
          type="button"
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
            <h2 className="af-cm-title">Communications</h2>
            {/* Contract 4: current scope, always visible. */}
            <span className="af-cm-scopechip" data-global={scopeId == null}>
              {scopeName ?? 'GLOBAL'}
            </span>
            <button type="button" className="af-cm-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <nav className="af-cm-tabs" role="tablist">
            {TABS.map((t) => (
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
                {t.label}
              </button>
            ))}
          </nav>

          {/* Who can see what you type here. The tabs' whole distinction. */}
          <p className="af-cm-audience">{TABS.find((t) => t.id === tab)!.audience}</p>
        </header>

        {tab === 'league' ? (
          <LeaguePanel
            leagues={leagues}
            scopeId={scopeId}
            onScope={setScopeId}
            chimmyTokenCost={chimmyTokenCost}
          />
        ) : tab === 'chimmy' ? (
          <ChimmyPanel
            leagues={leagues}
            scopeId={scopeId}
            onScope={setScopeId}
            tokenCost={chimmyTokenCost}
            publicMode={false}
            homeSignals={homeSignals}
            initialDraft={initialDraft}
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
