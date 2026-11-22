interface SleeperUserIdentity {
  username: string
  userId?: string
}

export function buildSleeperUser(
  username: string,
  profile: { sleeper_user_id?: string | null } | null
): SleeperUserIdentity {
  const userId = profile?.sleeper_user_id || undefined
  return userId
    ? { username, userId }
    : { username }
}
