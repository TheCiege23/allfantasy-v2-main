'use client'

import Link from 'next/link'
import { Lock, Share2, Trophy, Users } from 'lucide-react'
import type { CreatorLeagueDto } from '@/lib/creator-system/types'
import { trackDiscoveryJoinClick } from '@/lib/discovery-analytics/client'

interface CreatorLeagueCardProps {
  league: CreatorLeagueDto
  onShare?: (league: CreatorLeagueDto, url: string) => void
  showJoinButton?: boolean
}

export function CreatorLeagueCard({
  league,
  onShare,
  showJoinButton = true,
}: CreatorLeagueCardProps) {
  const leagueHref = `/creator/leagues/${encodeURIComponent(league.id)}`
  const joinHref = league.inviteUrl || `${leagueHref}?join=${encodeURIComponent(league.inviteCode)}`
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${joinHref}` : joinHref
  const canJoinDirect = league.canJoinByRanking !== false

  const handleShare = () => {
    if (onShare) {
      onShare(league, shareUrl)
      return
    }
    navigator.clipboard?.writeText(shareUrl).catch(() => {})
  }

  return (
    <article
      className="overflow-hidden rounded-[28px] border"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 72%, transparent)',
      }}
    >
      <div
        className="min-h-[140px] px-5 py-5"
        style={{
          background: league.coverImageUrl
            ? `linear-gradient(180deg, rgba(16,16,16,0.12), rgba(16,16,16,0.5)), url(${league.coverImageUrl}) center/cover`
            : 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, var(--panel)) 0%, color-mix(in srgb, var(--panel2) 25%, var(--panel)) 100%)',
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.82)' }}>
          <span className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
            {league.sport}
          </span>
          <span className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
            {league.type}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
            {league.isPublic ? 'Public community' : <><Lock className="h-3.5 w-3.5" /> Invite only</>}
          </span>
        </div>
        <h3 className="mt-4 text-xl font-semibold" style={{ color: 'white' }}>
          {league.name}
        </h3>
        {league.description && (
          <p className="mt-2 max-w-2xl text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {league.description}
          </p>
        )}
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            <Users className="h-3.5 w-3.5" />
            {league.memberCount}
            {league.maxMembers > 0 ? ` / ${league.maxMembers}` : ''} members
          </span>
          {league.leagueTier ? (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              Tier {league.leagueTier}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            <Trophy className="h-3.5 w-3.5" />
            {Math.round(league.fillRate * 100)}% full
          </span>
          {league.joinDeadline && (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              Join by {new Date(league.joinDeadline).toLocaleDateString()}
            </span>
          )}
        </div>

        {league.communitySummary && (
          <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>
              Community
            </p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text)' }}>
              {league.communitySummary}
            </p>
          </div>
        )}

        {(league.latestRecapTitle || league.latestRecapSummary) && (
          <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>
              Latest Recap
            </p>
            {league.latestRecapTitle && (
              <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {league.latestRecapTitle}
              </p>
            )}
            {league.latestRecapSummary && (
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                {league.latestRecapSummary}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link
            href={leagueHref}
            data-testid={`creator-league-view-${league.id}`}
            className="rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            View league
          </Link>
          {showJoinButton && !league.isMember && canJoinDirect && (
            <Link
              href={joinHref}
              data-testid={`creator-league-join-${league.id}`}
              onClick={() =>
                trackDiscoveryJoinClick({
                  leagueId: league.id,
                  source: 'creator',
                  leagueName: league.name,
                  sport: league.sport ?? null,
                  joinUrl: joinHref,
                })
              }
              className="rounded-xl px-4 py-2 text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Join league
            </Link>
          )}
          {showJoinButton && !league.isMember && !canJoinDirect && (
            <span
              className="rounded-xl border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Invite required
            </span>
          )}
          {league.isMember && (
            <span
              className="rounded-xl border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              Joined
            </span>
          )}
          <button
            type="button"
            onClick={handleShare}
            data-testid={`creator-league-share-${league.id}`}
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Share2 className="h-4 w-4" />
            Share invite
          </button>
        </div>
      </div>
    </article>
  )
}
