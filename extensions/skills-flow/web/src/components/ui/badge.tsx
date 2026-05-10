import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-normal",
  {
    variants: {
      variant: {
        default: "border-zinc-200 bg-zinc-50 text-zinc-600",
        valid: "border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border-orange-200 bg-orange-50 text-orange-700",
        invalid: "border-red-200 bg-red-50 text-red-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
