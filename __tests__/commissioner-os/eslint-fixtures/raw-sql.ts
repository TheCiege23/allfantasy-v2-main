// FIXTURE — all four raw methods. The `Unsafe` pair is the dangerous half and
// the easy one to forget.
declare const tx: any
export async function a() {
  await tx.$queryRaw`SELECT 1`
  await tx.$queryRawUnsafe('SELECT 1')
  await tx.$executeRaw`SELECT 1`
  await tx.$executeRawUnsafe('SELECT 1')
}
