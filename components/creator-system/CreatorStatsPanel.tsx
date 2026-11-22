'use client'

import { Activity, Eye, Share2, Trophy, Users } from 'lucide-react'

interface CreatorStatsPanelProps {
  followerCount?: number
  leagueCount?: number
  profileViews?: number
  inviteShares?: number
  leagueJoins?: number
  leagueMembers?: number
  conversionRate?: number
  topShareChannel?: string | null
  period?: string
}

export function CreatorStatsPanel({
  followerCount = 0,
  leagueCount = 0,
  profileViews = 0,
  inviteShares = 0,
  leagueJoins = 0,
  leagueMembers = 0,
  conversionRate = 0,
  topShareChannel = null,
  period = '30d',
}: CreatorStatsPanelProps) {
  const stats = [
    { label: 'Followers', value: followerCount, icon: Users },
    { label: 'Creator leagues', value: leagueCount, icon: Trophy },
    { label: 'Profile views', value: profileViews, icon: Eye },
    { label: 'Invite shares', value: inviteShares, icon: Share2 },
    { label: 'League joins', value: leagueJoins, icon: Activity },
    { label: 'Community members', value: leagueMembers, icon: Users },
  ]

  return (
    <section
      data-testid="creator-analytics-panel"
      className="space-y-4 rounded-[28px] border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 78%, transparent)',
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            Creator analytics
          </h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Safe event totals for the last {period}
          </p>
        </div>
        <div className="text-sm" style={{ color: 'var(--muted)' }}>
          Conversion rate: <span style={{ color: 'var(--text)' }}>{(conversionRate * 100).toFixed(1)}%</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-2xl border p-4"
            style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--panel2) 35%, transparent)' }}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                {label}
              </p>
              <Icon className="h-4 w-4" style={{ color: 'var(--muted)' }} />
            </div>
            <p className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl border p-4 text-sm"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        Top share channel:{' '}
        <span style={{ color: 'var(--muted)' }}>{topShareChannel || 'Direct copy'}</span>
      </div>
    </section>
  )
}
