export type OpenClawConfig = {
  webUiUrl: string
  gatewayUrl: string
  token: string
}

type OpenClawAssistant = 'dev-assistant' | 'growth-marketing-assistant'

const DEFAULT_WEBUI_URL = 'https://webui.clawship.ai/allfantasy-dev-assistant/'
const DEFAULT_GATEWAY_URL = 'wss://webui.clawship.ai/allfantasy-dev-assistant/ws'
const DEFAULT_GROWTH_WEBUI_URL = 'https://webui.clawship.ai/allfantasy-growth-marketing-assistant/'
const DEFAULT_GROWTH_GATEWAY_URL = 'wss://webui.clawship.ai/allfantasy-growth-marketing-assistant/ws'
const DEFAULT_ALLOWED_HOSTS = ['webui.clawship.ai']

function normalizeUrl(input: string): string {
  return input.trim()
}

function parseAllowedHosts(): string[] {
  const raw = String(process.env.OPENCLAW_ALLOWED_HOSTS || '').trim()
  if (!raw) return DEFAULT_ALLOWED_HOSTS
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

function assertAllowedHttpHost(urlValue: string): void {
  const u = new URL(urlValue)
  if (u.protocol !== 'https:') {
    throw new Error('OPENCLAW_WEBUI_URL must use https.')
  }

  const allowed = parseAllowedHosts()
  if (!allowed.includes(u.hostname.toLowerCase())) {
    throw new Error('OPENCLAW_WEBUI_URL host is not allowlisted.')
  }
}

function assertAllowedWsHost(urlValue: string): void {
  const u = new URL(urlValue)
  if (u.protocol !== 'wss:') {
    throw new Error('OPENCLAW_GATEWAY_URL must use wss.')
  }

  const allowed = parseAllowedHosts()
  if (!allowed.includes(u.hostname.toLowerCase())) {
    throw new Error('OPENCLAW_GATEWAY_URL host is not allowlisted.')
  }
}

export function getOpenClawConfig(): OpenClawConfig {
  return getAssistantConfig('dev-assistant')
}

export function isOpenClawConfigured(): boolean {
  try {
    getOpenClawConfig()
    return true
  } catch {
    return false
  }
}

function getAssistantConfig(assistant: OpenClawAssistant): OpenClawConfig {
  const isGrowth = assistant === 'growth-marketing-assistant'

  const token = String(
    isGrowth ? process.env.OPENCLAW_GROWTH_TOKEN || '' : process.env.OPENCLAW_TOKEN || ''
  ).trim()
  const missingTokenKey = isGrowth ? 'OPENCLAW_GROWTH_TOKEN' : 'OPENCLAW_TOKEN'
  if (!token) {
    throw new Error(`${missingTokenKey} is not configured.`)
  }

  const webUiUrl = normalizeUrl(
    String(
      isGrowth
        ? process.env.OPENCLAW_GROWTH_WEBUI_URL || DEFAULT_GROWTH_WEBUI_URL
        : process.env.OPENCLAW_WEBUI_URL || DEFAULT_WEBUI_URL
    )
  )
  const gatewayUrl = normalizeUrl(
    String(
      isGrowth
        ? process.env.OPENCLAW_GROWTH_GATEWAY_URL || DEFAULT_GROWTH_GATEWAY_URL
        : process.env.OPENCLAW_GATEWAY_URL || DEFAULT_GATEWAY_URL
    )
  )

  assertAllowedHttpHost(webUiUrl)
  assertAllowedWsHost(gatewayUrl)

  return {
    webUiUrl,
    gatewayUrl,
    token,
  }
}

/**
 * Resolve a caller-supplied path against the configured gateway, pinned to it.
 *
 * ⚠ SSRF + TOKEN THEFT. `new URL('//evil.com/x', base)` is a PROTOCOL-RELATIVE
 * URL and resolves to https://evil.com/x — and `/\evil.com` does the same under
 * WHATWG parsing. The routes' own check only rejected '://', so any signed-in
 * user could point the upstream call (which carries the OpenClaw bearer token)
 * at a host of their choosing, or at an internal address. The resolved origin
 * must equal the base origin, whatever the path looked like.
 */
function resolvePinnedPath(baseUrl: string, path: string): string {
  const base = new URL(baseUrl)
  if (!path) return base.toString()
  if (/[\\\u0000-\u001f]/.test(path)) {
    throw new Error('upstreamPath contains characters that are not allowed.')
  }
  const safePath = path.startsWith('/') ? path : `/${path}`
  if (safePath.startsWith('//')) {
    throw new Error('upstreamPath must be a path on the configured gateway.')
  }
  const target = new URL(safePath, base)
  if (target.origin !== base.origin) {
    throw new Error('upstreamPath must be a path on the configured gateway.')
  }
  return target.toString()
}

export function buildOpenClawTargetUrl(path = ''): string {
  return resolvePinnedPath(getOpenClawConfig().webUiUrl, path)
}

export function getOpenClawPublicMeta(): { webUiUrl: string; gatewayUrl: string } {
  const { webUiUrl, gatewayUrl } = getOpenClawConfig()
  return { webUiUrl, gatewayUrl }
}

export function getOpenClawGrowthConfig(): OpenClawConfig {
  return getAssistantConfig('growth-marketing-assistant')
}

export function isOpenClawGrowthConfigured(): boolean {
  try {
    getOpenClawGrowthConfig()
    return true
  } catch {
    return false
  }
}

export function buildOpenClawGrowthTargetUrl(path = ''): string {
  return resolvePinnedPath(getOpenClawGrowthConfig().webUiUrl, path)
}

export function getOpenClawGrowthPublicMeta(): { webUiUrl: string; gatewayUrl: string } {
  const { webUiUrl, gatewayUrl } = getOpenClawGrowthConfig()
  return { webUiUrl, gatewayUrl }
}
