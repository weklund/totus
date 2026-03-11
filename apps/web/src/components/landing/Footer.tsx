import Link from "next/link";
import { Heart } from "lucide-react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t px-4 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 md:flex-row md:justify-between">
        <div className="flex items-center gap-2">
          <Heart className="text-primary size-4" />
          <span className="text-sm font-semibold">Totus</span>
        </div>

        <nav className="flex gap-6">
          <Link
            href="/sign-in"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Sign Up
          </Link>
        </nav>

        <p className="text-muted-foreground text-sm">
          &copy; {currentYear} Totus. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
