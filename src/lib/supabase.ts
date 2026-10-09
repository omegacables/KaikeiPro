import { createServerClient as createServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

import { createClient } from "@supabase/supabase-js";

// Re-export browser client for server-side code that might use it
export { createBrowserClient } from "./supabase-browser";

/**
 * いま操作している利用者のID（リクエストごとに1回だけ調べる）。
 * サービスロールでの書き込みでも「誰が」を操作記録に残し、閲覧専用の書き込みを止めるために、
 * データベースへヘッダー x-actor-id で渡す（データベース側の app_actor_id() が読む）。
 * リクエストの外（スクリプトなど）では null。
 */
const currentActorId = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
});

// Admin client (for service-role operations like creating users)
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      // データベースへの各リクエストに操作者を付ける（認証APIへのリクエストには付けない）
      fetch: async (input, init) => {
        const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!target.includes("/rest/v1/")) return fetch(input, init);
        const actor = await currentActorId();
        if (!actor) return fetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set("x-actor-id", actor);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

// Server client (for server components / server actions)
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServer<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot set cookies — this is expected.
            // Middleware will handle session refresh.
          }
        },
      },
    }
  );
}
