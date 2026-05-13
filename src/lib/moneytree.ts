import crypto from "crypto";

const AUTH_BASE = process.env.MONEYTREE_AUTH_BASE_URL!;
const API_BASE = process.env.MONEYTREE_API_BASE_URL!;
const CLIENT_ID = process.env.MONEYTREE_CLIENT_ID!;
const CLIENT_SECRET = process.env.MONEYTREE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.MONEYTREE_REDIRECT_URI!;

// ── PKCE helpers ─────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ── Authorization URL ─────────────────────────────────────────────────────────

export function buildAuthorizationUrl(params: {
  codeChallenge: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(`${AUTH_BASE}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", params.scope ?? "guest_read accounts_read transactions_read");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("locale", "ja-JP");
  return url.toString();
}

// ── Token exchange ────────────────────────────────────────────────────────────

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: params.code,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<TokenResponse>;
}

export async function revokeToken(token: string): Promise<void> {
  const body = new URLSearchParams({
    token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  await fetch(`${AUTH_BASE}/oauth/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

// ── Data API ──────────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moneytree API error (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export type MoneytreeAccount = {
  id: number;
  currency: string;
  current_balance: number;
  institution: { name: string; code: string };
  branch_name?: string;
  account_type: string;
  account_number?: string;
  nickname?: string;
  status: string;
};

export type MoneytreeTransaction = {
  id: number;
  date: string;
  amount: number;
  description: string;
  base_amount: number;
  category_id?: number;
  is_business?: boolean;
};

export async function fetchAccounts(accessToken: string): Promise<MoneytreeAccount[]> {
  const data = await apiGet<{ accounts: MoneytreeAccount[] }>(
    "/link/v1/accounts.json",
    accessToken
  );
  return data.accounts ?? [];
}

export async function fetchTransactions(
  accessToken: string,
  accountId: number,
  params?: { from?: string; to?: string; page?: number }
): Promise<MoneytreeTransaction[]> {
  const url = new URL(`${API_BASE}/link/v1/accounts/${accountId}/transactions.json`);
  if (params?.from) url.searchParams.set("from", params.from);
  if (params?.to) url.searchParams.set("to", params.to);
  if (params?.page) url.searchParams.set("page", String(params.page));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Moneytree API error (${res.status}): ${text}`);
  }
  const data = await res.json() as { transactions: MoneytreeTransaction[] };
  return data.transactions ?? [];
}

export function expiresAt(expiresIn: number): Date {
  return new Date(Date.now() + expiresIn * 1000);
}
