import { getOwner } from "@/lib/auth";
import { env, isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { MetaApiError } from "@/server/instagram/meta-gateway";
import { findOwnedInstagramConnection, readRequestedConnectionId } from "@/server/instagram/owned-connection";

function settingsRedirect(result: "active" | "restored" | "error") {
  const url = new URL("/settings", env.APP_ORIGIN);
  url.searchParams.set("webhook", result);
  return Response.redirect(url, 303);
}

export async function POST(request: Request) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("origin") !== env.APP_ORIGIN) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (isDemoMode) return settingsRedirect("active");
  const connectionId = await readRequestedConnectionId(request);
  const connection = await findOwnedInstagramConnection(owner.id, connectionId);
  if (!connection) return settingsRedirect("error");
  const supabase = createSupabaseAdminClient();

  try {
    const accessToken = decryptSecret({
      ciphertext: connection.token_ciphertext,
      iv: connection.token_iv,
      tag: connection.token_tag,
    });
    const gateway = instagramGateway();
    if (await gateway.hasCommentSubscription(connection.instagram_user_id, accessToken)) {
      await supabase.from("instagram_connections").update({ last_error: null }).eq("id", connection.id);
      return settingsRedirect("active");
    }

    await gateway.subscribeToComments(connection.instagram_user_id, accessToken);
    const restored = await gateway.hasCommentSubscription(connection.instagram_user_id, accessToken);
    await supabase.from("instagram_connections").update({
      last_error: restored ? null : "A Meta aceitou a solicitação, mas não confirmou os campos comments e messages.",
    }).eq("id", connection.id);
    return settingsRedirect(restored ? "restored" : "error");
  } catch (error) {
    const diagnostic = error instanceof MetaApiError
      ? `Meta (${error.code ?? error.status}${error.subcode ? `/${error.subcode}` : ""}): ${error.message}`
      : error instanceof Error
        ? error.message
        : "Falha desconhecida ao confirmar o webhook.";
    await supabase.from("instagram_connections").update({
      last_error: `Webhook: ${diagnostic}`.slice(0, 400),
    }).eq("id", connection.id);
    return settingsRedirect("error");
  }
}
