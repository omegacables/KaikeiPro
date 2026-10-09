"use client";

/**
 * 自分のこの顧問先での役割（閲覧専用なら入力・修正の画面を出さないため）。
 * 同じ顧問先を何度も開いても問い合わせが1回で済むよう、画面の間で使い回す。
 * 書き込みの可否はデータベースでも止めているので、ここは表示の出し分けだけ。
 */
import { useEffect, useState } from "react";
import { getMyClientRole, type MyClientRole } from "@/actions/members";

const cache = new Map<string, Promise<MyClientRole>>();

export function useClientRole(clientId: string | null | undefined): MyClientRole | null {
  const [role, setRole] = useState<MyClientRole | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    let p = cache.get(clientId);
    if (!p) {
      p = getMyClientRole(clientId).catch(() => ({ kind: "none", role: "", canWrite: true, isOwner: false }) as MyClientRole);
      cache.set(clientId, p);
    }
    p.then((r) => alive && setRole(r));
    return () => {
      alive = false;
    };
  }, [clientId]);
  return role;
}
