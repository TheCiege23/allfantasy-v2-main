import "server-only"

/** RFC822 metadata and Gmail delivery authentication only; no LS template parsing. */
export type LeagueSafeEmailHeaders = {
  from: string
  to: string
  subject: string
  rfcMessageId: string | null
  authResults: {
    headers: string[]
    trustedHeader: string | null
    spf: string | null
    dkim: string | null
    dmarc: string | null
    dkimDomains: string[]
  }
  rejectionReason: string | null
}

// Split outside comments/quotes. "dkim=pass" inside a reason is not a result.
function authenticationClauses(value: string): string[] {
  const clauses: string[] = []
  let current = ""
  let depth = 0
  let quoted = false
  let escaped = false
  for (const char of value) {
    if (escaped) {
      if (depth === 0) current += char
      escaped = false
    } else if (char === "\\") {
      if (depth === 0) current += char
      escaped = true
    } else if (depth > 0) {
      if (char === "(") depth++
      else if (char === ")") {
        depth--
        if (depth === 0) current += " "
      }
    } else if (char === '"') {
      quoted = !quoted
      current += char
    } else if (!quoted && char === "(") depth++
    else if (!quoted && char === ";") {
      clauses.push(current.trim())
      current = ""
    } else current += char
  }
  if (depth !== 0 || quoted || escaped) return []
  clauses.push(current.trim())
  return clauses
}

function property(clause: string, key: string): string | null {
  const tokens = clause.match(/(?:[^\s"]+|"(?:\\.|[^"\\])*")+/g) ?? []
  for (const token of tokens) {
    const equals = token.indexOf("=")
    if (token.slice(0, equals).toLowerCase() !== key) continue
    return token.slice(equals + 1).replace(/^"|"$/g, "").toLowerCase()
  }
  return null
}

function senderDomain(from: string): string | null {
  const cleaned = from.replace(/\([^()]*\)/g, "").trim()
  const mailbox = cleaned.match(/^(?:"(?:\\.|[^"\\])*"|[^<>,"])*<([^<>\s,]+)>$/)?.[1] ?? cleaned
  return mailbox.match(/^[^@\s<>,]+@([a-z0-9.-]+)$/i)?.[1]?.toLowerCase() ?? null
}

export function inspectLeagueSafeHeaders(rawBody: string, allowedDomains: string[]): LeagueSafeEmailHeaders {
  const headers = new Map<string, string[]>()
  let malformed = false
  const boundary = /\r?\n\r?\n/.exec(rawBody)
  const headerText = boundary ? rawBody.slice(0, boundary.index) : ""
  if (!boundary || Buffer.byteLength(headerText, "utf8") > 64 * 1024) malformed = true
  else {
    const lines = headerText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)
    for (const line of lines) {
      const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line)
      if (!match) { malformed = true; continue }
      const key = match[1].toLowerCase()
      headers.set(key, [...(headers.get(key) ?? []), match[2].trim()])
    }
  }
  const first = (key: string) => headers.get(key)?.[0] ?? ""
  const authHeaders = headers.get("authentication-results") ?? []
  // Never search later, sender-supplied blocks for a passing result.
  const clauses = authenticationClauses(authHeaders[0] ?? "")
  const trusted = /^mx\.google\.com(?:\s+\d+)?$/i.test(clauses[0] ?? "")
  const authResults: LeagueSafeEmailHeaders["authResults"] = {
    headers: authHeaders, trustedHeader: trusted ? authHeaders[0] : null,
    spf: null, dkim: null, dmarc: null, dkimDomains: [],
  }
  if (trusted) {
    for (const clause of clauses.slice(1)) {
      const method = /^(spf|dkim|dmarc)(?:\/\d+)?\s*=\s*([a-z]+)\b/i.exec(clause)
      if (!method) continue
      const name = method[1].toLowerCase() as "spf" | "dkim" | "dmarc"
      const result = method[2].toLowerCase()
      if (authResults[name] === null || result === "pass") authResults[name] = result
      if (name === "dkim" && result === "pass") {
        // Gmail commonly reports header.i rather than header.d.
        const domain = property(clause, "header.d") ??
          property(clause, "header.i")?.split("@").pop()
        if (domain && /^[a-z0-9.-]+$/.test(domain)) authResults.dkimDomains.push(domain)
      }
    }
  }
  const from = first("from")
  const domain = senderDomain(from)
  let rejectionReason: string | null = null
  if (malformed || (headers.get("from")?.length ?? 0) !== 1) rejectionReason = "malformed_headers"
  else if (!domain || !allowedDomains.includes(domain)) rejectionReason = "sender_domain_not_allowed"
  else if (!trusted) rejectionReason = "missing_trusted_gmail_authentication"
  else if (!authResults.dkimDomains.some((dkimDomain) => allowedDomains.includes(dkimDomain))) {
    rejectionReason = "leaguesafe_dkim_did_not_pass"
  }
  return {
    from, to: (headers.get("to") ?? []).join(", "), subject: first("subject"),
    rfcMessageId: first("message-id") || null, authResults, rejectionReason,
  }
}
