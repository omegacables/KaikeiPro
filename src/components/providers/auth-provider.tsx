"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { setCurrentUserId } from "@/lib/scoped-storage";
import type { User } from "@supabase/supabase-js";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "staff" | "client";
  firmId: string | null;
  clientId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  rawUser: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  rawUser: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [rawUser, setRawUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient();

    async function loadUser(authUser: User) {
      setRawUser(authUser);
      setCurrentUserId(authUser.id);

      // Check super_admins first
      const { data: superAdmin } = await supabase
        .from("super_admins")
        .select("name, email")
        .eq("user_id", authUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (superAdmin) {
        setUser({
          id: authUser.id,
          email: superAdmin.email,
          name: superAdmin.name,
          role: "super_admin",
          firmId: null,
          clientId: null,
        });
        setLoading(false);
        return;
      }

      // Check firm_members (staff)
      const { data: member } = await supabase
        .from("firm_members")
        .select("name, role, firm_id")
        .eq("user_id", authUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (member) {
        setUser({
          id: authUser.id,
          email: authUser.email ?? "",
          name: member.name,
          role: member.role as "admin" | "staff",
          firmId: member.firm_id,
          clientId: null,
        });
        setLoading(false);
        return;
      }

      // Check client_users (portal user)
      const { data: clientUser } = await supabase
        .from("client_users")
        .select("name, client_id")
        .eq("user_id", authUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (clientUser) {
        setUser({
          id: authUser.id,
          email: authUser.email ?? "",
          name: clientUser.name,
          role: "client",
          firmId: null,
          clientId: clientUser.client_id,
        });
        setLoading(false);
        return;
      }

      // 認証済みだが、どのテーブル（super_admins / firm_members / client_users）にも
      // 未割当のユーザーには、アプリ上のロールを一切付与しない（client への暗黙昇格を廃止）。
      // 以前は role:"client" を割り当てており、未割当ユーザーが顧問先扱いになる穴があった。
      setUser(null);
      setLoading(false);
    }

    // Get initial session
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (authUser) {
        loadUser(authUser);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(session.user);
      } else {
        setUser(null);
        setRawUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    setUser(null);
    setRawUser(null);
    setCurrentUserId(null);
  }

  return (
    <AuthContext.Provider value={{ user, rawUser, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
