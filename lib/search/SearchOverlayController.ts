/**
 * SearchOverlayController — state and keyboard shortcut for search overlay.
 * Use with React useState or a context provider.
 */

const COMMAND_PALETTE_KEY = "k"
const MAC = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

export function getCommandPaletteShortcut(): string {
  return MAC ? `⌘${COMMAND_PALETTE_KEY}` : `Ctrl+${COMMAND_PALETTE_KEY.toUpperCase()}`
}

/** Check if event is the command palette shortcut. */
function isCommandPaletteShortcut(e: KeyboardEvent): boolean {
  return (MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === COMMAND_PALETTE_KEY
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
}

/** Handler for keydown: call onOpen when shortcut pressed. Use in useEffect with this handler. */
export function createCommandPaletteHandler(
  onOpen: () => void,
  options?: { allowInInputs?: boolean }
) {
  return (e: KeyboardEvent) => {
    if (!isCommandPaletteShortcut(e) || e.defaultPrevented || e.repeat) return
    if (!options?.allowInInputs && isEditableTarget(e.target)) return
    e.preventDefault()
    onOpen()
  }
}
