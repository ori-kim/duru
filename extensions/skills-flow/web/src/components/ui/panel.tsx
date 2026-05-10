import type * as React from "react";
import { cn } from "../../lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm", className)} {...props} />;
}
