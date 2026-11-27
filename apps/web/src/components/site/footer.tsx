import Link from "next/link";
import { LogoMark } from "@/components/site/logo";
import { REPO_URL } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <LogoMark className="h-6 w-6" />
          <p className="text-[13px] text-fg-muted">
            Built by Team FirstCommit for Toggle Wars, the Flagsmith Experimentation Hackathon.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-fg-secondary" aria-label="Footer">
          <Link className="hover:text-fg" href="/play">
            Play
          </Link>
          <Link className="hover:text-fg" href="/rescue">
            Rescue Center
          </Link>
          <Link className="hover:text-fg" href="/report">
            Report viewer
          </Link>
          <a className="hover:text-fg" href={REPO_URL} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a className="hover:text-fg" href="https://docs.flagsmith.com/experimentation" target="_blank" rel="noreferrer">
            Flagsmith Experimentation docs
          </a>
        </nav>
      </div>
    </footer>
  );
}
