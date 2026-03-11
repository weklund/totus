import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";

export function Hero() {
  return (
    <section className="flex flex-col items-center justify-center gap-8 px-4 py-24 text-center md:py-32 lg:py-40">
      <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium">
        <Heart className="size-4" />
        <span>Your health data, your control</span>
      </div>

      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
        Your Personal <span className="text-primary">Health Data Vault</span>
      </h1>

      <p className="text-muted-foreground max-w-2xl text-lg md:text-xl">
        Securely store, visualize, and share your Oura Ring health data. Keep
        full control over who sees what, when, and for how long.
      </p>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Button size="lg" className="text-base" asChild>
          <Link href="/sign-up">Get Started</Link>
        </Button>
        <Button size="lg" variant="outline" className="text-base" asChild>
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    </section>
  );
}
