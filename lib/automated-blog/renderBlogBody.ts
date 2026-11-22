/**
 * Blog body → HTML for `dangerouslySetInnerHTML`.
 *
 * SECURITY: every line is HTML-escaped BEFORE the markdown-lite rules run, so
 * the only tags in the output are the ones this function writes. The body is
 * stored text (LLM output or an admin's edit), and the public article page
 * renders it for every visitor — an unescaped `<img onerror>` in a body ran
 * script on the main origin. Both the public page and the draft editor use
 * this one function so the two can never drift apart again.
 *
 * Supported: `#`/`##`/`###` headings, paragraphs, `**bold**`, `[text](href)` links,
 * and `- ` / `* ` bullet and `1. ` numbered lists (consecutive lines form one list).
 *
 * 🛑 LINKS ARE THE ONE RULE THAT WRITES AN ATTRIBUTE, SO THEY ARE ALLOWLISTED, NOT FILTERED.
 * An href is used only if, unescaped, it is a site path (`/` but not `//`) or an `https://`
 * URL, AND every character is in a fixed safe set (no quotes, no `<>`, no backslash, no
 * whitespace, no `*`). Anything else — `javascript:`, `data:`, `//evil.com`, `/\evil.com`
 * (browsers read it as `//`) — renders as the link's plain text. The attribute value is the
 * ESCAPED href, so even a character the set let through could not close the quote.
 * Links are cut out of the line before `**bold**` runs, so bold can never reach inside an
 * attribute.
 *
 * Pure and client-safe: the draft editor is a client component.
 */

export function escapeBlogHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Reverse of escapeBlogHtml, used ONLY to validate an href, never to emit text. */
function unescapeBlogHtml(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
}

const SAFE_HREF = /^(?:\/(?!\/)|https:\/\/)[A-Za-z0-9\-._~/?#=&%+:@!,;]*$/

/** The href if it may be used, else null. `escapedHref` is as it stands in the escaped line. */
export function safeBlogHref(escapedHref: string): string | null {
  const raw = unescapeBlogHtml(escapedHref)
  if (!SAFE_HREF.test(raw)) return null
  if (raw.startsWith("https://") && raw.length <= "https://".length) return null
  return escapedHref
}

function bold(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
}

// Link text: anything but `]`; href: anything but `)` and whitespace. Applied to ESCAPED text.
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** Inline rules for one escaped line: links first (as whole tokens), then bold on the rest. */
function inline(escaped: string): string {
  let out = ""
  let last = 0
  for (const m of escaped.matchAll(LINK)) {
    const [whole, text, href] = m
    const at = m.index ?? 0
    out += bold(escaped.slice(last, at))
    const safe = safeBlogHref(href!)
    if (safe === null) {
      out += bold(text!)
    } else if (unescapeBlogHtml(safe).startsWith("https://")) {
      out += `<a href="${safe}" class="underline" target="_blank" rel="noopener noreferrer">${bold(text!)}</a>`
    } else {
      out += `<a href="${safe}" class="underline">${bold(text!)}</a>`
    }
    last = at + whole.length
  }
  return out + bold(escaped.slice(last))
}

const BULLET = /^\s*[-*]\s+(.+)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.+)$/

export function renderBlogBodyHtml(body: string | null | undefined): string {
  const out: string[] = []
  let list: { tag: "ul" | "ol"; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const cls = list.tag === "ul" ? "list-disc" : "list-decimal"
    out.push(`<${list.tag} class="${cls} pl-6 mb-3 space-y-1">${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`)
    list = null
  }

  for (const raw of String(body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = escapeBlogHtml(raw)

    const item = BULLET.exec(line) ?? NUMBERED.exec(line)
    if (item) {
      const tag = BULLET.test(line) ? "ul" : "ol"
      if (list && list.tag !== tag) flush()
      if (!list) list = { tag, items: [] }
      list.items.push(inline(item[1]!))
      continue
    }

    flush()
    if (/^###\s/.test(line)) out.push(`<h3 class="text-lg font-semibold mt-6 mb-2">${line.slice(4)}</h3>`)
    else if (/^##\s/.test(line)) out.push(`<h2 class="text-xl font-semibold mt-8 mb-2">${line.slice(3)}</h2>`)
    else if (/^#\s/.test(line)) out.push(`<h1 class="text-2xl font-bold mt-6 mb-2">${line.slice(2)}</h1>`)
    else if (line.trim()) out.push(`<p class="mb-3">${inline(line)}</p>`)
  }
  flush()
  return out.join("\n")
}
