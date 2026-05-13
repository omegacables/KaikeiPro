import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForToken, expiresAt } from "@/lib/moneytree";
import { createAdminSupabaseClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${origin}/dashboard?moneytree_error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !returnedState) {
    return NextResponse.redirect(`${origin}/dashboard?moneytree_error=invalid_callback`);
  }

  const cookieStore = await cookies();
  const rawState = cookieStore.get("mt_oauth_state")?.value;

  if (!rawState) {
    return NextResponse.redirect(`${origin}/dashboard?moneytree_error=state_expired`);
  }

  let parsed: { codeVerifier: string; state: string; clientId: string };
  try {
    parsed = JSON.parse(rawState);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard?moneytree_error=invalid_state`);
  }

  if (parsed.state !== returnedState) {
    return NextResponse.redirect(`${origin}/dashboard?moneytree_error=state_mismatch`);
  }

  const { clientId, codeVerifier } = parsed;

  try {
    const token = await exchangeCodeForToken({ code, codeVerifier });

    const admin = createAdminSupabaseClient();
    await admin.from("moneytree_connections").upsert(
      {
        client_id: clientId,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        expires_at: expiresAt(token.expires_in).toISOString(),
        scope: token.scope ?? null,
        is_active: true,
      },
      { onConflict: "client_id" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      `${origin}/dashboard?moneytree_error=${encodeURIComponent(msg)}`
    );
  }

  // Clear PKCE cookie
  const response = NextResponse.redirect(
    `${origin}/clients/${clientId}/bank-transactions?moneytree_connected=1`
  );
  response.cookies.delete("mt_oauth_state");
  return response;
}
