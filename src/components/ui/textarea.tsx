import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-14 w-full rounded-control border border-transparent bg-surface-subtle px-4 py-3 text-base text-foreground shadow-none outline-none transition-[background-color,border-color,color,box-shadow] duration-fast ease-standard placeholder:text-content-tertiary focus-visible:border-ring focus-visible:bg-background focus-visible:shadow-focus aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-input dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
