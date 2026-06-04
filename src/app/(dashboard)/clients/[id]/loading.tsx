import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-sm">読み込み中...</span>
    </div>
  );
}
