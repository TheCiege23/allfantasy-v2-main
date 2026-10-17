import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("World Cup chat render regression guard", () => {
  it("keeps old settings/commissioner panels out of the primary chat drawer source", () => {
    const source = readFileSync(
      join(process.cwd(), "components/brackets/world-cup/WorldCupBracketShell.tsx"),
      "utf8"
    )

    expect(source).toContain('data-testid="wc-chat-active-panel"')
    expect(source).toContain('data-testid="wc-chat-composer-shell"')
    expect(source).not.toContain("WorldCupNotificationSettingsCard")
    expect(source).not.toContain("Latest Pool Updates")
    expect(source).not.toContain("Commissioner Announcements")
    expect(source).not.toContain("System Reminders")
    /*
     * The old drawer had a "Moderation" settings PANEL — a visible heading, `<p …>Moderation</p>`.
     * That is what stays out. The per-message Report/Block menu (MessageModerationMenu) is a
     * different thing and is REQUIRED: App Review (guideline 1.2) needs report and block on every
     * chat, and the Terms promise it. So forbid the heading, and require the menu.
     */
    expect(source).not.toMatch(/>\s*Moderation\s*</)
    expect(source).toContain("<MessageModerationMenu")
  })
})
