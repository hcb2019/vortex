import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireOwner } from "@/lib/auth";
import { getConnection, listConnections } from "@/server/data";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  const [connections, selectedConnection] = await Promise.all([listConnections(), getConnection()]);
  return <AppShell connections={connections} selectedConnection={selectedConnection}>{children}</AppShell>;
}
