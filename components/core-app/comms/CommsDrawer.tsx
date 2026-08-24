'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@/components/core-app/af-comms.css'

/**
 * 23a — the communications drawer. 23b — the same drawer, docked on desktop.
 *
 * ⚠ ONE SHELL, FOUR PANELS — NOT FOUR SCREENS. The handoff's build note is
 * explicit, and the reason is the product argument for a drawer at all: "never a
 * page you navigate to and lose your place". Four routes would be four
 * navigations. Header, tab bar and scope chip live here once; each tab supplies
 * only its body.
 *
 * ⚠ DOCKED IS A MODE, NOT A SECOND COMPONENT. `mode="docked"` widens to 392px and
 * sits beside page content instead of over it; `mode="overlay"` is 352px and
 * covers. The handoff asked whether these are one responsive component or two
 * layouts — they are one, because every copy contract below has to hold in both,
 * and two files is how one of them quietly stops holding.
 *
 * ⚠ THE FOUR COPY CONTRACTS, AND WHERE EACH LIVES. All four are trust
 * disclosures, not decoration, and none of them is conditional:
 *
 *   1. A LEAGUE-TAB ANSWER SAYS IT IS PUBLIC — `PUBLIC_ANSWER_NOTICE`, rendered
 *      on every @chimmy answer in the league tab. Everyone in the league sees it.
 *   2. HUDDLE SAYS IT CANNOT SEE ROSTERS — `HUDDLE_PRIVACY`, rendered on the
 *      panel every time it opens, not once on first visit.
 *   3. DMs SAY THEY ARE ALLFANTASY-ONLY — `DM_PRIVACY`. We do not read or mirror
 *      Sleeper or ESPN messages, and saying so is the commitment.
 *   4. CHIMMY ALWAYS SHOWS ITS CURRENT SCOPE — the chip in the header. A user must
 *      never have to guess what an answer was grounded in.
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

export type CommsTab = 'league' | 'chimmy' | 'huddle' | 'dms'

export type CommsLeague = {
  id: string
  name: string
  platform: string
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
  initialTab?: CommsTab
}

const PUBLIC_ANSWER_NOTICE = 'Everyone in the league can see this answer.'

const HUDDLE_PRIVACY =
  'Nothing here can see your rosters. Huddle is a public feed across all of AllFantasy — no league data, ' +
  'no lineups, no trades of yours are readable from it.'

const DM_PRIVACY =
  'AllFantasy DMs are separate from Sleeper and ESPN messages. We do not read them, mirror them, or send ' +
  'anything back to those platforms.'

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

const TABS: Array<{ id: CommsTab; label: string; audience: string }> = [
  { id: 'league', label: 'League', audience: 'Everyone in one league' },
  { id: 'chimmy', label: 'Chimmy', audience: 'Just you' },
  { id: 'huddle', label: 'Huddle', audience: 'Everyone on AllFantasy' },
  { id: 'dms', label: 'DMs', audience: 'One person' },
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
}

// ── Chimmy panel ───────────────────────────────────────────────────────

function ChimmyPanel({
  leagues,
  scopeId,
  onScope,
  tokenCost,
  publicMode,
}: {
  leagues: CommsLeague[]
  scopeId: string | null
  onScope: (id: string | null) => void
  tokenCost: number | null
  /** League tab: answers are visible to the whole league and say so. */
  publicMode: boolean
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
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
        const payload = (await res.json().catch(() => ({}))) as {
          response?: string
          error?: string
        }
        if (!res.ok) throw new Error(payload.error ?? 'Chimmy could not answer that.')

        const answer = payload.response ?? 'Chimmy did not return a message.'

        /*
         * When the answer reads as a roster recommendation, attach the platform
         * hand-off rather than leaving the user to work out where to act. Never
         * an in-app "Set lineup" — we hold no write access.
         */
        const recommendsRoster = /\b(start|sit|flex|bench|lineup|claim|drop|add)\b/i.test(answer)
        const handoff =
          recommendsRoster && scope
            ? {
                label: platformHandoff(scope.platform),
                href:
                  scope.platform.toLowerCase() === 'sleeper'
                    ? `https://sleeper.com/leagues/${encodeURIComponent(scope.id)}`
                    : scope.platform.toLowerCase() === 'espn'
                      ? 'https://fantasy.espn.com/football/league'
                      : scope.platform.toLowerCase() === 'yahoo'
                        ? 'https://football.fantasysports.yahoo.com/'
                        : `/core?league=${encodeURIComponent(scope.id)}`,
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
            cost: tokenCost,
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
        <p className="af-cm-scope-note">
          {scope
            ? `Answers are grounded in ${scope.name} only — its scoring, its roster rules, its schedule.`
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
        {error ? <p className="af-cm-error">{error} Nothing was charged.</p> : null}
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
  author: string
  message: string
  createdAt: string
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

  const scope = useMemo(() => leagues.find((l) => l.id === scopeId) ?? null, [leagues, scopeId])

  const load = useCallback(async (leagueId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/app/leagues/${encodeURIComponent(leagueId)}/chat?limit=40`)
      if (!res.ok) throw new Error(`Chat returned ${res.status}`)
      const data = (await res.json()) as {
        messages?: Array<{
          id: string
          message: string
          createdAt: string
          user?: { displayName?: string | null; username?: string | null } | null
        }>
      }
      setMessages(
        (data.messages ?? []).map((m) => ({
          id: m.id,
          author: m.user?.displayName || m.user?.username || 'Someone',
          message: m.message,
          createdAt: m.createdAt,
        })),
      )
    } catch (e) {
      setError(
        e instanceof Error
          ? `Could not load this league's chat (${e.message}).`
          : "Could not load this league's chat.",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (scopeId) void load(scopeId)
    else setMessages([])
  }, [scopeId, load])

  const send = useCallback(async () => {
    if (!scopeId || !draft.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/app/leagues/${encodeURIComponent(scopeId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: draft.trim() }),
      })
      if (!res.ok) throw new Error(`Send returned ${res.status}`)
      setDraft('')
      await load(scopeId)
    } catch (e) {
      setError(e instanceof Error ? `Message not sent (${e.message}).` : 'Message not sent.')
    } finally {
      setSending(false)
    }
  }, [draft, load, scopeId, sending])

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
            League chat belongs to one league. Pick which one — this tab is the group chat, not a
            cross-league feed.
          </p>
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
        <ChimmyPanel
          leagues={leagues}
          scopeId={scopeId}
          onScope={onScope}
          tokenCost={chimmyTokenCost}
          publicMode
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
      </div>

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
            <div key={m.id} className="af-cm-msg">
              <span className="af-cm-msg-author">{m.author}</span>
              <p className="af-cm-msg-text">{m.message}</p>
            </div>
          ))
        )}
      </div>

      <form
        className="af-cm-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          className="af-cm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${scope?.name ?? 'the league'}…`}
          aria-label="Message"
          disabled={sending}
        />
        <button type="submit" className="af-cm-send" disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
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
function UnbuiltPanel({
  title,
  privacy,
  missing,
}: {
  title: string
  privacy: string
  missing: string
}) {
  return (
    <div className="af-cm-panel">
      <div className="af-cm-privacy">{privacy}</div>
      <div className="af-cm-empty af-cm-empty--grow">
        <p className="af-cm-empty-t">{title} is not built yet.</p>
        <p className="af-cm-empty-b">{missing}</p>
        <p className="af-cm-empty-b">
          The tab is here because the drawer&apos;s four audiences are the design, and hiding one
          would make the other three harder to understand. It says so rather than showing you
          invented posts.
        </p>
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
  initialTab = 'chimmy',
}: CommsDrawerProps) {
  const [tab, setTab] = useState<CommsTab>(initialTab)
  const [scopeId, setScopeId] = useState<string | null>(pageLeagueId)

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

          {/* Who can see what you type here. The four tabs' whole distinction. */}
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
          />
        ) : tab === 'huddle' ? (
          <UnbuiltPanel
            title="Huddle"
            privacy={HUDDLE_PRIVACY}
            missing="There is no cross-league social feed in this codebase yet — the only feed endpoint is tournament-scoped and needs a tournament id, so it cannot back a global one."
          />
        ) : (
          <UnbuiltPanel
            title="DMs"
            privacy={DM_PRIVACY}
            missing="There is no direct-message store in this codebase yet. When it lands, each thread has to carry the league it came from — at 61 leagues a name on its own is not enough context to know who you are talking to."
          />
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
