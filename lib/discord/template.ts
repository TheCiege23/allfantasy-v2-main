/**
 * The "make your league's server" link.
 *
 * Discord does not let an app create a server for a person: bot-created servers only
 * work while the bot is in fewer than 10 servers, so that path dies the moment the
 * product works. A server TEMPLATE is the supported route — `https://discord.new/<code>`
 * opens Discord with a pre-built server (channels, categories, roles) and the person
 * taps Create. The server is theirs from the first second; we never own it.
 *
 * The code comes from `DISCORD_LEAGUE_TEMPLATE_CODE`, made once by the owner from a
 * real server (Server Settings → Server Template). Unset or malformed → null, and the
 * screen shows Discord's own "create a server" steps instead of a broken link.
 */

/** Discord template codes are short and alphanumeric. Anything else is not one. */
const TEMPLATE_CODE = /^[A-Za-z0-9]{4,32}$/

export function leagueTemplateUrl(raw: string | undefined = process.env.DISCORD_LEAGUE_TEMPLATE_CODE): string | null {
  let code = raw?.trim() ?? ''
  // Accept a pasted full link as well as the bare code — the owner will copy whichever
  // Discord shows them, and both are the same template.
  const fromLink = code.match(/^https?:\/\/(?:discord\.new|(?:www\.)?discord\.com\/template)\/([A-Za-z0-9]+)\/?$/i)
  if (fromLink) code = fromLink[1]
  if (!TEMPLATE_CODE.test(code)) return null
  return `https://discord.new/${code}`
}
