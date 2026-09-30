'use client'

import { Globe, Share2, Users } from 'lucide-react'
import { VerifiedCreatorBadge } from '@/components/creator/VerifiedCreatorBadge'
import type { CreatorProfileDto } from '@/lib/creator-system/types'

export interface CreatorProfileHeaderProps {
  creator: CreatorProfileDto
  isOwner?: boolean
  onFollow?: () => void
  onUnfollow?: () => void
  onShare?: (url: string) => void
  isFollowing?: boolean
  followLoading?: boolean
}

export function CreatorProfileHeader({
  creator,
  isOwner,
  onFollow,
  onUnfollow,
  onShare,
  isFollowing,
  followLoading,
}: CreatorProfileHeaderProps) {
  const displayName = creator.displayName || creator.handle
  const profileUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/creators/${creator.slug}`
      : `/creators/${creator.slug}`

  const handleShare = () => {
    if (onShare) onShare(profileUrl)
    else navigator.clipboard?.writeText(profileUrl).catch(() => {})
  }

  return (
    <header
      className="overflow-hidden rounded-[32px] border"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 78%, transparent)',
      }}
    >
      <div
        className="min-h-[180px] px-5 py-6 sm:px-8"
        style={{
          background: creator.bannerUrl
            ? `linear-gradient(180deg, rgba(12,12,12,0.12), rgba(12,12,12,0.56)), url(${creator.bannerUrl}) center/cover`
            : `linear-gradient(135deg, color-mix(in srgb, ${creator.branding?.primaryColor || 'var(--accent)'} 22%, var(--panel)) 0%, color-mix(in srgb, ${creator.branding?.accentColor || 'var(--panel2)'} 28%, var(--panel)) 100%)`,
        }}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
          <div
            className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[28px] border-4"
            style={{
              borderColor: 'rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.12)',
            }}
          >
            {creator.avatarUrl ? (
              <img src={creator.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl font-bold" style={{ color: 'white' }}>
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-2xl font-bold sm:text-3xl" style={{ color: 'white' }}>
                {displayName}
              </h1>
              {creator.isVerified && (
                <VerifiedCreatorBadge
                  handle={creator.handle}
                  badge={creator.verificationBadge}
                  showLabel={true}
                  linkToProfile={false}
                  size="md"
                />
              )}
            </div>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
              @{creator.handle}
              {creator.creatorType ? ` • ${creator.creatorType}` : ''}
              {creator.communityVisibility === 'private' ? ' • private community' : ' • public community'}
            </p>
            {creator.branding?.tagline && (
              <p className="mt-3 text-sm font-medium" style={{ color: 'white' }}>
                {creator.branding.tagline}
              </p>
            )}
            {creator.communitySummary && (
              <p className="mt-3 max-w-3xl text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
                {creator.communitySummary}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5 sm:px-8">
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            <Users className="h-3.5 w-3.5" />
            {creator.followerCount ?? 0} followers
          </span>
          <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
            {creator.leagueCount ?? 0} creator leagues
          </span>
          {creator.totalLeagueMembers !== undefined && (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              {creator.totalLeagueMembers} community members
            </span>
          )}
          {creator.viewerTier ? (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--border)' }}>
              Tier {creator.viewerTier} viewer window
            </span>
          ) : null}
          {(creator.hiddenLeagueCount ?? 0) > 0 ? (
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'rgba(251, 146, 60, 0.35)', color: 'rgb(251, 146, 60)' }}>
              {creator.hiddenLeagueCount} leagues need an invite
            </span>
          ) : null}
        </div>

        {creator.bio && (
          <p className="max-w-3xl text-sm" style={{ color: 'var(--text)' }}>
            {creator.bio}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/* Only http(s): the URL is creator-supplied, and React 18 still renders a
              `javascript:` href. Rows written before the write path validated are
              skipped here rather than trusted. */}
          {creator.websiteUrl && /^https?:\/\//i.test(creator.websiteUrl) && (
            <a
              href={creator.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <Globe className="h-4 w-4" />
              Website
            </a>
          )}
          {!isOwner && (onFollow || onUnfollow) && (
            <button
              type="button"
              disabled={followLoading}
              onClick={isFollowing ? onUnfollow : onFollow}
              data-testid="creator-profile-follow-button"
              className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
              style={{
                background: isFollowing ? 'var(--panel2)' : 'var(--accent)',
                color: isFollowing ? 'var(--text)' : 'var(--bg)',
                border: '1px solid var(--border)',
              }}
            >
              {followLoading ? 'Saving...' : isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
          <button
            type="button"
            onClick={handleShare}
            data-testid="creator-profile-share-button"
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            <Share2 className="h-4 w-4" />
            Share profile
          </button>
        </div>
      </div>
    </header>
  )
}
