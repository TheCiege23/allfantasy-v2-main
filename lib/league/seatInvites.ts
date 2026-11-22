import { prisma } from '@/lib/prisma'

export const pendingSeatInviteStatuses = ['SENDING', 'ACCEPTED', 'DELAYED']

export const seatInviteHistorySelect = {
  id: true,
  recipientLabel: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

export function maskSeatInviteRecipient(address: string) {
  const [name, domain] = address.split('@')
  return `${name.slice(0, 1)}***@${domain}`.slice(0, 255)
}

export function seatInviteProviderStatus(event: string) {
  switch (event.replace(/^email\./, '')) {
    case 'delivered':
    case 'opened':
    case 'clicked':
      return 'DELIVERED'
    case 'failed':
    case 'bounced':
    case 'complained':
    case 'canceled':
    case 'suppressed':
      return 'FAILED'
    case 'delivery_delayed':
    case 'delayed':
      return 'DELAYED'
    default:
      return null
  }
}

export async function recordSeatInviteProviderEvent(messageId: string, event: string, attemptId?: string) {
  const status = seatInviteProviderStatus(event)
  if (!status || !messageId) return
  await prisma.leagueSeatInvite.updateMany({
    where: {
      status: { in: pendingSeatInviteStatuses },
      OR: [
        { providerMessageId: messageId },
        ...(attemptId ? [{ id: attemptId, providerMessageId: null }] : []),
      ],
    },
    data: { status, providerMessageId: messageId },
  })
}
