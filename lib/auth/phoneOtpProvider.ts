import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { normalizePhoneE164, isValidPhoneE164 } from "@/lib/phone/e164"
import { isPhoneOnlyAccountEmail } from "@/lib/auth/phoneOnlyAccountEmail"
import { consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { activeAccountRestriction, ACCOUNT_SUSPENDED_ERROR } from "@/lib/moderation/accountSuspension"

/** A texted Verify code authenticates only a phone already verified on this account. */
export const phoneOtpProvider = CredentialsProvider({
  id: "phone-otp",
  name: "Text message code",
  credentials: {
    phone: { label: "Phone number", type: "tel" },
    code: { label: "Verification code", type: "text" },
  },
  async authorize(credentials) {
    const phone = normalizePhoneE164(credentials?.phone ?? "")
    const code = credentials?.code?.trim() ?? ""
    if (!isValidPhoneE164(phone) || !/^\d{4,10}$/.test(code)) return null

    // Spend the guess budget before asking Twilio, across all app instances.
    const budget = await consumeSharedRateLimit(`signin-phone-check:${phone}`, 5, 10 * 60)
    if (!budget.success) return null

    const profile = await prisma.userProfile.findUnique({
      where: { phone },
      select: { userId: true, phoneVerifiedAt: true },
    })
    if (!profile?.phoneVerifiedAt) return null
    const user = await prisma.appUser.findUnique({
      where: { id: profile.userId },
      select: {
        id: true, email: true, username: true, displayName: true, avatarUrl: true,
      },
    })
    if (!user) return null

    const verifySid = process.env.TWILIO_VERIFY_SERVICE_SID
    if (!verifySid) return null
    try {
      const { getTwilioClient } = await import("@/lib/twilio-client")
      const client = await getTwilioClient()
      const check = await client.verify.v2.services(verifySid).verificationChecks.create({
        to: phone,
        code,
      })
      if (check.status !== "approved") return null
    } catch {
      // Twilio reports invalid and expired codes as errors. Never log the code or phone.
      return null
    }
    if (await activeAccountRestriction(user.id)) {
      throw new Error(ACCOUNT_SUSPENDED_ERROR)
    }
    return {
      id: user.id,
      email: isPhoneOnlyAccountEmail(user.email) ? null : user.email,
      name: user.displayName || user.username,
      username: user.username,
      image: user.avatarUrl,
    }
  },
})
