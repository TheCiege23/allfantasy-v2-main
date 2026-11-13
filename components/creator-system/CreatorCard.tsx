'use client'

import Link from 'next/link'
import { ArrowUpRight, Share2, Trophy, Users } from 'lucide-react'
import { VerifiedCreatorBadge } from '@/components/creator/VerifiedCreatorBadge'
import type { CreatorProfileDto } from '@/lib/creator-system/types'

interface CreatorCardProps {
  creator: CreatorProfileDto
  onFollow?: (creator: CreatorProfileDto) => void
  onUnfollow?: (creator: CreatorProfileDto) => void
  onShare?: (creator: CreatorProfileDto, url: string) => void
  isFollowing?: boolean
  followLoading?: boolean
}

export function CreatorCard({
  creator,
  onFollow,
  onUnfollow,
  onShare,
  isFollowing,
  followLoading,
}: CreatorCardProps) {
  const displayName = creator.displayName || creator.handle
  const profileHref = `/creators/${encodeURIComponent(creator.slug)}`
  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${profileHref}` : profileHref
  const featuredLeague = creator.featuredLeague
  const primaryColor = creator.branding?.primaryColor || 'var(--accent)'
  const accentColor = creator.branding?.accentColor || 'var(--panel2)'

  const handleShare = () => {
    if (onShare) {
      onShare(creator, shareUrl)
      return
    }
    navigator.clipboard?.writeText(shareUrl).catch(() => {})
  }

  const handleFollowClick = () => {
    if (isFollowing) onUnfollow?.(creator)
    else onFollow?.(creator)
  }

  return (
    <article
      data-testid={`creator-profile-card-${creator.slug}`}
      className="overflow-hidden rounded-[28px] border shadow-sm"
      style={{
        borderColor: 'var(--border)',
        background: `linear-gradient(135deg, color-mix(in srgb, ${primaryColor} 16%, var(--panel)) 0%, color-mix(in srgb, ${accentColor} 14%, var(--panel)) 100%)`,
      }}
    >
      <div className="border-b px-5 py-4" style={{ borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)' }}>
        <div className="flex items-start gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--panel2) 75%, transparent)' }}
          >
            {creator.avatarUrl ? (
              <img src={creator.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg font-bold" style={{ color: 'var(--text)' }}>
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={profileHref}
                data-testid={`creator-profile-link-${creator.slug}`}
                className="truncate text-lg font-semibold hover:opacity-90"
                style={{ color: 'var(--text)' }}
              >
                {displayName}
              </Link>
              {creator.isVerified && (
                <VerifiedCreatorBadge
                  handle={creator.handle}
                  badge={creator.verificationBadge}
                  showLabel={false}
                  linkToProfile={false}
                  size="sm"
                />
              )}
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              @{creator.handle}
              {creator.creatorType ? ` • ${creator.creatorType}` : ''}
            </p>
            {creator.branding?.tagline && (
              <p className="mt-2 text-sm font-medium" style={{ color: 'var(--text)' }}>
                {creator.branding.tagline}
              </p>
            )}
            {creator.bio && (
              <p className="mt-2 line-clamp-3 text-sm" style={{ color: 'var(--muted)' }}>
                {creator.bio}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            <Trophy className="h-3.5 w-3.5" />
            {creator.leagueCount ?? 0} leagues
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            <Users className="h-3.5 w-3.5" />
            {creator.followerCount ?? 0} followers
          </span>
          {creator.totalLeagueMembers !== undefined && (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              {creator.totalLeagueMembers} community members
            </span>
          )}
          {creator.topSports?.length ? (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              {creator.topSports.join(' / ')}
            </span>
          ) : null}
        </div>

        {featuredLeague && (
          <div
            className="rounded-2xl border p-3"
            style={{
              borderColor: 'var(--border)',
              background: 'color-mix(in srgb, var(--panel) 70%, transparent)',
            }}
          >
            <p className="text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--muted)' }}>
              Featured League
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  {featuredLeague.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  {featuredLeague.sport}
                  {featuredLeague.leagueTier ? ` | Tier ${featuredLeague.leagueTier}` : ''}
                </p>
              </div>
              {featuredLeague.canJoinByRanking !== false ? (
                <Link
                  href={featuredLeague.inviteUrl}
                  data-testid={`creator-join-league-link-${creator.slug}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold"
                  style={{ background: primaryColor, color: 'white' }}
                >
                  Join league
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span
                  className="inline-flex shrink-0 items-center rounded-xl border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  Invite required
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(onFollow || onUnfollow) && (
            <button
              type="button"
              disabled={followLoading}
              onClick={handleFollowClick}
              data-testid={`creator-follow-button-${creator.slug}`}
              className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              style={{
                background: isFollowing ? 'var(--panel2)' : primaryColor,
                color: isFollowing ? 'var(--text)' : 'white',
                border: '1px solid var(--border)',
              }}
            >
              {followLoading ? 'Saving...' : isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
          <button
            type="button"
            onClick={handleShare}
            data-testid={`creator-share-button-${creator.slug}`}
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Share2 className="h-4 w-4" />
            Share profile
          </button>
        </div>
      </div>
    </article>
  )
}
