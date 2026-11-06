import { NextResponse, type NextRequest } from "next/server";
import { getOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { instagramOauthErrorQuery } from "@/lib/instagram-accounts";
import { constantTimeTextEqual, encryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { MetaApiError } from "@/server/instagram/meta-gateway";
import { applySelectedConnectionCookie, persistSelectedConnection } from "@/server/instagram/owned-connection";
import { saveOwnedInstagramConnection } from "@/server/instagram/save-connection";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function oauthRedirect(error: ReturnType<typeof instagramOauthErrorQuery>) {
  return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=${error}`);
}

function webhookDiagnostic(error: unknown) {
  if (error instanceof MetaApiError) {
    return `Webhook: Meta (${error.code ?? error.status}${error.subcode ? `/${error.subcode}` : ""}): ${error.message}`;
  }
  if (error instanceof Error) return `Webhook: ${error.message}`;
  return "Webhook: falha desconhecida ao assinar comentários.";
}

export async function GET(request: NextRequest) {
  const owner = await getOwner();
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const savedState = request.cookies.get("meta_oauth_state")?.value ?? "";
  if (!code || !state || !savedState || !constantTimeTextEqual(state, savedState)) return Response.json({ error: "Invalid OAuth state" }, { status: 400 });
  try {
    const gateway = instagramGateway();
    const token = await gateway.exchangeCode(code, `${env.APP_ORIGIN}/api/meta/oauth/callback`);
    if (token.permissions && !token.permissions.includes("instagram_business_basic")) {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=missing_basic`);
    }
    if (token.permissions && !token.permissions.includes("instagram_business_manage_comments")) {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=missing_comments`);
    }
    if (token.permissions && !token.permissions.includes("instagram_business_manage_messages")) {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=missing_messages`);
    }
    if (token.permissions && !token.permissions.includes("instagram_business_content_publish")) {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=missing_content_publish`);
    }
    const profile = await gateway.getProfile(token.accessToken);
    const encrypted = encryptSecret(token.accessToken);
    const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null;
    const saved = await saveOwnedInstagramConnection({
      ownerId: owner.id,
      instagramUserId: profile.userId,
      username: profile.username?.trim() || profile.userId,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenTag: encrypted.tag,
      tokenExpiresAt: expiresAt,
      apiVersion: env.META_GRAPH_API_VERSION,
    });
    if (!saved.ok) return oauthRedirect(instagramOauthErrorQuery(saved.reason));
    await persistSelectedConnection(owner.id, saved.id);
    try {
      // Persist first: webhook subscribe can fail after Meta consent and must
      // not abort a genuine second-account insert or rewrite the first row.
      await gateway.subscribeToComments(profile.userId, token.accessToken);
    } catch (error) {
      const diagnostic = webhookDiagnostic(error).slice(0, 400);
      console.error("instagram_oauth_subscribe_failed", {
        connectionId: saved.id,
        message: diagnostic.slice(0, 200),
      });
      const supabase = createSupabaseAdminClient();
      await supabase.from("instagram_connections").update({ last_error: diagnostic }).eq("id", saved.id).eq("owner_id", owner.id);
    }
    const response = NextResponse.redirect(`${env.APP_ORIGIN}/settings?connected=1`);
    response.cookies.delete("meta_oauth_state");
    applySelectedConnectionCookie(response, saved.id);
    return response;
  } catch (error) {
    console.error("instagram_oauth_callback_failed", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      code: error instanceof MetaApiError ? error.code ?? error.status : null,
    });
    return oauthRedirect(instagramOauthErrorQuery("meta"));
  }
}
