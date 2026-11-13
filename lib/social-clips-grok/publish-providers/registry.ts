import type { SocialPlatform } from "../types"
import type { SocialPublishProvider } from "./types"
import { XSocialPublishProvider } from "./XSocialPublishProvider"
import { InstagramSocialPublishProvider } from "./InstagramSocialPublishProvider"
import { FacebookSocialPublishProvider } from "./FacebookSocialPublishProvider"
import { TikTokQueuedPublishProvider } from "./TikTokQueuedPublishProvider"
import { RedditSocialPublishProvider } from "./RedditSocialPublishProvider"

let cache: SocialPublishProvider[] | null = null

export function getSocialPublishProviders(): SocialPublishProvider[] {
  if (cache) return cache
  cache = [
    new XSocialPublishProvider(),
    new InstagramSocialPublishProvider(),
    new FacebookSocialPublishProvider(),
    new TikTokQueuedPublishProvider(),
    new RedditSocialPublishProvider(),
  ]
  return cache
}

export function getSocialProviderForPlatform(platform: SocialPlatform): SocialPublishProvider | null {
  return getSocialPublishProviders().find((provider) => provider.supports(platform)) ?? null
}

