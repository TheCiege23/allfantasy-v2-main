/**
 * AllFantasy Social Share Engine types.
 * Public-safe payloads only: no member lists, emails, or private league details.
 */

import type { LeagueSport } from "@prisma/client";

export const SHAREABLE_KINDS = [
  "league_invite",
  "bracket_invite",
  "ai_result_card",
  "matchup_result",
  "power_rankings",
  "story_recap",
  "creator_league_promo",
  "player_comparison",
] as const;

export type ShareableKind = (typeof SHAREABLE_KINDS)[number];

export const SHARE_DESTINATIONS = [
  "copy_link",
  "x",
  "discord",
  "reddit",
  "email",
  "sms",
  "native_share",
] as const;

export type ShareDestination = (typeof SHARE_DESTINATIONS)[number];

export const SHARE_VISIBILITY = ["public", "invite_only", "private"] as const;

export type ShareVisibility = (typeof SHARE_VISIBILITY)[number];

export const SHARE_TRACK_EVENTS = [
  "share_modal_opened",
  "share_attempt",
  "share_complete",
  "share_fallback",
] as const;

type ShareTargetAction = "copy" | "external" | "manual_copy";

export interface SharePayload {
  kind: ShareableKind;
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  sport?: LeagueSport | string;
  shareId?: string;
  leagueName?: string;
  bracketName?: string;
  weekOrRound?: string;
  hashtags?: string[];
  cta?: string;
  creatorName?: string;
  eyebrow?: string;
  chips?: string[];
  helperText?: string;
  visibility?: ShareVisibility;
  safeForPublic?: boolean;
}

export interface SharePayloadRequest {
  kind: ShareableKind;
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  sport?: LeagueSport | string | null;
  shareId?: string | null;
  leagueName?: string | null;
  bracketName?: string | null;
  weekOrRound?: string | null;
  hashtags?: string[] | null;
  cta?: string | null;
  creatorName?: string | null;
  visibility?: ShareVisibility | null;
  safeForPublic?: boolean | null;
}

export interface ShareTargetDescriptor {
  destination: ShareDestination;
  label: string;
  href: string | null;
  action: ShareTargetAction;
  helperText: string;
  opensExternal: boolean;
}

export interface ShareTrackMeta {
  shareType: ShareableKind;
  destination?: ShareDestination;
  shareId?: string;
  sport?: string;
  path?: string;
  surface?: string;
  shareUrl?: string;
  visibility?: ShareVisibility;
  usedFallback?: boolean;
}
