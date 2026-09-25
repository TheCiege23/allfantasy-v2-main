'use client'

import ThreadPanel from './ThreadPanel'
import { LeagueScopePicker } from './LeagueScopePicker'
import { Eye, MessageCircle, MessagesSquare, Radio, Sparkles, Users, X } from 'lucide-react'
import { LeagueConversation } from './LeagueConversation'
import { DM_PRIVACY, HUDDLE_PRIVACY } from './privacyCopy'
import { useCommsKeyboardInset } from './useCommsKeyboardInset'
import LeagueActivityFeed from './LeagueActivityFeed'
import { ChimmyPanel, PUBLIC_ANSWER_NOTICE, type CommsLeague } from './ChimmyPanel'
import type { ChimmyPlanAllowanceView } from '@/lib/chimmy/planAllowanceView'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOverlayContainment } from '../useOverlayContainment'
import '@/components/core-app/af-comms.css'
import type { CoreSurfaceKey } from '@/lib/core-app/coreSurface'

/*
 * The Chimmy tab's panel — and the envelope readers that sat beside it here — moved to
 * ./ChimmyPanel, so the full-page /chimmy/chat renders the same component rather than a copy.
 * Re-exported so every existing importer of these names keeps working.
 */
export { describeChimmyFailure, readAdvice, readToolsUsed } from './ChimmyPanel'
export type { CommsLeague } from './ChimmyPanel'

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
 *      (or a co-commissioner) can connect, disconnect, or re-map the bridge; the
 *      tab shows the league's real invite — stored on the league, pasted by the
 *      commissioner or kept when the channel was made, never minted on a
 *      member's open — rather than pretending the server can be created on
 *      someone's behalf. Discord's own API refuses that past 10 guilds, so the
 *      flow is always "join the one your commissioner made".
 *
 * ⚠ AUTO-SCOPE IS FUNCTIONALLY REAL, NOT ILLUSTRATIVE. 23b's core value prop is
 * that a docked Chimmy follows the page: open it on a league's roster and the
 * scope reads that league, not "Global". `pageLeagueId` is passed from the route
 * and applied on open — see the effect below. The handoff warns specifically
 * against shipping this as copy over a static mock.
 *
 * ⚠ EVERY ROSTER RECOMMENDATION ENDS AT THE SOURCE PLATFORM. "Open Sleeper to set
 * it", never "Set lineup". AllFantasy is read-only and this is a hard product
 * constraint, so the phrasing pattern is centralised in `platformHandoff` (now in
 * ./ChimmyPanel, with the rest of the Chimmy tab) rather than retyped per answer.
 */

export type CommsTab = 'league' | 'chimmy' | 'huddle' | 'dms' | 'discord'

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

/* PUBLIC_ANSWER_NOTICE lives in ./ChimmyPanel beside the answers that carry it; LeaguePanel below uses it too. */

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
  /** Head commissioner or co-commissioner — the same rule the setup routes enforce. */
  isCommissioner: boolean
  missingPermissions: string[] | null
  /** The league's stored invite; null until the commissioner has set one. Needs no channel. */
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
  /** Bumped by Try again, so the same league is read again. */
  const [attempt, setAttempt] = useState(0)

  const scope = useMemo(() => leagues.find((l) => l.id === scopeId) ?? null, [leagues, scopeId])
  /*
   * Something to join or open. An invite alone is enough — a commissioner can paste their server's
   * link without ever adding the bot — so it is checked before "is the bot configured".
   */
  const joinable = status && (status.inviteUrl || (status.botConfigured && status.channel)) ? status : null

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
        if (!res.ok) throw new Error('discord status read failed')
        return res.json() as Promise<DiscordStatus>
      })
      .then((data) => {
        if (!cancelled) setStatus(data)
      })
      .catch(() => {
        /*
         * E3 (2026-09-25): this used to read "Could not load Discord status (Discord status returned
         * 500)." A status code is ours to log, not the customer's to read.
         */
        if (!cancelled) setError("Couldn't load this league's Discord. Try again.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scopeId, attempt])

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
            <p className="af-cm-empty-t">{error}</p>
            <div className="af-cm-retryrow">
              <button type="button" className="af-cm-retry" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          </>
        ) : joinable ? (
          <>
            <p className="af-cm-empty-t">
              {joinable.channel
                ? `#${joinable.channel.channelName ?? 'channel'}${joinable.channel.guildName ? ` in ${joinable.channel.guildName}` : ''}`
                : `${scope?.name ?? 'Your league'} has a Discord`}
            </p>
            {!joinable.channel ? (
              <p className="af-cm-empty-b">Trash talk, draft nights, voice chat — it all happens there. Jump in.</p>
            ) : null}
            {joinable.channel && joinable.missingPermissions && joinable.missingPermissions.length > 0 ? (
              <p className="af-cm-empty-b af-cm-warn">
                This server is missing permissions it needs ({joinable.missingPermissions.join(', ')})
                {joinable.isCommissioner
                  ? ' — re-invite the bot from Discord settings.'
                  : ' — ask your commissioner to reconnect the bot.'}
              </p>
            ) : null}
            <div className="af-cm-actions">
              {joinable.inviteUrl ? (
                <a href={joinable.inviteUrl} target="_blank" rel="noopener noreferrer" className="af-cm-linkbtn">
                  Join the league Discord ↗
                </a>
              ) : null}
              {joinable.channel ? (
                <a
                  href={joinable.channel.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="af-cm-linkbtn"
                >
                  Open channel ↗
                </a>
              ) : null}
              {joinable.isCommissioner ? (
                <Link href={`/core/discord?league=${encodeURIComponent(scopeId)}`} className="af-cm-linkbtn">
                  Manage Discord
                </Link>
              ) : null}
            </div>
          </>
        ) : !status?.botConfigured ? (
          <>
            <p className="af-cm-empty-t">Discord isn&apos;t set up on this deployment</p>
            <p className="af-cm-empty-b">There is no bot configured to relay for any league right now.</p>
          </>
        ) : (
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
          /*
           * 🛑 A KEY PER TAB, OR A HUDDLE OPENS UNDER "DMs". Both branches render ThreadPanel in the
           * same slot, so without keys React keeps ONE instance and only swaps its props: open a
           * huddle, tap DMs, and the huddle stayed open beneath the DM privacy note — group chat
           * labelled "One person" (live test 2026-09-25, phone-19). Keyed, each tab starts clean.
           */
          <ThreadPanel key="huddle" kind="group" privacy={HUDDLE_PRIVACY} />
        ) : tab === 'dms' ? (
          <ThreadPanel key="dms" kind="dm" privacy={DM_PRIVACY} />
        ) : (
          <DiscordPanel leagues={leagues} scopeId={scopeId} onScope={setScopeId} />
        )}

        <footer className="af-cm-foot">
          <Link href="/settings?tab=notifications" className="af-cm-footlink">
            Notification settings
          </Link>
          {/*
            V10: this said "Read-only · AllFantasy never writes to your platform" inside a chat you type
            into. What is true is narrower, and it is the part that matters: we never change your
            league on the platform it lives on.
          */}
          <span className="af-cm-footnote">AllFantasy never changes your league on Sleeper, ESPN or Yahoo.</span>
        </footer>
      </aside>
    </>
  )
}

export default CommsDrawer
