'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import '@/components/core-app/af-discord.css'
import {
  BRIDGE_SCOPES_REFUSED,
  BRIDGE_SCOPES_REQUESTED,
  flagsFromDirection,
  type BridgeDirection,
  type DiscordBridgeData,
} from '@/lib/core-app/discordBridge'

/**
 * 32a — the league's own Discord, set up in five plain steps.
 *
 * Product call (2026-09-25): Discord is the "your league, your space" option. The
 * commissioner makes a server that belongs to the league, adds AllFantasy to it, and
 * gets one channel AllFantasy can talk to. Everything else in that server is theirs.
 *
 * ⚠ DISCORD WILL NOT LET AN APP MAKE A SERVER FOR SOMEONE (bot-made servers stop
 * working past 10), so step 2 is a Discord server TEMPLATE link when the owner has
 * set `DISCORD_LEAGUE_TEMPLATE_CODE`, and Discord's own three taps when not.
 *
 * ⚠ STEP 3 IS THE REAL INSTALL ROUND TRIP. `data.installUrl` is our own
 * `/api/discord/bot-install?leagueId=…`, which checks the person manages the server
 * and comes back HERE with `?discord=bot-linked`. The old button was a bare
 * discord.com link with no redirect or state, so the server was never saved.
 *
 * ⚠ COPYING IS OFF UNTIL THE COMMISSIONER TURNS IT ON, and two-way is a separate
 * opt-in that is not even offered until it runs on a schedule
 * (`data.inboundAvailable`). A switch that does nothing is a lie with a toggle on it.
 *
 * ⚠ EDITS AND DELETES DO NOT COPY, AND DMs NEVER DO. Both are said on the screen,
 * the second as a privacy line rather than a missing feature.
 *
 * Customer copy: plain words, "Chimmy" never bare "AI", no jargon.
 */

export type DiscordBridgeProps = {
  data: DiscordBridgeData
}

type Visibility = 'server' | 'private'

type ChannelState = {
  channelName: string | null
  channelUrl: string
  visibility: Visibility | 'gone' | null
  inviteUrl: string | null
}

type AccessReport = {
  included: string[]
  notLinked: string[]
  notInServer: string[]
  unknown: string[]
}

/** What `/api/discord/bot-install` and `/api/discord/bot-callback` send back. */
const RETURN_MESSAGES: Record<string, { tone: 'good' | 'warn' | 'bad'; text: string }> = {
  'bot-linked': { tone: 'good', text: 'AllFantasy is in your server. Next up: make the league channel.' },
  'bot-cancelled': { tone: 'warn', text: 'No problem — nothing was added. Pick up again whenever you’re ready.' },
  'bot-unverified': {
    tone: 'bad',
    text: 'Discord says you don’t run that server. Pick one you own (or can manage), or make a new one in step 2.',
  },
  'bot-taken': {
    tone: 'bad',
    text: 'Another AllFantasy account already added that server. Make a fresh one for your league in step 2.',
  },
  'bot-error': { tone: 'bad', text: 'That didn’t go through. Give “Add AllFantasy” another try.' },
  'account-required': { tone: 'warn', text: 'Connect your Discord account first — that’s step 1.' },
  'bot-not-ready': { tone: 'bad', text: 'Discord isn’t switched on for AllFantasy yet. Try again a little later.' },
  'config-error': { tone: 'bad', text: 'Discord isn’t switched on for AllFantasy yet. Try again a little later.' },
}

function leagueChatMapping(data: DiscordBridgeData) {
  return data.mappings.find((m) => m.surface.id === 'league_chat') ?? null
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Step({
  n,
  state,
  title,
  children,
}: {
  n: number
  state: 'done' | 'current' | 'todo'
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="af-dc-step" data-state={state}>
      <span className="af-dc-step-n" aria-hidden="true">
        {state === 'done' ? '✓' : n}
      </span>
      <div className="af-dc-step-body">
        <h3 className="af-dc-step-title">
          {title}
          {state === 'done' ? <span className="af-dc-visually-hidden"> — done</span> : null}
        </h3>
        {children}
      </div>
    </li>
  )
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="af-dc-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="af-dc-switch-knob" aria-hidden="true" />
    </button>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="af-btn af-dc-btn af-dc-btn--ghost"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
          .catch(() => setCopied(false))
      }}
    >
      {copied ? 'Copied ✓' : 'Copy link'}
    </button>
  )
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function DiscordBridge({ data }: DiscordBridgeProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnFlag = searchParams?.get('discord') ?? null
  const returnMessage = returnFlag ? RETURN_MESSAGES[returnFlag] ?? null : null

  const mapping = leagueChatMapping(data)
  const inboundAvailable = data.inboundAvailable === true
  const serverReady = data.serverReady ?? Boolean(data.guildId && data.guildName)

  const [channel, setChannel] = useState<ChannelState | null>(
    mapping?.mapped && mapping.channelUrl
      ? { channelName: mapping.channelName, channelUrl: mapping.channelUrl, visibility: null, inviteUrl: null }
      : null,
  )
  const [direction, setDirection] = useState<BridgeDirection>(mapping?.mapped ? mapping.direction : 'off')
  const [missingPermissions, setMissingPermissions] = useState<string[] | null>(null)
  const [visibilityChoice, setVisibilityChoice] = useState<Visibility>('server')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [access, setAccess] = useState<AccessReport | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const linkedCount = data.members.filter((m) => m.linked).length

  /*
   * Connecting a Discord account finishes on Settings (that callback is not this
   * screen's), so it opens in a new tab and this screen re-reads itself when the
   * commissioner comes back to it. Only while step 1 is still open.
   */
  useEffect(() => {
    if (data.connected) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [data.connected, router])

  /* The invite link, who can see the channel, and permission gaps — read live. */
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/discord/league?leagueId=${encodeURIComponent(data.leagueId)}&detail=1`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const body = (await res.json()) as {
        inviteUrl?: string | null
        missingPermissions?: string[] | null
        channel?: { channelName: string | null; channelUrl: string; visibility?: Visibility | 'gone' | null } | null
      }
      setMissingPermissions(body.missingPermissions ?? null)
      if (body.channel) {
        setChannel({
          channelName: body.channel.channelName,
          channelUrl: body.channel.channelUrl,
          visibility: body.channel.visibility ?? null,
          inviteUrl: body.inviteUrl ?? null,
        })
      }
    } catch {
      /* Detail is a nicety; the steps still work without it. */
    }
  }, [data.leagueId])

  // Once, for a channel that existed when the screen loaded; after a create, the
  // create response carries the same fields.
  const mappedAtLoad = Boolean(mapping?.mapped)
  useEffect(() => {
    if (mappedAtLoad && data.botConfigured) void loadDetail()
  }, [mappedAtLoad, data.botConfigured, loadDetail])

  async function createChannel() {
    if (!data.guildId) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/discord/channels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: data.leagueId, guildId: data.guildId, visibility: visibilityChoice }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        channelName?: string
        channelUrl?: string
        visibility?: Visibility
        inviteUrl?: string | null
        access?: AccessReport
        alreadyExisted?: boolean
      }
      if (!res.ok || !body.channelUrl) {
        setCreateError(body.error ?? 'Discord didn’t make the channel. Try again in a minute.')
        return
      }
      setChannel({
        channelName: body.channelName ?? null,
        channelUrl: body.channelUrl,
        visibility: body.visibility ?? null,
        inviteUrl: body.inviteUrl ?? null,
      })
      setAccess(body.access ?? null)
      if (!body.alreadyExisted) setDirection('off')
    } catch {
      setCreateError('Couldn’t reach AllFantasy. Check your connection and try again.')
    } finally {
      setCreating(false)
    }
  }

  async function saveDirection(next: BridgeDirection) {
    if (!channel || next === direction) return
    const previous = direction
    setDirection(next)
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/discord/league', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The surface is explicit: the route defaults to league_chat for older
        // callers, but this screen should never depend on a default.
        body: JSON.stringify({ leagueId: data.leagueId, surface: 'league_chat', ...flagsFromDirection(next) }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setDirection(previous)
      setSaveError('Not saved — try again.')
    } finally {
      setSaving(false)
    }
  }

  const mirroring = direction !== 'off'
  const twoWay = direction === 'both'

  const steps = useMemo(() => {
    const s1 = data.connected ? 'done' : 'current'
    const s2 = serverReady ? 'done' : data.connected ? 'current' : 'todo'
    const s3 = serverReady ? 'done' : data.connected ? 'current' : 'todo'
    const s4 = channel ? 'done' : serverReady ? 'current' : 'todo'
    const s5 = channel ? 'current' : 'todo'
    return [s1, s2, s3, s4, s5] as const
  }, [data.connected, serverReady, channel])

  const serverLabel = data.guildName ? `“${data.guildName}”` : 'your server'

  return (
    <div className="af-dc">
      <header className="af-dc-head">
        <p className="af-dc-eyebrow af-label">League communications</p>
        <h1 className="af-display af-dc-title">Your league’s Discord</h1>
        <p className="af-dc-sub">
          Give {data.leagueName} its own Discord server — your league, your space. What your league
          says in Discord stays in Discord. AllFantasy only posts in the one channel you set up, and
          only when you tell it to.
        </p>
      </header>

      {returnMessage ? (
        <p className="af-dc-flash" data-tone={returnMessage.tone} role={returnMessage.tone === 'good' ? 'status' : 'alert'}>
          {returnMessage.text}
        </p>
      ) : null}

      {!data.botConfigured ? (
        <p className="af-dc-alert" role="alert">
          Discord isn’t switched on for AllFantasy yet, so these steps won’t finish today. Everything
          here will work as soon as it is.
        </p>
      ) : null}

      <div className="af-dc-grid">
        <div className="af-dc-main">
          <section className="af-dc-card" aria-labelledby="dc-steps-h">
            <h2 id="dc-steps-h" className="af-dc-card-title">
              Set it up <span className="af-dc-count">about 2 minutes</span>
            </h2>
            <ol className="af-dc-steps">
              <Step n={1} state={steps[0]} title="Connect your Discord account">
                {data.connected ? (
                  <p className="af-dc-step-text">
                    Connected{data.discordUsername ? <> as <strong>@{data.discordUsername}</strong></> : null}.{' '}
                    <Link href="/settings?tab=connected" className="af-dc-inline-link">
                      Manage
                    </Link>
                  </p>
                ) : (
                  <>
                    <p className="af-dc-step-text">
                      So Discord knows the server is yours. We only get your name and picture — never
                      your messages or DMs.
                    </p>
                    <div className="af-dc-step-actions">
                      <a className="af-btn af-dc-btn" href="/api/auth/discord" target="_blank" rel="noopener">
                        Connect Discord ↗
                      </a>
                    </div>
                    <p className="af-dc-hint">It opens in a new tab. Come back here when you’re done.</p>
                  </>
                )}
              </Step>

              <Step n={2} state={steps[1]} title="Make your league’s server">
                {serverReady ? (
                  <p className="af-dc-step-text">Your league has a server: {serverLabel}.</p>
                ) : data.templateUrl ? (
                  <>
                    <p className="af-dc-step-text">
                      One tap opens Discord with a league server already built — #league-chat, #trades,
                      #trash-talk and #announcements. Name it after your league, tap <strong>Create</strong>,
                      then come back here.
                    </p>
                    <div className="af-dc-step-actions">
                      <a className="af-btn af-dc-btn" href={data.templateUrl} target="_blank" rel="noopener noreferrer">
                        Create the server in Discord ↗
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <ol className="af-dc-mini">
                      <li>
                        Open Discord and tap the <strong>+</strong> (Add a Server) on the left.
                      </li>
                      <li>
                        Choose <strong>Create My Own</strong>, then <strong>For me and my friends</strong>.
                      </li>
                      <li>
                        Name it after your league and tap <strong>Create</strong>. Then come back here.
                      </li>
                    </ol>
                    <div className="af-dc-step-actions">
                      <a
                        className="af-btn af-dc-btn af-dc-btn--ghost"
                        href="https://discord.com/channels/@me"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Discord ↗
                      </a>
                    </div>
                  </>
                )}
                {!serverReady ? (
                  <p className="af-dc-hint">Already run a server for your league? Skip to step 3.</p>
                ) : null}
              </Step>

              <Step n={3} state={steps[2]} title="Add AllFantasy to the server">
                {serverReady ? (
                  <p className="af-dc-step-text">
                    AllFantasy is in {serverLabel}.{' '}
                    {data.installUrl ? (
                      <a href={data.installUrl} className="af-dc-inline-link">
                        Use a different server
                      </a>
                    ) : null}
                  </p>
                ) : (
                  <>
                    <p className="af-dc-step-text">
                      Discord will ask which server — pick the one you just made, keep the boxes ticked,
                      and tap <strong>Authorize</strong>. You’ll land back here.
                    </p>
                    <div className="af-dc-step-actions">
                      {data.connected && data.botConfigured && data.installUrl ? (
                        <a className="af-btn af-dc-btn" href={data.installUrl}>
                          Add AllFantasy to my server
                        </a>
                      ) : (
                        <button type="button" className="af-btn af-dc-btn" disabled>
                          Add AllFantasy to my server
                        </button>
                      )}
                    </div>
                    {!data.connected ? <p className="af-dc-hint">Finish step 1 first.</p> : null}
                  </>
                )}
              </Step>

              <Step n={4} state={steps[3]} title="Make the league channel">
                {channel ? (
                  <>
                    <p className="af-dc-step-text">
                      <a className="af-dc-chan" href={channel.channelUrl} target="_blank" rel="noopener noreferrer">
                        #{channel.channelName ?? 'league-channel'} ↗
                      </a>{' '}
                      is your league’s AllFantasy channel.
                    </p>
                    {channel.visibility === 'private' ? (
                      <p className="af-dc-badge" data-kind="private">
                        Members only — people you let in, plus the server’s owner and admins.
                      </p>
                    ) : channel.visibility === 'server' ? (
                      <p className="af-dc-badge" data-kind="server">
                        Everyone in the server can see this channel.
                      </p>
                    ) : channel.visibility === 'gone' ? (
                      <p className="af-dc-badge" data-kind="warn">
                        This channel was deleted in Discord. Make a new one below.
                      </p>
                    ) : null}
                    {access ? <AccessNote access={access} /> : null}
                  </>
                ) : null}
                {!channel || channel.visibility === 'gone' ? (
                  <>
                    <fieldset className="af-dc-choice" disabled={!serverReady || creating}>
                      <legend className="af-dc-step-text">Who should see it?</legend>
                      <label className="af-dc-option">
                        <input
                          type="radio"
                          name="dc-visibility"
                          value="server"
                          checked={visibilityChoice === 'server'}
                          onChange={() => setVisibilityChoice('server')}
                        />
                        <span>
                          <strong>Everyone in the server</strong>
                          <span className="af-dc-option-sub">
                            Best when the server is just for your league. Anyone who joins can jump in.
                          </span>
                        </span>
                      </label>
                      <label className="af-dc-option">
                        <input
                          type="radio"
                          name="dc-visibility"
                          value="private"
                          checked={visibilityChoice === 'private'}
                          onChange={() => setVisibilityChoice('private')}
                        />
                        <span>
                          <strong>Only league members</strong>
                          <span className="af-dc-option-sub">
                            Best for a server with other people in it. Lets in league members who have
                            linked Discord and are already in the server ({linkedCount} of{' '}
                            {data.members.length} have linked). Anyone who joins later, you add in
                            Discord.
                          </span>
                        </span>
                      </label>
                    </fieldset>
                    <div className="af-dc-step-actions">
                      <button
                        type="button"
                        className="af-btn af-dc-btn"
                        disabled={!serverReady || !data.botConfigured || creating}
                        onClick={() => void createChannel()}
                      >
                        {creating ? 'Making it…' : 'Make the channel'}
                      </button>
                    </div>
                    {!serverReady ? <p className="af-dc-hint">Finish step 3 first.</p> : null}
                    {createError ? (
                      <p className="af-dc-error" role="alert">
                        {createError}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {missingPermissions && missingPermissions.length > 0 ? (
                  <p className="af-dc-error" role="alert">
                    This server never gave AllFantasy: {missingPermissions.join(', ')}.{' '}
                    {data.installUrl ? (
                      <a href={data.installUrl} className="af-dc-inline-link">
                        Add AllFantasy again
                      </a>
                    ) : null}{' '}
                    and keep every box ticked.
                  </p>
                ) : null}
              </Step>

              <Step n={5} state={steps[4]} title="Invite your league">
                {channel?.inviteUrl ? (
                  <>
                    <p className="af-dc-step-text">Send this link to your league. It never expires.</p>
                    <div className="af-dc-invite">
                      <code className="af-dc-invite-url">{channel.inviteUrl}</code>
                      <CopyButton text={channel.inviteUrl} />
                    </div>
                    <p className="af-dc-hint">
                      Members also get a “Join our Discord” button in league chat.
                      {channel.visibility === 'private'
                        ? ' Anyone who joins after today won’t see the members-only channel until you add them in Discord: right-click the channel → Edit Channel → Permissions → Add members.'
                        : null}
                    </p>
                  </>
                ) : channel ? (
                  <p className="af-dc-step-text">
                    Members get a “Join our Discord” button in league chat. If it doesn’t show up, open
                    the channel in Discord and use <strong>Invite People</strong>.
                  </p>
                ) : (
                  <p className="af-dc-step-text">Once the channel exists, you’ll get a link to share here.</p>
                )}
              </Step>
            </ol>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-copy-h">
            <h2 id="dc-copy-h" className="af-dc-card-title">
              League chat and Discord
            </h2>
            <div className="af-dc-setting">
              <div>
                <p className="af-dc-setting-t">Copy AllFantasy league chat into Discord</p>
                <p className="af-dc-setting-b">
                  {mirroring
                    ? `On. New league chat messages also show up in #${channel?.channelName ?? 'your league channel'}, with the sender’s AllFantasy name.`
                    : 'Off. League chat stays in AllFantasy.'}
                </p>
              </div>
              <Switch
                label="Copy AllFantasy league chat into Discord"
                checked={mirroring}
                disabled={!channel || channel.visibility === 'gone' || saving}
                onChange={(on) => void saveDirection(on ? (twoWay ? 'both' : 'post-only') : 'off')}
              />
            </div>
            <div className="af-dc-setting">
              <div>
                <p className="af-dc-setting-t">Bring Discord messages into AllFantasy</p>
                <p className="af-dc-setting-b">
                  {inboundAvailable
                    ? twoWay
                      ? 'On. Messages in your league channel show up in AllFantasy league chat, marked “From Discord”.'
                      : 'Off. What’s said in Discord stays in Discord.'
                    : 'Off, and not available yet. What’s said in Discord stays in Discord.'}
                </p>
              </div>
              <Switch
                label="Bring Discord messages into AllFantasy"
                checked={inboundAvailable && twoWay}
                disabled={!inboundAvailable || !channel || !mirroring || saving}
                onChange={(on) => void saveDirection(on ? 'both' : 'post-only')}
              />
            </div>
            {saveError ? (
              <p className="af-dc-error" role="alert">
                {saveError}
              </p>
            ) : null}
            {!channel ? <p className="af-dc-hint">These switch on once your league channel exists (step 4).</p> : null}
            <p className="af-dc-note">
              Only league chat can be copied for now. Trades, draft picks and commissioner notes stay in
              AllFantasy.
            </p>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-who-h">
            <h2 id="dc-who-h" className="af-dc-card-title">
              Who’s linked Discord{' '}
              <span className="af-dc-count">
                {linkedCount} of {data.members.length}
              </span>
            </h2>
            {data.members.length ? (
              <ul className="af-dc-members">
                {data.members.map((m) => (
                  <li key={`${m.teamName}-${m.ownerName}`} className="af-dc-member">
                    <span className="af-dc-member-team">{m.teamName}</span>
                    <span className="af-dc-member-owner">{m.ownerName}</span>
                    {m.linked ? (
                      <span className="af-dc-linked">@{m.discordUsername}</span>
                    ) : (
                      <span className="af-dc-unlinked">Not linked</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="af-dc-empty">No teams on this league yet.</p>
            )}
            <p className="af-dc-note">
              Nobody has to link Discord to join the server. Linking only matters for a members-only
              channel — it’s how AllFantasy knows who to let in. Members link it in Settings → Connected
              accounts.
            </p>
          </section>
        </div>

        <aside className="af-dc-side">
          <section className="af-dc-card af-dc-card--privacy" aria-labelledby="dc-privacy-h">
            <h2 id="dc-privacy-h" className="af-dc-card-title">
              What AllFantasy can and can’t see
            </h2>
            <ul className="af-dc-privacy">
              <li>
                <strong>Your server is yours.</strong> You own it, you run it, and chats there stay in
                Discord.
              </li>
              <li>
                <strong>We don’t read your Discord chats.</strong>{' '}
                {inboundAvailable
                  ? 'The one exception: if you switch on “Bring Discord messages into AllFantasy”, we read your league channel — only that one.'
                  : 'Not your league channel, not your other channels.'}
              </li>
              <li>
                <strong>League chat only goes to Discord if you switch it on.</strong> It starts off.
              </li>
              <li>
                <strong>Private stuff never goes.</strong> DMs, Chimmy chats and private rooms stay in
                AllFantasy.
              </li>
              <li>
                <strong>The bot can see what Discord lets it see.</strong> It sits in your server so it
                can make the league channel and post there. Want it out of a channel for good? In
                Discord, open that channel’s settings → Permissions and take AllFantasy off.
              </li>
              <li>
                <strong>Discord’s rules apply in your server.</strong> Server owners and admins can read
                every channel, including members-only ones.
              </li>
            </ul>

            <p className="af-dc-scope-h">What the AllFantasy bot does</p>
            <ul className="af-dc-scopes">
              {BRIDGE_SCOPES_REQUESTED.map((s) => (
                <li key={s} className="af-dc-scope af-dc-scope--yes">
                  {s}
                </li>
              ))}
            </ul>
            <p className="af-dc-scope-h">What it never does</p>
            <ul className="af-dc-scopes">
              {BRIDGE_SCOPES_REFUSED.map((s) => (
                <li key={s} className="af-dc-scope af-dc-scope--no">
                  {s}
                </li>
              ))}
            </ul>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-wrong-h">
            <h2 id="dc-wrong-h" className="af-dc-card-title">
              If something goes wrong
            </h2>
            <dl className="af-dc-faq">
              <dt>“You don’t run that server”</dt>
              <dd>
                You need to own the server, or have Manage Server in it. Easiest fix: make a fresh one
                for your league in step 2.
              </dd>
              <dt>Messages aren’t showing up in Discord</dt>
              <dd>
                Check the copy switch is on. Then in Discord, make sure AllFantasy can View Channel and
                Send Messages in your league channel.
              </dd>
              <dt>A busy night — draft, deadline day</dt>
              <dd>
                Discord slows down apps that post a lot at once. We try each message once more; if
                Discord still says no, that message stays in AllFantasy only. Nothing is lost here.
              </dd>
              <dt>The server was deleted, or AllFantasy removed</dt>
              <dd>
                Copying stops. Nothing in AllFantasy is lost — do steps 3 and 4 again.
              </dd>
            </dl>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-never-h">
            <h2 id="dc-never-h" className="af-dc-card-title">
              What doesn’t copy over
            </h2>
            <ul className="af-dc-never">
              <li>
                <strong>Edits and deletes.</strong> Editing or deleting a message here doesn’t change the
                copy in Discord.
              </li>
              <li>
                <strong>Photos and files.</strong> The words and GIFs copy; uploads stay in AllFantasy.
              </li>
              <li>
                <strong>Direct messages.</strong> Never. That’s a privacy line, not a missing feature.
              </li>
              <li>
                <strong>Voice.</strong> Nothing in a voice channel is heard or kept.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function AccessNote({ access }: { access: AccessReport }) {
  const left = [...access.notInServer, ...access.notLinked, ...access.unknown]
  return (
    <div className="af-dc-access">
      <p className="af-dc-step-text">
        {access.included.length ? (
          <>
            Let in: <strong>{access.included.join(', ')}</strong>.
          </>
        ) : (
          'Only you (and the server’s owner and admins) can see it so far.'
        )}
      </p>
      {left.length ? (
        <p className="af-dc-hint">
          {access.notInServer.length ? <>Not in the server yet: {access.notInServer.join(', ')}. </> : null}
          {access.notLinked.length ? <>Haven’t linked Discord: {access.notLinked.join(', ')}. </> : null}
          {access.unknown.length ? <>Couldn’t check: {access.unknown.join(', ')}. </> : null}
          Add them in Discord once they’ve joined: right-click the channel → Edit Channel → Permissions →
          Add members.
        </p>
      ) : null}
    </div>
  )
}

export default DiscordBridge
