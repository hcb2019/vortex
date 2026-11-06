import { NextResponse, type NextRequest } from "next/server";
import { getOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { planInstagramConnectionWrite } from "@/lib/instagram-accounts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { constantTimeTextEqual, encryptSecret } from "@/server/crypto";
import { instagramGateway } from "@/server/instagram";
import { applySelectedConnectionCookie, persistSelectedConnection } from "@/server/instagram/owned-connection";

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
    await gateway.subscribeToComments(profile.userId, token.accessToken);
    const encrypted = encryptSecret(token.accessToken);
    const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null;
    const supabase = createSupabaseAdminClient();
    const { data: existing } = await supabase
      .from("instagram_connections")
      .select("id,owner_id")
      .eq("instagram_user_id", profile.userId)
      .maybeSingle();
    const plan = planInstagramConnectionWrite(owner.id, existing ? { id: existing.id, ownerId: existing.owner_id } : null);
    if (plan.action === "reject") {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=oauth`);
    }
    const payload = {
      owner_id: owner.id,
      instagram_user_id: profile.userId,
      username: profile.username,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_tag: encrypted.tag,
      token_expires_at: expiresAt,
      api_version: env.META_GRAPH_API_VERSION,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const saved = plan.action === "update"
      ? await supabase.from("instagram_connections").update(payload).eq("id", plan.id).eq("owner_id", owner.id).select("id").single()
      : await supabase.from("instagram_connections").insert(payload).select("id").single();
    if (saved.error || !saved.data) {
      return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=oauth`);
    }
    await persistSelectedConnection(owner.id, saved.data.id);
    const response = NextResponse.redirect(`${env.APP_ORIGIN}/settings?connected=1`);
    response.cookies.delete("meta_oauth_state");
    applySelectedConnectionCookie(response, saved.data.id);
    return response;
  } catch {
    return NextResponse.redirect(`${env.APP_ORIGIN}/settings?error=oauth`);
  }
}
