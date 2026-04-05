import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@totus/design-system";

export function LandingHeader() {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center">
          <Logo height={22} variant="auto" />
        </Link>

        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
