"use client"

import { FeedList } from "./FeedList"
import type { FeedItemType } from "@/lib/content-feed"
import type { ContentFeedItem } from "@/lib/content-feed"

interface FollowingFeedProps {
  sport: string | null
  contentType: FeedItemType | null
  onFollowCreator?: (creatorHandle: string) => void
  onSave?: (item: ContentFeedItem) => void
  savedIds?: Set<string>
}

export function FollowingFeed(props: FollowingFeedProps) {
  return <FeedList tab="following" {...props} />
}
