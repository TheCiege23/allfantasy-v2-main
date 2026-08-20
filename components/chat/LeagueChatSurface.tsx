'use client'

/**
 * 10a — the League Chat tab surface.
 *
 * ⚠ THIS TAB USED TO BE A SIGNPOST. `LeagueShell`'s `league_chat` case rendered a
 * card that said "League chat is visible in the left panel on desktop and opens
 * from the chat button on mobile" — a nav item that, when clicked, told you to
 * click something else. Meanwhile `components/chat/LeagueChatPanel.tsx` (1,760
 * lines: threads, pins, polls, reactions, the stats bot) was mounted by
 * `components/app/tabs/LeagueChatTab.tsx`, which nothing in the app imports.
 * Working chat existed and was unreachable from the tab named after it.
 *
 * ⚠ NOT WRAPPED IN `.af-core`, DELIBERATELY. The 10a handoff is an af-core
 * design, and every other screen in this batch is scoped that way. This one is
 * not, because `LeagueChatPanel` reads `var(--text)`, `var(--muted)`,
 * `var(--border)`, `var(--panel)` and `var(--panel2)` directly — af-core
 * redefines the first two and not the others, so scoping this subtree would
 * repaint the panel's type while leaving its surfaces on the global palette. The
 * chrome here therefore matches the league shell it lives inside, which is the
 * surface a user is actually comparing it against.
 *
 * ⚠ NO PRESENCE RAIL. The design shows "7 of 12 online" with green dots.
 * `lib/chat-core/ChatPresenceResolver.ts` is a stub whose own docstring says
 * "placeholder for typing/online presence — Future: integrate with presence API
 * or WebSocket", and no table records a heartbeat for chat. Rendering dots would
 * mean inventing who is online, on the one surface where a wrong answer changes
 * whether someone waits for a reply. The member count is real and is shown; the
 * online split is absent rather than guessed.
 */

import { useState } from 'react'
import { MessageSquare, Shield, Sparkles } from 'lucide-react'

import LeagueChatPanel from '@/components/chat/LeagueChatPanel'

export type LeagueChatSurfaceProps = {
  leagueId: string
  leagueName: string
  /** Source platform. Empty / 'allfantasy' / 'af' means AllFantasy hosts this league. */
  platform: string | null | undefined
  isCommissioner: boolean
  teamCount: number | null
  /** Imported leagues the user also has, for the "chat on their own platform" note. */
  importedLeagueCount: number
  onSendEveryone?: () => void
}

/**
 * ⚠ BASED ON THE CANONICAL PREDICATE, NEVER A BARE `platform === 'sleeper'` CHECK.
 * Mirrors `buildLeagueToolContext` in lib/ai-tools/league-tool-context-types.ts:
 * anything that is not empty / 'allfantasy' / 'af' is an import. A hand-rolled
 * allowlist would silently classify the next platform we add as AF-hosted and
 * hand it a chat its members cannot actually use.
 *
 * ⚠ WITH ONE ADDITION: `'manual'`. Measured against a real league —
 * "TheCiege26's 12-Team NFL Redraft League" carries `platform: 'manual'`, meaning
 * it was built by hand inside AllFantasy. The canonical predicate calls that an
 * import, which here would have rendered the sentence "Chat lives on manual" and
 * pointed a commissioner at a platform that does not exist. A manual league has
 * no upstream to defer to, so AllFantasy hosts its chat.
 *
 * The shared predicate is deliberately NOT changed: it also drives AI tool
 * context, where "was this imported" carries a different, write-safety meaning.
 * Worth reconciling separately.
 */
export function isAfHostedPlatform(platform: string | null | undefined): boolean {
  const p = String(platform ?? '').trim().toLowerCase()
  return p === '' || p === 'allfantasy' || p === 'af' || p === 'manual'
}

/** Platforms whose own chat we can honestly point someone at. */
const NAMED_PLATFORMS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  cbs: 'CBS',
  mfl: 'MyFantasyLeague',
  nfl: 'NFL.com',
}

function platformLabel(platform: string | null | undefined): string | null {
  const p = String(platform ?? '').trim().toLowerCase()
  return NAMED_PLATFORMS[p] ?? null
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{title}</h3>
      </div>
      {children}
    </section>
  )
}

export default function LeagueChatSurface({
  leagueId,
  leagueName,
  platform,
  isCommissioner,
  teamCount,
  importedLeagueCount,
  onSendEveryone,
}: LeagueChatSurfaceProps) {
  const [showHostedHelp, setShowHostedHelp] = useState(false)
  const afHosted = isAfHostedPlatform(platform)

  /*
   * ⚠ BUILD RULE 2: AN IMPORTED LEAGUE NEVER GETS THIS CHAT, AND IS TOLD WHY.
   * Sleeper/ESPN/Yahoo leagues are read-only mirrors — messages sent here would
   * never reach the people who actually play in them. The explicit note exists
   * so nobody hunts for a chat tab that will never work, which is what an empty
   * chat window would cause.
   */
  if (!afHosted) {
    /*
     * ⚠ ONLY NAME A PLATFORM WE RECOGNISE. Interpolating the raw `platform`
     * column produced copy like "Chat lives on manual" / "on mfl_v2" — a
     * destination the reader cannot act on and that reads as a bug. An
     * unrecognised value falls back to generic wording.
     */
    const label = platformLabel(platform)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 lg:px-6" data-testid="league-chat-imported">
        <section className="max-w-2xl rounded-3xl border border-white/[0.07] bg-white/[0.035] p-5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-white/40" aria-hidden />
            <h2 className="text-xl font-black text-white">
              {label ? `Chat lives on ${label}` : 'Chat lives on your source platform'}
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-white/55">
            {leagueName} was imported, so AllFantasy mirrors it read-only. Your league already chats on{' '}
            {label ?? 'its own platform'} and messages sent here would never reach them.
          </p>
          <p className="mt-3 text-sm leading-6 text-white/40">
            AllFantasy hosts chat for leagues created here. Commissioner broadcasts still reach every AF-hosted league
            you run.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 lg:px-6" data-testid="league-chat-surface">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black text-white">League chat</h2>
        <span className="relative inline-flex items-center gap-1.5">
          <span className="rounded-md border border-[#ff3d81]/30 bg-[#ff3d81]/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#ffb8d1]">
            AF-hosted
          </span>
          <button
            type="button"
            onClick={() => setShowHostedHelp((v) => !v)}
            aria-expanded={showHostedHelp}
            aria-label="What AF-hosted means"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[9px] font-bold text-white/50"
          >
            ?
          </button>
          {showHostedHelp ? (
            <span className="absolute left-0 top-8 z-20 w-72 rounded-xl border border-white/10 bg-[#0a0c1a] p-3 text-xs leading-5 text-white/65 shadow-xl">
              AllFantasy created and runs this league, so chat, polls and commissioner broadcasts live here. Imported
              leagues stay read-only and keep chatting on their source platform.
            </span>
          ) : null}
        </span>
        {teamCount != null && teamCount > 0 ? (
          // Real membership. No online/offline split — see the header note.
          <span className="font-mono text-xs text-white/40">{teamCount} members</span>
        ) : null}
      </header>

      {/*
        ⚠ THE RAIL STACKS UNDER THE CHAT UNTIL THERE IS REAL ROOM, AND `lg:` IS NOT
        REAL ROOM. Tailwind breakpoints measure the VIEWPORT; this surface lives in
        the league shell's centre column, which is roughly 460px wide at a 1440px
        viewport because the shell already owns a left panel and a right rail. At
        `lg` the rule fired and squeezed the message column to ~140px — a chat you
        could not read. `2xl` is the first width at which the centre column is
        genuinely wide enough for a 320px rail beside it.
      */}
      <div className="grid min-h-0 flex-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0">
          <LeagueChatPanel
            leagueId={leagueId}
            leagueName={leagueName}
            isCommissioner={isCommissioner}
            defaultOpen
            className="h-full min-h-[520px]"
          />
        </div>

        {/* Below the chat on narrow columns, beside it on very wide ones. */}
        <aside className="flex min-w-0 flex-col gap-3">
          {isCommissioner ? (
            <Card title="Commissioner" icon={<Shield className="h-3.5 w-3.5 text-[#ffb8d1]" aria-hidden />}>
              <p className="text-[13px] leading-5 text-white/60">
                Send one announcement to every league you run.
              </p>
              {/*
                An entry point into the existing broadcast flow, never a second
                composer — same rule 11a's "Send @everyone" follows. Rendered only
                when the caller can actually open that flow.
              */}
              {onSendEveryone ? (
                <button
                  type="button"
                  onClick={onSendEveryone}
                  className="mt-3 w-full rounded-xl border border-[#ff3d81]/30 bg-[#ff3d81]/15 px-3 py-2 text-[13px] font-bold text-[#ffb8d1] transition hover:bg-[#ff3d81]/25"
                >
                  Send @everyone
                </button>
              ) : null}
            </Card>
          ) : null}

          <Card title="@chimmy" icon={<Sparkles className="h-3.5 w-3.5 text-cyan-300" aria-hidden />}>
            {/*
              ⚠ BUILD RULE 3: THE PRIVACY OF @chimmy IS DISCLOSED BEFORE USE, NOT
              AFTER. Someone who assumes the thread can see their question will
              ask it differently than someone who knows only they get the reply.
              That disclosure has to sit next to the composer, not in a help doc.
            */}
            <p className="text-[13px] leading-5 text-white/60">
              Start a line with <span className="font-mono text-cyan-300">@chimmy</span> to ask about a trade or lineup.
              Only you see the reply.
            </p>
          </Card>

          {importedLeagueCount > 0 ? (
            <Card title="Chat is AF-only">
              <p className="text-[13px] leading-5 text-white/50">
                Your {importedLeagueCount} imported {importedLeagueCount === 1 ? 'league chats' : 'leagues chat'} on
                their own platform. AllFantasy hosts chat for leagues created here.
              </p>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
