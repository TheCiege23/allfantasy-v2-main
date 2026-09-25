'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import type { SubPanelContext } from './LeagueSettingsSubPanels'

type LeagueStatus = {
  botConfigured: boolean
  /** Null when we could not reach Discord — unknown, not "fine". */
  missingPermissions: string[] | null
  discordConnected: boolean
  channel: {
    channelName: string | null
    guildName: string | null
    syncEnabled: boolean
    syncOutbound: boolean
    channelUrl: string
  } | null
}

/**
 * League settings → Discord. A status card that sends the commissioner to the one
 * place Discord is set up: `/core/discord?league=<id>`.
 *
 * ⚠ THIS USED TO BE A SECOND, PARTIAL SETUP FLOW, and two of its controls were wrong:
 *   - "Link this server to league" POSTed `/api/discord/guilds/link`, which let any
 *     league owner claim any server id. The install round trip already links the
 *     server after checking the person manages it, so the button was redundant and
 *     the route it used is being locked down separately.
 *   - "Pull Discord messages into league chat" was a switch nothing ever acted on —
 *     nothing schedules the Discord → AllFantasy poll. `/core/discord` shows that as
 *     "not available yet" instead.
 * One guided screen, with honest privacy copy, beats two that disagree.
 */
export function DiscordLeagueSyncPanel({ ctx }: { ctx: SubPanelContext }) {
  const [status, setStatus] = useState<LeagueStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const leagueId = ctx.league.id
  const setupHref = `/core/discord?league=${encodeURIComponent(leagueId)}`

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/discord/league?leagueId=${encodeURIComponent(leagueId)}`, {
        cache: 'no-store',
      })
      if (res.ok) setStatus((await res.json()) as LeagueStatus)
    } catch {
      /* the card still offers the setup link */
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** AllFantasy league owner (imported league) — not Sleeper-only `isCommissioner` */
  const isLeagueOwner = ctx.league.userId === ctx.userId
  if (!isLeagueOwner) {
    return <p className="text-[12px] text-white/45">Only the league owner can set up Discord.</p>
  }

  if (loading) {
    return <p className="text-[12px] text-white/45">Loading…</p>
  }

  const channel = status?.channel ?? null
  const copying = Boolean(channel?.syncEnabled && channel.syncOutbound)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DiscordIcon size={18} className="text-[#5865F2]" />
        <p className="text-[13px] font-semibold text-white/90">Your league’s Discord</p>
      </div>

      {channel ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[11px] text-white/70">
          <p className="mb-1 font-medium text-white/85">
            #{channel.channelName ?? 'league-channel'} {channel.guildName ? `in ${channel.guildName}` : ''}
          </p>
          <p className="mb-2 text-white/55">
            {copying ? 'League chat is being copied into this channel.' : 'League chat copying is off.'}
          </p>
          <a href={channel.channelUrl} target="_blank" rel="noopener noreferrer" className="text-[#ff3d81] underline">
            Open in Discord ↗
          </a>
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed text-white/55">
          Give your league its own Discord server — your league, your space. Chats there stay in
          Discord, and AllFantasy only posts in the channel you set up when you switch it on.
        </p>
      )}

      {channel && status?.missingPermissions && status.missingPermissions.length > 0 ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-3 text-[11px]">
          <p className="font-semibold text-amber-200">Discord is missing permissions</p>
          <p className="mt-1 text-amber-100/75">
            This server never gave AllFantasy{' '}
            <strong className="text-amber-100">{status.missingPermissions.join(', ')}</strong>. Add
            AllFantasy to the server again and keep every box ticked.
          </p>
          <a
            href={`/api/discord/bot-install?leagueId=${encodeURIComponent(leagueId)}`}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-400/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-400/30"
          >
            <DiscordIcon size={14} />
            Add AllFantasy again
          </a>
        </div>
      ) : null}

      <Link
        href={setupHref}
        className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2]/20 px-3 py-2 text-[11px] font-semibold text-[#93a7ff] hover:bg-[#5865F2]/30"
      >
        <DiscordIcon size={14} />
        {channel ? 'Manage Discord →' : 'Set up Discord →'}
      </Link>
    </div>
  )
}
