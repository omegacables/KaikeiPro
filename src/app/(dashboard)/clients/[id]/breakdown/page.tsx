"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getBreakdownDefaultKey } from "@/actions/breakdown";

// 年度を指定せずに開いたときは、直前に終わった事業年度の一覧へ移す
export default function BreakdownIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBreakdownDefaultKey(id)
      .then((key) => router.replace(`/clients/${id}/breakdown/${key}`))
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id, router]);

  if (error) {
    return (
      <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        {error}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center py-20 text-[17px]">
      <Loader2 className="size-5 animate-spin mr-2" />
      読み込み中...
    </div>
  );
}
