import Link from "next/link";
import { Tv } from "lucide-react";

export default function WatchNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg">
      <Tv className="h-12 w-12 text-fg-subtle" />
      <h1 className="text-xl font-bold">Channel not found</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        This channel may have been removed or the link is invalid.
      </p>
      <Link
        href="/"
        className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[var(--accent-contrast)]"
      >
        Back to Home
      </Link>
    </div>
  );
}
