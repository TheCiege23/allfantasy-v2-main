import type { Prisma } from '@prisma/client'

export function toPrismaJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

export function toPrismaNullableJsonInput(
  value: unknown,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null) return undefined
  return value as Prisma.InputJsonValue
}
