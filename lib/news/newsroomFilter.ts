/** Editorial filter shared by the admin newsroom and its notification sender. */
import { normalizedHeadline } from './breakingNews'
const CLICKBAIT = /\?\s*$|\b(you won'?t believe|shocking|insane|must[- ]see|odds|betting|bets?|parlays?|picks?|predictions?|best bets|fantasy|mock draft|power rankings|rankings|ranked|quiz|sponsored|promo code|deal of the day|how to watch|live stream|streaming|tv channel)\b/i

export function isClickbait(title: string): boolean {
  return CLICKBAIT.test(title)
}

/** A day-scoped delivery key shared by sport-wide and player-specific feeds. */
export function newsDeliveryKey(sport: string, title: string, publishedAt: Date): string {
  return `sports-news:${sport.toUpperCase()}:${publishedAt.toISOString().slice(0, 10)}:${normalizedHeadline(title)}`
}
