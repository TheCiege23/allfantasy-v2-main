'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import type { SubPanelContext } from './LeagueSettingsSubPanels'

type LeagueStatus = {
  botConfigured: boolean
  discordConnected: boolean
  discordGuildId: string | null
  channel: {
    channelId: string
    channelName: string | null
    guildId: string
    guildName: string | null
    syncEnabled: boolean
    syncOutbound: boolean
    syncInbound: boolean
    channelUrl: string
  } | null
}

export function DiscordLeagueSyncPanel({ ctx }: { ctx: SubPanelContext }) {
  const [status, setStatus] = useState<LeagueStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const leagueId = ctx.league.id

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/discord/league?leagueId=${encodeURIComponent(leagueId)}`, {
        cache: 'no-store',
      })
      const data = (await res.json()) as LeagueStatus
      if (res.ok) setStatus(data)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const linkGuild = async () => {
    const gid = status?.discordGuildId?.trim()
    if (!gid) {
      setMsg('Add the bot to a server first (install flow), then try again.')
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/discord/guilds/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, guildId: gid, guildName: null }),
      })
      if (!res.ok) {
        setMsg('Could not link server.')
        return
      }
      setMsg('Server linked.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const createChannel = async () => {
    const gid = status?.discordGuildId?.trim()
    if (!gid) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/discord/channels/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, guildId: gid }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setMsg(data.error ?? 'Could not create channel.')
        return
      }
      setMsg('Discord channel created.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const patchToggle = async (key: 'syncEnabled' | 'syncOutbound' | 'syncInbound', value: boolean) => {
    setBusy(true)
    try {
      await fetch('/api/discord/league', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, [key]: value }),
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  /** AllFantasy league owner (imported league) — not Sleeper-only `isCommissioner` */
  const isLeagueOwner = ctx.league.userId === ctx.userId
  if (!isLeagueOwner) {
    return <p className="text-[12px] text-white/45">Only the league owner can configure Discord sync.</p>
  }

  if (loading || !status) {
    return <p className="text-[12px] text-white/45">Loading…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DiscordIcon size={18} className="text-[#5865F2]" />
        <p className="text-[13px] font-semibold text-white/90">Discord league chat</p>
      </div>

      {!status.discordConnected ? (
        <p className="text-[12px] text-white/50">
          <Link href="/settings" className="text-[#ff3d81] underline">
            Connect your Discord account
          </Link>{' '}
          in Settings first.
        </p>
      ) : null}

      {status.discordConnected && !status.botConfigured ? (
        <p className="text-[11px] text-amber-300/90">
          Bot features are not enabled on this deployment (missing DISCORD_BOT_TOKEN).
        </p>
      ) : null}

      {status.discordConnected && status.botConfigured ? (
        <a
          href="/api/discord/bot-install"
          className="inline-flex items-center gap-2 rounded-xl bg-[#5865F2]/20 px-3 py-2 text-[11px] font-semibold text-[#93a7ff] hover:bg-[#5865F2]/30"
        >
          <DiscordIcon size={14} />
          Add AllFantasy bot to Discord
        </a>
      ) : null}

      {status.discordConnected && status.discordGuildId ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void linkGuild()}
            className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-[11px] text-white/85 hover:bg-white/[0.06] disabled:opacity-50"
          >
            Link this server to league
          </button>
          <button
            type="button"
            disabled={busy || !status.discordGuildId}
            onClick={() => void createChannel()}
            className="rounded-lg bg-[#ff3d81]/20 px-3 py-1.5 text-[11px] font-semibold text-[#ff9ec0] hover:bg-[#ff3d81]/30 disabled:opacity-50"
          >
            Create Discord channel
          </button>
        </div>
      ) : null}

      {status.channel ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-[11px] text-white/70">
          <p className="mb-2 font-medium text-white/85">
            Channel #{status.channel.channelName ?? 'channel'}{' '}
            {status.channel.guildName ? `in ${status.channel.guildName}` : ''}
          </p>
          <a
            href={status.channel.channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff3d81] underline"
          >
            Open in Discord ↗
          </a>
          <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
            <label className="flex items-center justify-between gap-2">
              <span>Enable Discord sync</span>
              <input
                type="checkbox"
                checked={status.channel.syncEnabled}
                disabled={busy}
                onChange={(e) => void patchToggle('syncEnabled', e.target.checked)}
                className="accent-[#ff3d81]"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>Push league chat to Discord</span>
              <input
                type="checkbox"
                checked={status.channel.syncOutbound}
                disabled={busy || !status.channel.syncEnabled}
                onChange={(e) => void patchToggle('syncOutbound', e.target.checked)}
                className="accent-[#ff3d81]"
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>Pull Discord messages into league chat</span>
              <input
                type="checkbox"
                checked={status.channel.syncInbound}
                disabled={busy || !status.channel.syncEnabled}
                onChange={(e) => void patchToggle('syncInbound', e.target.checked)}
                className="accent-[#ff3d81]"
              />
            </label>
          </div>
        </div>
      ) : null}

      {msg ? <p className="text-[11px] text-white/50">{msg}</p> : null}

      <p className="text-[10px] text-white/35">
        Trade / waiver / Chimmy toggles can reuse the same channel embeds in a future update.
      </p>
    </div>
  )
}
