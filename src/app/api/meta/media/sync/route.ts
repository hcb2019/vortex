import { getOwner } from "@/lib/auth";
import { env, isDemoMode } from "@/lib/env";
import { MediaSyncError, syncInstagramMediaForOwner } from "@/server/instagram/media-sync";
import { readRequestedConnectionId } from "@/server/instagram/owned-connection";

function settingsRedirect(result: "success" | "error", count?: number) {
  const url = new URL("/settings", env.APP_ORIGIN);
  url.searchParams.set("sync", result);
  if (typeof count === "number") url.searchParams.set("count", String(count));
  return Response.redirect(url, 303);
}

export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin !== env.APP_ORIGIN) return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (isDemoMode) return Response.json({ synced: 3 });
  const connectionId = await readRequestedConnectionId(request);
  try {
    const result = await syncInstagramMediaForOwner(owner.id, undefined, connectionId);
    if (request.headers.get("accept")?.includes("text/html")) return settingsRedirect("success", result.synced);
    return Response.json(result);
  } catch (error) {
    if (request.headers.get("accept")?.includes("text/html")) return settingsRedirect("error");
    return Response.json({
      error: error instanceof MediaSyncError ? error.message : "Não foi possível sincronizar os Reels.",
      code: error instanceof MediaSyncError ? error.code : "SYNC_ERROR",
    }, { status: 502 });
  }
}
