import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
  className,
}: ProgressBarProps) {
  const percent = Math.min(Math.round((value / max) * 100), 100);
  const colorClass =
    percent >= 80
      ? "bg-success"
      : percent >= 40
        ? "bg-warning"
        : "bg-destructive";

  return (
    <div className={cn("w-full", className)}>
      {(label || showPercent) && (
        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
          {label && <span>{label}</span>}
          {showPercent && <span>{percent}%</span>}
        </div>
      )}
      <div className="w-full bg-muted/40 h-1.5 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
