import { getOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncRecentAutomationComments } from "@/server/automation-comment-sync";
import { MetaApiError } from "@/server/instagram/meta-gateway";
import { findOwnedInstagramConnection, readRequestedConnectionId } from "@/server/instagram/owned-connection";

function settingsRedirect(result: "success" | "error", counts?: { found: number; queued: number; processed: number }) {
  const url = new URL("/settings", env.APP_ORIGIN);
  url.searchParams.set("comments", result);
  if (counts) {
    url.searchParams.set("found", String(counts.found));
    url.searchParams.set("queued", String(counts.queued));
    url.searchParams.set("processed", String(counts.processed));
  }
  return Response.redirect(url, 303);
}

export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== env.APP_ORIGIN) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const connectionId = await readRequestedConnectionId(request);
  const connection = await findOwnedInstagramConnection(owner.id, connectionId);

  try {
    const result = await syncRecentAutomationComments(owner.id, connection?.id);
    if (connection) {
      await createSupabaseAdminClient()
        .from("instagram_connections")
        .update({ last_error: null })
        .eq("id", connection.id);
    }
    return settingsRedirect("success", result);
  } catch (error) {
    const diagnostic = error instanceof MetaApiError
      ? `Meta (${error.code ?? error.status}): ${error.message}`
      : error instanceof Error
        ? error.message
        : "Falha desconhecida ao consultar comentários.";
    console.error("Instagram recent comment sync failed", {
      errorType: error instanceof MetaApiError ? "MetaApiError" : error instanceof Error ? error.name : "UnknownError",
      metaCode: error instanceof MetaApiError ? error.code ?? null : null,
      httpStatus: error instanceof MetaApiError ? error.status : null,
    });
    if (connection) {
      await createSupabaseAdminClient()
        .from("instagram_connections")
        .update({ last_error: diagnostic.slice(0, 400) })
        .eq("id", connection.id);
    }
    return settingsRedirect("error");
  }
}
