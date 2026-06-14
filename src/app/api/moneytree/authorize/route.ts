import { NextResponse } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthorizationUrl,
} from "@/lib/moneytree";
import { createServerSupabaseClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");

  if (!clientId) {
    return NextResponse.json({ error: "client_id is required" }, { status: 400 });
  }

  // Verify the user has access to this client
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 所有権チェック（IDOR対策）: RLS で当該クライアントが可視＝アクセス可。
  // これがないと他テナントのクライアントに自分の銀行接続を紐付けられてしまう。
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authUrl = buildAuthorizationUrl({ codeChallenge, state });

  // Store PKCE state in httpOnly cookie (5 min TTL)
  const oauthState = JSON.stringify({ codeVerifier, state, clientId });
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("mt_oauth_state", oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
  return response;
}
