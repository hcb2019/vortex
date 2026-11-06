import { revalidatePath } from "next/cache";
import { getOwner } from "@/lib/auth";
import { env, isDemoMode } from "@/lib/env";
import { syncAudienceData } from "@/server/audience/sync";
import { findOwnedInstagramConnection } from "@/server/instagram/owned-connection";

export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(env.APP_ORIGIN).origin) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const connection = isDemoMode ? null : await findOwnedInstagramConnection(owner.id);
    const result = await syncAudienceData(owner.id, connection?.id);
    revalidatePath("/radar");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível sincronizar o Radar." }, { status: 502 });
  }
}
