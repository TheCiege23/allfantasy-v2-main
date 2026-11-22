/**
 * Viral Invite Engine (PROMPT 142) types.
 */

const INVITE_TYPES = [
  'league',
  'bracket',
  'creator_league',
  'referral',
  'reactivation',
  'waitlist',
] as const
export type InviteType = (typeof INVITE_TYPES)[number]

const INVITE_STATUSES = ['active', 'expired', 'revoked', 'max_used'] as const
export type InviteStatus = (typeof INVITE_STATUSES)[number]

const INVITE_SHARE_CHANNELS = [
  'copy_link',
  'sms',
  'email',
  'twitter',
  'discord',
  'reddit',
  'whatsapp',
] as const
export type InviteShareChannel = (typeof INVITE_SHARE_CHANNELS)[number]

const INVITE_EVENT_TYPES = [
  'viewed',
  'shared',
  'accepted',
  'expired_shown',
  ...INVITE_SHARE_CHANNELS,
] as const
export type InviteEventType = (typeof INVITE_EVENT_TYPES)[number]

export type InvitePreviewStatus =
  | 'valid'
  | 'expired'
  | 'full'
  | 'invalid'
  | 'already_member'
  | 'already_redeemed'
  | 'max_used'

export interface InviteShareTargetDto {
  channel: InviteShareChannel
  label: string
  href: string | null
  action: 'copy' | 'manual_copy' | 'external'
  supported: boolean
  helperText?: string | null
}

export interface InviteLinkDto {
  id: string
  type: string
  token: string
  createdByUserId: string
  targetId: string | null
  expiresAt: string | null
  maxUses: number
  useCount: number
  status: string
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  inviteUrl: string
  previewUrl: string
  deepLinkUrl: string
  destinationHref: string | null
  destinationLabel: string | null
  viewCount: number
  shareCount: number
  acceptedCount: number
}

/** Public-safe preview for accept page (no PII). */
export interface InvitePreviewDto {
  inviteType: InviteType
  token: string
  title: string
  description: string | null
  targetId: string | null
  targetName: string | null
  sport: string | null
  memberCount: number | null
  maxMembers: number | null
  isFull: boolean
  expired: boolean
  expiresAt: string | null
  status: InvitePreviewStatus
  statusReason: string | null
  useCount: number
  maxUses: number
  destinationHref: string | null
  destinationLabel: string | null
  deepLinkUrl: string
  previewImageUrl: string | null
  createdByLabel: string | null
  shareTargets: InviteShareTargetDto[]
}

interface InviteStatsEventDto {
  eventType: string
  channel: string | null
  type: string
  createdAt: string
}

interface InviteTopPerformerDto {
  inviteLinkId: string
  token: string
  type: string
  inviteUrl: string
  destinationHref: string | null
  viewCount: number
  shareCount: number
  acceptedCount: number
  conversionRate: number
}

export interface InviteStatsDto {
  totalCreated: number
  totalAccepted: number
  totalViews: number
  totalShares: number
  activeLinks: number
  expiredLinks: number
  revokedLinks: number
  maxUsedLinks: number
  conversionRate: number
  byType: Record<string, number>
  byChannel: Record<string, number>
  recentEvents: InviteStatsEventDto[]
  topInvites: InviteTopPerformerDto[]
  referredSignups: number
}
