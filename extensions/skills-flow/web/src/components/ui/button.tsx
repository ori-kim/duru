import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-zinc-400/30",
  {
    variants: {
      variant: {
        default: "bg-zinc-950 text-white shadow-sm hover:bg-zinc-800",
        ghost: "bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
        soft: "border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50",
        active: "bg-zinc-100 text-zinc-950",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props} />;
}
