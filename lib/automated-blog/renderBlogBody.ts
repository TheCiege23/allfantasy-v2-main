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

export function renderBlogBodyHtml(body: string | null | undefined): string {
  return String(body ?? "")
    .split("\n")
    .map((raw) => {
      const line = escapeBlogHtml(raw)
      if (/^###\s/.test(line)) return `<h3 class="text-lg font-semibold mt-6 mb-2">${line.slice(4)}</h3>`
      if (/^##\s/.test(line)) return `<h2 class="text-xl font-semibold mt-8 mb-2">${line.slice(3)}</h2>`
      if (/^#\s/.test(line)) return `<h1 class="text-2xl font-bold mt-6 mb-2">${line.slice(2)}</h1>`
      if (line.trim()) return `<p class="mb-3">${line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`
      return ""
    })
    .filter(Boolean)
    .join("\n")
}
