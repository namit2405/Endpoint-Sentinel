"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: number | null;
  indicatorClassName?: string;
}) {
  const normalizedValue = Math.min(100, Math.max(0, value ?? 0));

  return (
    <div
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className,
      )}
      role="progressbar"
      aria-valuenow={normalizedValue}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
      >
      <div
        data-slot="progress-indicator"
        className={cn(
          "bg-primary h-full rounded-full transition-all",
          indicatorClassName,
        )}
        style={{
          width: `${normalizedValue}%`,
        }}
      />
    </div>
  );
}

export { Progress };
