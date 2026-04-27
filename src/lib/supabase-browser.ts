import { createBrowserClient as createBrowser } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Browser client (for client components)
export function createBrowserClient() {
  return createBrowser<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
