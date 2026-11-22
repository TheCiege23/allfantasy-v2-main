import type { UserProfileForSettings } from "@/lib/user-settings/types"

type RecoveryOption = "email" | "phone"

/**
 * Returns which recovery options are available for password reset:
 * email if user has email, phone if user has verified phone.
 */
export function getRecoveryOptions(profile: UserProfileForSettings | null): RecoveryOption[] {
  if (!profile) return []
  const options: RecoveryOption[] = []
  if (profile.email) options.push("email")
  if (profile.phone && profile.phoneVerifiedAt) options.push("phone")
  return options
}
