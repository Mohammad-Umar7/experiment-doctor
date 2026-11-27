import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "healthy";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_8px_24px_rgba(104,55,252,0.28)]",
  secondary: "bg-elevated text-fg border border-border hover:border-border-strong hover:bg-[#1d2230]",
  ghost: "text-fg-secondary hover:text-fg hover:bg-elevated",
  healthy: "bg-healthy text-canvas hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-[13px]",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-button)] font-medium " +
  "transition-[transform,background-color,border-color,color,filter] duration-[140ms] ease-[var(--ease-standard)] " +
  "hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: Common & Omit<ComponentProps<"button">, "children">) {
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  href,
  ...props
}: Common & Omit<ComponentProps<typeof Link>, "children" | "className">) {
  return (
    <Link href={href} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </Link>
  );
}
