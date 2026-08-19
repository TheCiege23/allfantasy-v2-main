import { prisma } from "@/lib/prisma"

type CliArgs = {
  email: string
  username: string
}

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith("--")) continue
    args.set(item.slice(2), argv[i + 1] ?? "")
    i += 1
  }
  return {
    email: args.get("email")?.trim() || "Cjabar.henson@gmail.com",
    username: args.get("username")?.trim() || "TheCiege26",
  }
}

async function main() {
  const { email, username } = parseArgs(process.argv.slice(2))
  const user = await prisma.appUser.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { username },
      ],
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
    },
  })

  if (!user) {
    console.error(`No AppUser found for email=${email} or username=${username}.`)
    process.exitCode = 1
    return
  }

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      displayName: user.displayName ?? user.username ?? user.email,
      afCommissionerSub: true,
      afProSub: true,
      afWarRoomSub: true,
      profileComplete: true,
    },
    update: {
      afCommissionerSub: true,
      afProSub: true,
      afWarRoomSub: true,
    },
  })

  const existingGrant = await prisma.adminSubscriptionGrant.findFirst({
    where: {
      userId: user.id,
      tier: "supreme",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  })

  if (!existingGrant) {
    await prisma.adminSubscriptionGrant.create({
      data: {
        userId: user.id,
        tier: "supreme",
        expiresAt: new Date("2099-12-31T23:59:59.000Z"),
        grantedByAdminId: "system",
        grantedByEmail: "system@allfantasy.internal",
        reason: "AllFantasy owner/test account supreme verification grant.",
      },
    })
  }

  console.log(`Granted supreme test profile flags and subscription grant to ${user.username} <${user.email}>.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Failed to grant admin access.")
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
