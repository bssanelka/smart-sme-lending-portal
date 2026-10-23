import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold outline-none transition-[background-color,color,transform,box-shadow] duration-fast ease-standard disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.45] focus-visible:shadow-focus aria-invalid:ring-2 aria-invalid:ring-destructive/20 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-brand-red-hover text-content-inverse hover:bg-brand-red-pressed active:bg-brand-red-pressed",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-brand-red-pressed active:bg-brand-red-pressed",
        outline:
          "border border-border-strong bg-background text-foreground hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-brand-black text-content-inverse hover:bg-[#292929] active:bg-black",
        ghost:
          "text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 rounded-control px-5 text-base has-[>svg]:px-4",
        sm: "h-11 rounded-alfa-sm px-4 text-sm has-[>svg]:px-3",
        lg: "h-14 rounded-control-lg px-7 text-base has-[>svg]:px-5",
        icon: "size-12 rounded-control",
        "icon-sm": "size-11 rounded-alfa-sm",
        "icon-lg": "size-14 rounded-control-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
