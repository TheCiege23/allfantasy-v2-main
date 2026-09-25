// Read Railway variables from stdin; never print credentials or returned tokens.
let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', async () => {
  try {
    const env = JSON.parse(input)
    const clientId = (env.DISCORD_CLIENT_ID || '').trim()
    const secret = (env.DISCORD_CLIENT_SECRET || '').trim()
    const result = {
      clientIdValid: /^\d{17,20}$/.test(clientId),
      secretPresent: Boolean(secret),
      secretHasWhitespace: secret !== env.DISCORD_CLIENT_SECRET,
      origin: env.NEXTAUTH_URL,
      redirect: env.DISCORD_REDIRECT_URI,
    }
    if (!result.clientIdValid || !secret) throw new Error('Missing OAuth configuration')
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret,
        grant_type: 'client_credentials', scope: 'applications.commands.update' }),
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.json()
    result.status = response.status
    result.clientAuthenticated = response.ok && typeof body.access_token === 'string'
    result.error = ['invalid_client', 'invalid_scope', 'invalid_request'].includes(body.error) ? body.error : undefined
    if (body.access_token) {
      const revoke = await fetch('https://discord.com/api/oauth2/token/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret,
          token: body.access_token, token_type_hint: 'access_token' }),
        signal: AbortSignal.timeout(15000),
      })
      result.testTokenRevoked = revoke.ok
    }
    console.log(JSON.stringify(result))
  } catch { console.error('OAuth configuration verification failed; no credentials displayed'); process.exitCode = 1 }
})
