import { Logo } from "@/components/site/logo";

/** Static header with the same height as Nav, shown while the route-aware nav streams in. */
export function NavFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6">
        <Logo />
      </div>
    </header>
  );
}
