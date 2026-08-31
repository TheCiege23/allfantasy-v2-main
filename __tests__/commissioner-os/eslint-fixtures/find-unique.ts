// FIXTURE — T-006. findUnique cannot be soft-delete filtered: its `where`
// accepts only unique fields, so `deletedAt` is not a legal filter on it.
declare const prisma: any
export async function a() {
  await prisma.league.findUnique({ where: { id: 'l1' } })
  await prisma.league.findUniqueOrThrow({ where: { id: 'l1' } })
}
