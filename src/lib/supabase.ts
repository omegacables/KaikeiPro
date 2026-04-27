import { createServerClient as createServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

import { createClient } from "@supabase/supabase-js";

// Re-export browser client for server-side code that might use it
export { createBrowserClient } from "./supabase-browser";

// Admin client (for service-role operations like creating users)
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
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
