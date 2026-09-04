import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { NotificationPanel } from "@/components/commissioner-os/notifications/NotificationPanel"
import { CommissionerPlatformProvider, useCommissionerPlatform } from "@/components/commissioner-os/providers/CommissionerPlatformProvider"
import { stubNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/stub"
import { demoNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/demo"
import { liveNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/live"
import type { CommissionerNotificationPayload } from "@/lib/commissioner-ui/contracts"

function OpenNotificationsButton() {
  const { openService } = useCommissionerPlatform()
  return (
    <button type="button" onClick={() => openService('notifications')}>
      Open Notifications (test)
    </button>
  )
}

function Harness({ notifications, errorMessage }: { notifications: CommissionerNotificationPayload[]; errorMessage?: string | null }) {
  return (
    <CommissionerPlatformProvider>
      <OpenNotificationsButton />
      <NotificationPanel notifications={notifications} errorMessage={errorMessage} />
    </CommissionerPlatformProvider>
  )
}

const NOTIFICATION_A: CommissionerNotificationPayload = {
  id: 'notif-a', severity: 'critical', message: 'A critical thing happened.', sourceModuleId: 'league-health', createdAt: new Date().toISOString(), read: false,
  relatedLink: { moduleId: 'league-health', label: 'View League Health', href: '/commissioner-os/league-health' },
}
const NOTIFICATION_B: CommissionerNotificationPayload = {
  id: 'notif-b', severity: 'informational', message: 'An informational thing happened.', sourceModuleId: 'reports', createdAt: new Date().toISOString(), read: true,
}

describe("commissioner-os notifications — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const client of [stubNotificationsClient, demoNotificationsClient, liveNotificationsClient]) {
      expect(typeof client.getNotifications).toBe('function')
      expect(typeof client.getSummary).toBe('function')
    }
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error", async () => {
    const stubResponse = await stubNotificationsClient.getNotifications()
    const demoResponse = await demoNotificationsClient.getNotifications()
    expect(stubResponse.source).toBe('stub')
    expect(stubResponse.error).toBeNull()
    expect(demoResponse.source).toBe('demo')
    expect(demoResponse.error).toBeNull()

    const liveNotifications = await liveNotificationsClient.getNotifications()
    const liveSummary = await liveNotificationsClient.getSummary()
    for (const response of [liveNotifications, liveSummary]) {
      expect(response.data).toBeNull()
      expect(response.error?.category).toBe('upstream_unavailable')
      expect(response.error?.retryable).toBe(false)
      expect(response.source).toBe('live')
    }
  })

  it("demo summary's unreadCount and criticalCount match the actual notification list", async () => {
    const notificationsResponse = await demoNotificationsClient.getNotifications()
    const summaryResponse = await demoNotificationsClient.getSummary()

    const actualUnread = notificationsResponse.data!.filter((n) => !n.read).length
    const actualCritical = notificationsResponse.data!.filter((n) => n.severity === 'critical').length

    expect(summaryResponse.data!.unreadCount).toBe(actualUnread)
    expect(summaryResponse.data!.criticalCount).toBe(actualCritical)
  })

  it("no notification carries anything beyond the platform contract's own fields — never a duplicated copy of the underlying entity", async () => {
    const response = await demoNotificationsClient.getNotifications()
    const allowedKeys = new Set(['id', 'severity', 'message', 'sourceModuleId', 'createdAt', 'read', 'relatedLink'])
    for (const notification of response.data!) {
      for (const key of Object.keys(notification)) {
        expect(allowedKeys.has(key)).toBe(true)
      }
      expect(notification.message.length).toBeGreaterThan(0)
    }
  })
})

describe("commissioner-os notifications — panel", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders no dialog until the notifications platform service is opened", () => {
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("opens grouped by source module, with severity and module labels", async () => {
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'League Health' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(within(dialog).getByText(NOTIFICATION_A.message)).toBeInTheDocument()
    expect(within(dialog).getByText(NOTIFICATION_B.message)).toBeInTheDocument()
    expect(within(dialog).getByText('Critical')).toBeInTheDocument()
    expect(within(dialog).getByText('Info')).toBeInTheDocument()
  })

  it("Unread filter shows only unread notifications", async () => {
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unread' }))

    expect(within(dialog).getByText(NOTIFICATION_A.message)).toBeInTheDocument()
    expect(within(dialog).queryByText(NOTIFICATION_B.message)).not.toBeInTheDocument()
  })

  it("marking a notification read removes it from the Unread filter and persists across a remount", async () => {
    const { unmount } = render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    let dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as read' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unread' }))
    expect(within(dialog).queryByText(NOTIFICATION_A.message)).not.toBeInTheDocument()

    unmount()
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unread' }))
    expect(within(dialog).queryByText(NOTIFICATION_A.message)).not.toBeInTheDocument()
  })

  it("Mark all as read clears the Unread view entirely", async () => {
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark all as read' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unread' }))

    expect(within(dialog).getByText('You’re all caught up.')).toBeInTheDocument()
  })

  it("muting a source module hides its notifications and persists across a remount", async () => {
    const { unmount } = render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    let dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Notification preferences' }))
    const leagueHealthRow = within(dialog).getByText('League Health').closest('li')!
    fireEvent.click(within(leagueHealthRow).getByRole('button', { name: 'Mute' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Notification preferences' }))
    expect(within(dialog).queryByText(NOTIFICATION_A.message)).not.toBeInTheDocument()
    expect(within(dialog).getByText(NOTIFICATION_B.message)).toBeInTheDocument()

    unmount()
    render(<Harness notifications={[NOTIFICATION_A, NOTIFICATION_B]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(NOTIFICATION_A.message)).not.toBeInTheDocument()
  })

  it("a notification's related link points at its source module and closes the panel when clicked", async () => {
    render(<Harness notifications={[NOTIFICATION_A]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    const dialog = await screen.findByRole('dialog')

    const link = within(dialog).getByRole('link', { name: 'View League Health' })
    expect(link).toHaveAttribute('href', '/commissioner-os/league-health')

    fireEvent.click(link)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("shows an affirmative empty state when there are no notifications at all", async () => {
    render(<Harness notifications={[]} />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('No notifications yet.')).toBeInTheDocument()
  })

  it("renders ErrorState instead of the empty state when the fetch itself failed (e.g. live mode) — never confused with a genuinely empty inbox", async () => {
    render(<Harness notifications={[]} errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    fireEvent.click(screen.getByText('Open Notifications (test)'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(within(dialog).queryByText('No notifications yet.')).not.toBeInTheDocument()
  })
})
