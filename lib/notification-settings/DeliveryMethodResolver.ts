/**
 * Resolves which delivery methods are available for the user.
 * inApp: always; email: when user has email; sms: when phone verified; push: always offered.
 */
export interface DeliveryMethodAvailability {
  inApp: boolean
  email: boolean
  sms: boolean
  /**
   * Push needs only a device subscription, which lives on the device rather than the
   * profile, so the switch is always offered. Optional so existing literals still type.
   */
  push?: boolean
}

export function getDeliveryMethodAvailability(options: {
  hasEmail: boolean
  phoneVerified: boolean
}): DeliveryMethodAvailability {
  return {
    inApp: true,
    email: options.hasEmail,
    sms: options.phoneVerified,
    push: true,
  }
}

export const DELIVERY_LABELS: Record<keyof DeliveryMethodAvailability, string> = {
  inApp: "In-app",
  email: "Email",
  sms: "SMS",
  push: "Push",
}
