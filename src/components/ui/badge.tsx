import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        success: "bg-green-500/10 text-green-500",
        warning: "bg-warning/10 text-warning",
        destructive: "bg-destructive/10 text-destructive",
        muted: "bg-muted/50 text-muted-foreground",
        accent: "bg-accent/10 text-accent",
        info: "bg-blue-500/10 text-blue-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
