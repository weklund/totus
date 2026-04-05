import Link from "next/link";
import { Logo } from "@totus/design-system";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t px-4 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 md:flex-row md:justify-between">
        <Logo height={18} variant="auto" />

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
