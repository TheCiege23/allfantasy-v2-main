/**
 * Copy text to the clipboard, trying both browser mechanisms before giving up.
 *
 * `navigator.clipboard.writeText` is the modern path, but it is MISSING outside a secure context
 * (plain http, some embedded webviews) and REFUSED by several in-app browsers (Instagram, Discord,
 * older iOS Safari). The referral copy buttons used only that path, so in exactly the places people
 * open a shared invite link, "Copy" silently did nothing.
 *
 * The fallback is the legacy `document.execCommand("copy")` on a temporary, off-screen <textarea>,
 * which still works in most of those browsers. It is deprecated but not removed, and it is only
 * reached when the modern API is unavailable or refuses.
 *
 * Returns true only when one of the two reported success. On false the caller should give the user
 * a way to copy by hand (select the text, show it) — never fail silently.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused (permissions, in-app browser) — fall through to the legacy path.
  }

  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null
  const selection = document.getSelection()
  const savedRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.setAttribute("aria-hidden", "true")
  // Off-screen but focusable; 16px so iOS does not zoom the page while it is selected.
  Object.assign(area.style, {
    position: "fixed",
    top: "0",
    left: "-9999px",
    opacity: "0",
    fontSize: "16px",
    pointerEvents: "none",
  })
  document.body.appendChild(area)

  let ok = false
  try {
    area.focus()
    area.select()
    // iOS ignores select() on a readonly field; an explicit range is what it honours.
    area.setSelectionRange(0, text.length)
    ok = typeof document.execCommand === "function" && document.execCommand("copy")
  } catch {
    ok = false
  } finally {
    document.body.removeChild(area)
    // Put the user's focus and selection back where they were.
    if (selection && savedRange) {
      selection.removeAllRanges()
      selection.addRange(savedRange)
    }
    active?.focus?.({ preventScroll: true })
  }
  return ok
}

/**
 * Select a field's whole value so a long-press / Ctrl+C copies it — the manual fallback when
 * `copyText` returns false. `select()` alone does nothing on a readonly input in iOS Safari.
 */
export function selectField(input: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!input) return
  input.focus()
  input.select()
  try {
    input.setSelectionRange(0, input.value.length)
  } catch {
    // Some input types do not support selection ranges; select() above is the best we can do.
  }
}
