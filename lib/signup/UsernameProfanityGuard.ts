import { isOffensiveUsername } from "@/lib/moderation/offensiveName"

/** Sign-up and social-account usernames. Delegates to the one name filter (lib/moderation/offensiveName). */
export function hasProfanityInUsername(username: string): boolean {
  return isOffensiveUsername(username)
}
