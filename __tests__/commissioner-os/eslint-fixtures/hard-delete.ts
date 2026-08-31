// FIXTURE — invariant 4.
declare const prisma: any
declare const tx: any
export async function a() {
  await prisma.league.deleteMany({ where: {} })
  await tx.delete({ where: {} })
  await prisma.delete({ where: {} })
}
