import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  'h-5 gap-1 rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-2.5! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive: 'bg-destructive/10 [a]:hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive dark:bg-destructive/20',
        success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        warning: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        info: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
        muted: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground bg-input/20 dark:bg-input/30',
        ghost: 'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
