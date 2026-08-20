import { notFound } from "next/navigation"
import ChimmyInterfaceHarnessClient from "./ChimmyInterfaceHarnessClient"

export default function E2EChimmyInterfacePage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <ChimmyInterfaceHarnessClient />
}
