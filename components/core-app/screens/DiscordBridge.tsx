'use client'

import Link from 'next/link'
import { useState } from 'react'
import '@/components/core-app/af-discord.css'
import {
  BRIDGE_SCOPES_REFUSED,
  BRIDGE_SCOPES_REQUESTED,
  flagsFromDirection,
  type BridgeDirection,
  type BridgeMapping,
  type DiscordBridgeData,
} from '@/lib/core-app/discordBridge'

/**
 * 32a — the Discord bridge.
 *
 * ⚠ THE "APP" TAG IS A DISCORD PLATFORM REQUIREMENT, NOT A STYLING CHOICE.
 * Messages relayed to Discord go through a webhook under the sender's name and
 * avatar, and Discord marks every webhook message APP. That tag exists to stop
 * bridges impersonating real users. Never hide, restyle away, or "clean up" the
 * tag in the preview or in the relay.
 *
 * ⚠ COMMISSIONER-ONLY MAPPINGS DEFAULT TO OFF. The rationale is printed in the
 * UI, not just in a comment: a private note that appears in a public Discord
 * channel is the kind of mistake you only make once.
 *
 * ⚠ EDITS AND DELETES DO NOT SYNC, AND THE UI MUST SAY SO AT THE MOMENT IT
 * MATTERS. Deleting a message in AllFantasy leaves the Discord copy standing.
 * The "what doesn't bridge" panel states it; anywhere the product offers a
 * delete on a bridged message it must warn too, or the user believes a removal
 * succeeded on both sides when it did not.
 *
 * ⚠ DMs NEVER BRIDGE. That is a privacy boundary, stated as one — not listed as
 * a missing feature that someone might later "complete".
 *
 * ⚠ THREE SURFACES ARE NOT WIRED YET AND THE SCREEN ADMITS IT. The `surface`
 * column that would let a league map more than one channel is authored as
 * migration 20260823120000_discord_bridge_surfaces but NOT APPLIED — the only
 * database this repo's .env.local points at is production. Those rows render as
 * "needs a migration" rather than as a working control that silently no-ops.
 */

export type DiscordBridgeProps = {
  data: DiscordBridgeData
}

const DIRECTIONS: Array<{ id: BridgeDirection; label: string; hint: string }> = [
  { id: 'both', label: 'Both ways', hint: 'Relayed in and out' },
  { id: 'post-only', label: 'Post only', hint: 'AllFantasy → Discord' },
  { id: 'off', label: 'Off', hint: 'Nothing relays' },
]

function DirectionPicker({
  mapping,
  leagueId,
}: {
  mapping: BridgeMapping
  leagueId: string
}) {
  const [direction, setDirection] = useState<BridgeDirection>(mapping.direction)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disabled = !mapping.available || !mapping.mapped

  async function choose(next: BridgeDirection) {
    if (disabled || next === direction) return
    const previous = direction
    setDirection(next)
    setSaving(true)
    setError(null)
    try {
      /*
       * The existing PATCH at /api/discord/league takes the three booleans.
       * No new route: the repo sits at Vercel's hard 2048-route ceiling and a
       * second endpoint for the same table would be pure spend.
       */
      const res = await fetch('/api/discord/league', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, ...flagsFromDirection(next) }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      // Revert rather than leave the control showing a state the server rejected.
      setDirection(previous)
      setError('Not saved — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="af-dc-dir">
      <div className="af-dc-dir-set" role="group" aria-label={`Direction for ${mapping.surface.label}`}>
        {DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="af-dc-dir-btn"
            aria-pressed={direction === d.id}
            disabled={disabled || saving}
            title={d.hint}
            onClick={() => choose(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      {error ? (
        <span className="af-dc-dir-err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function MappingTable({ data }: { data: DiscordBridgeData }) {
  return (
    <div className="af-dc-table-wrap">
      <table className="af-dc-table">
        <thead>
          <tr>
            <th scope="col">AllFantasy surface</th>
            <th scope="col">Discord channel</th>
            <th scope="col">Direction</th>
          </tr>
        </thead>
        <tbody>
          {data.mappings.map((m) => (
            <tr key={m.surface.id} data-off={m.direction === 'off' ? 'true' : undefined}>
              <th scope="row">
                <span className="af-dc-surface">
                  {m.surface.label}
                  {m.surface.commissionerOnly ? <span className="af-dc-pill">Commissioner only</span> : null}
                </span>
                <span className="af-dc-surface-desc">{m.surface.description}</span>
              </th>
              <td>
                {!m.available ? (
                  <span className="af-dc-unavail">
                    Needs a migration — <code>surface</code> column not applied yet
                  </span>
                ) : m.mapped ? (
                  <a className="af-dc-chan" href={m.channelUrl ?? '#'} target="_blank" rel="noreferrer">
                    #{m.channelName ?? 'channel'} ↗
                  </a>
                ) : (
                  <span className="af-dc-unmapped">Not mapped</span>
                )}
              </td>
              <td>
                <DirectionPicker mapping={m} leagueId={data.leagueId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="af-dc-foot">
        Commissioner-only channels default to <strong>Off</strong>. A private note that appears in a
        public Discord channel is the kind of mistake you only make once.
      </p>
    </div>
  )
}

/* ── The side-by-side preview ────────────────────────────────────────────── */

function Preview({ leagueName }: { leagueName: string }) {
  return (
    <div className="af-dc-preview">
      <div className="af-dc-pane">
        <div className="af-dc-pane-head">AllFantasy · {leagueName}</div>
        <div className="af-dc-msg">
          <span className="af-dc-av" aria-hidden="true">
            M
          </span>
          <div>
            <div className="af-dc-msg-head">
              <span className="af-dc-name">Marcus</span>
              <span className="af-dc-time">10:42</span>
            </div>
            <p className="af-dc-body">Anyone moving a RB before the deadline?</p>
          </div>
        </div>
        <div className="af-dc-msg">
          <span className="af-dc-av af-dc-av--d" aria-hidden="true">
            P
          </span>
          <div>
            <div className="af-dc-msg-head">
              <span className="af-dc-name">Priya</span>
              {/* Relayed IN from Discord — tagged so nobody misreads where it came from. */}
              <span className="af-dc-tag af-dc-tag--from">From Discord</span>
              <span className="af-dc-time">10:43</span>
            </div>
            <p className="af-dc-body">I&apos;ll listen on Achane.</p>
          </div>
        </div>
      </div>

      <div className="af-dc-pane af-dc-pane--discord">
        <div className="af-dc-pane-head af-dc-pane-head--discord"># {leagueName.toLowerCase().replace(/\s+/g, '-')}</div>
        <div className="af-dc-msg">
          <span className="af-dc-av" aria-hidden="true">
            M
          </span>
          <div>
            <div className="af-dc-msg-head">
              <span className="af-dc-name">Marcus</span>
              {/*
                ⚠ REQUIRED BY DISCORD. Webhook messages are always marked APP.
                It is how Discord prevents a bridge impersonating a real member.
              */}
              <span className="af-dc-tag af-dc-tag--app">APP</span>
              <span className="af-dc-time">10:42</span>
            </div>
            <p className="af-dc-body">Anyone moving a RB before the deadline?</p>
          </div>
        </div>
        <div className="af-dc-msg">
          <span className="af-dc-av af-dc-av--d" aria-hidden="true">
            P
          </span>
          <div>
            <div className="af-dc-msg-head">
              <span className="af-dc-name">priya</span>
              <span className="af-dc-time">10:43</span>
            </div>
            <p className="af-dc-body">I&apos;ll listen on Achane.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── The screen ──────────────────────────────────────────────────────────── */

export function DiscordBridge({ data }: DiscordBridgeProps) {
  const linked = data.members.filter((m) => m.linked).length

  return (
    <div className="af-dc">
      <header className="af-dc-head">
        <p className="af-dc-eyebrow af-label">League communications</p>
        <h1 className="af-display af-dc-title">Discord bridge</h1>
        <p className="af-dc-sub">
          Relay {data.leagueName}&apos;s chat to a Discord server and back. Messages you send here
          post under your own name and avatar; messages from Discord arrive tagged so nobody has to
          guess where a line came from.
        </p>
      </header>

      {!data.botConfigured ? (
        <p className="af-dc-alert" role="alert">
          The Discord bot is not configured in this environment (<code>DISCORD_BOT_TOKEN</code> is
          unset), so nothing can relay yet. Everything below reflects your real settings and will
          start working the moment the token is set.
        </p>
      ) : null}

      <div className="af-dc-grid">
        <div className="af-dc-main">
          <section className="af-dc-card" aria-labelledby="dc-preview-h">
            <h2 id="dc-preview-h" className="af-dc-card-title">
              What it looks like on both sides
            </h2>
            <Preview leagueName={data.leagueName} />
            <p className="af-dc-note">
              The <strong>APP</strong> tag on relayed messages is Discord&apos;s, not ours — it is
              how the platform stops a bridge pretending to be a person. It cannot be turned off,
              and we would not want it to be.
            </p>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-map-h">
            <h2 id="dc-map-h" className="af-dc-card-title">
              Channel mapping
            </h2>
            {data.surfacesPending ? (
              <p className="af-dc-pending">
                Only <strong>league chat</strong> can be mapped right now. Mapping the other three
                surfaces needs a database column that is written but not yet applied — see{' '}
                <code>prisma/migrations/20260823120000_discord_bridge_surfaces</code>. They are shown
                here so the shape is visible, with their controls disabled rather than pretending to
                work.
              </p>
            ) : null}
            <MappingTable data={data} />
          </section>

          <section className="af-dc-card" aria-labelledby="dc-who-h">
            <h2 id="dc-who-h" className="af-dc-card-title">
              Who&apos;s linked{' '}
              <span className="af-dc-count">
                {linked} of {data.members.length}
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
                      <span className="af-dc-unlinked">Relays under their plain name</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="af-dc-empty">No teams on this league yet.</p>
            )}
            <p className="af-dc-note">
              An unlinked manager still sees everything. Their messages just relay under their
              AllFantasy name instead of their Discord identity — a supported state, not a broken
              one.
            </p>
          </section>
        </div>

        <aside className="af-dc-side">
          <section className="af-dc-card" aria-labelledby="dc-connect-h">
            <h2 id="dc-connect-h" className="af-dc-card-title">
              {data.connected ? 'Connected' : 'Connect Discord'}
            </h2>
            {data.connected ? (
              <p className="af-dc-connected">
                Your Discord account is connected
                {data.guildName ? (
                  <>
                    {' '}
                    and this league posts to <strong>{data.guildName}</strong>
                  </>
                ) : null}
                .
              </p>
            ) : (
              <p className="af-dc-note">
                Connecting links your Discord identity so your relayed messages carry your name and
                avatar. It does not give us your DMs.
              </p>
            )}

            {/*
              The bot's server-side install grant, separate from the account
              connection above. A server that added the bot before its
              permission scope widened still holds the narrower grant — Discord
              never upgrades one retroactively — and the bridge silently fails
              in exactly the channels that need the missing permission. Only
              shown once there is an install to check (`guildId` set); `null`
              from a checked install means Discord could not be reached and is
              rendered as unknown, never as "fine".
            */}
            {data.guildId && data.missingPermissions === null ? (
              <p className="af-dc-perm af-dc-perm--unknown" role="status">
                Could not verify the bot&apos;s permissions in {data.guildName ?? 'your server'} just
                now. This does not mean anything is wrong — try again shortly.
              </p>
            ) : data.guildId && data.missingPermissions && data.missingPermissions.length > 0 ? (
              <div className="af-dc-perm af-dc-perm--warn" role="alert">
                <p className="af-dc-perm-head">
                  The bot&apos;s install in {data.guildName ?? 'your server'} is missing permissions
                </p>
                <ul className="af-dc-perm-list">
                  {data.missingPermissions.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
                <p className="af-dc-perm-fix">
                  Discord grants permissions at install time only — re-running the install link below
                  fixes it without removing the bot first.
                </p>
              </div>
            ) : data.guildId && data.missingPermissions && data.missingPermissions.length === 0 ? (
              <p className="af-dc-perm af-dc-perm--ok">
                The bot&apos;s permissions in {data.guildName ?? 'your server'} are current.
              </p>
            ) : null}

            <p className="af-dc-scope-h">What we ask for</p>
            <ul className="af-dc-scopes">
              {BRIDGE_SCOPES_REQUESTED.map((s) => (
                <li key={s} className="af-dc-scope af-dc-scope--yes">
                  {s}
                </li>
              ))}
            </ul>
            <p className="af-dc-scope-h">What we never ask for</p>
            <ul className="af-dc-scopes">
              {BRIDGE_SCOPES_REFUSED.map((s) => (
                <li key={s} className="af-dc-scope af-dc-scope--no">
                  {s}
                </li>
              ))}
            </ul>

            <div className="af-dc-actions">
              {data.connected ? (
                <>
                  {data.installUrl ? (
                    <a className="af-btn af-dc-btn" href={data.installUrl} target="_blank" rel="noreferrer">
                      Add the bot to a server ↗
                    </a>
                  ) : null}
                  <Link className="af-btn af-dc-btn af-dc-btn--ghost" href="/settings">
                    Manage connection
                  </Link>
                </>
              ) : (
                <a className="af-btn af-dc-btn" href="/api/auth/discord">
                  Connect Discord
                </a>
              )}
            </div>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-wrong-h">
            <h2 id="dc-wrong-h" className="af-dc-card-title">
              When it goes wrong
            </h2>
            <dl className="af-dc-faq">
              <dt>The bot can&apos;t post</dt>
              <dd>
                Almost always channel permissions. The bot needs View Channel, Send Messages and
                Manage Webhooks on each mapped channel — server-wide roles do not override a channel
                override.
              </dd>
              <dt>Draft night floods it</dt>
              <dd>
                Discord rate-limits bursts. Relayed messages queue and send in their original order.
                They are never dropped and never reordered — a pick that posts late still posts in
                the right place.
              </dd>
              <dt>The server was deleted, or the bot removed</dt>
              <dd>
                Relaying stops and the mapping goes stale. Nothing in AllFantasy is lost; re-add the
                bot and map the channel again.
              </dd>
            </dl>
          </section>

          <section className="af-dc-card" aria-labelledby="dc-never-h">
            <h2 id="dc-never-h" className="af-dc-card-title">
              What doesn&apos;t bridge
            </h2>
            <ul className="af-dc-never">
              <li>
                <strong>Edits and deletes.</strong> Editing or deleting here does not change the
                Discord copy. If you delete a bridged message, the one in Discord stays — we will
                tell you so at the time rather than let you believe it went.
              </li>
              <li>
                <strong>Direct messages.</strong> Never. That is a privacy boundary, not a feature
                we have not got to.
              </li>
              <li>
                <strong>Oversized attachments.</strong> Discord&apos;s upload limit applies; a file
                over it relays as a link instead.
              </li>
              <li>
                <strong>Voice.</strong> Nothing in a voice channel is read or relayed.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default DiscordBridge
