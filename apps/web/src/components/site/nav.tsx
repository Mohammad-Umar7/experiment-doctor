"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Logo } from "@/components/site/logo";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ease } from "@/lib/motion";
import { REPO_URL } from "@/lib/site";

const LINKS = [
  { href: "/play", label: "Human vs Doctor" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/rescue", label: "Rescue Center" },
  { href: "/report", label: "Doctor report" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  active ? "text-fg" : "text-fg-secondary hover:text-fg",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-md bg-elevated"
                    transition={{ duration: 0.3, ease: ease.smooth }}
                  />
                )}
                <span className="relative">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center rounded-md px-3 text-[13px] text-fg-secondary transition-colors hover:text-fg sm:flex"
          >
            GitHub
          </a>
          <ButtonLink href="/play" size="sm" className="max-sm:hidden">
            Challenge the Doctor
          </ButtonLink>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-md text-fg-secondary hover:text-fg md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
              <path
                d={open ? "M5 5l10 10M15 5L5 15" : "M3 6h14M3 10h14M3 14h14"}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: ease.smooth }}
            className="overflow-hidden border-t border-border md:hidden"
            aria-label="Mobile"
          >
            <div className="flex flex-col px-4 py-2">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex h-11 items-center text-sm",
                    pathname === link.href ? "text-fg" : "text-fg-secondary",
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex h-11 items-center text-sm text-fg-secondary">
                GitHub
              </a>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
