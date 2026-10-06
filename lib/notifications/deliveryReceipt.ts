/** Acceptance is a provider response, not proof that a person saw a notification. */
export type DeliveryChannelOutcome = {
  status:'stored'|'accepted'|'partial'|'suppressed'|'failed'|'unknown'|'delivered'|'delayed'
  reason:string
  providerId?:string
  providerCheckedAt?:string
  verification?:'pending'|'unavailable'|'confirmed'
  attempts?:number
  endpoints?:number
  acceptedEndpoints?:number
}
export type NotificationDeliveryReceipt = {
  userId:string
  completedAt:string
  channels:Record<'inApp'|'email'|'sms'|'push',DeliveryChannelOutcome>
}
