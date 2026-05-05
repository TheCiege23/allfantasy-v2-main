import type { ReactNode } from "react"
import ProductShellLayout from "@/components/navigation/ProductShellLayout"

export default function ChimmyLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
