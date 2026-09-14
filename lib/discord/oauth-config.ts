export function discordOAuthConfigValid(clientId: string, redirectUri: string): boolean {
  if (!/^[0-9]{17,20}$/.test(clientId)) return false
  try {
    const uri = new URL(redirectUri)
    return !uri.username && !uri.password && !uri.hash && !uri.search &&
      (uri.protocol === 'https:' || (uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname)))
  } catch {
    return false
  }
}
