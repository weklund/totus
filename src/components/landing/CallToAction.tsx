import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CallToAction() {
  return (
    <section className="bg-muted/50 px-4 py-20 md:py-28">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to take control of your health data?
        </h2>
        <p className="text-muted-foreground mt-4 text-lg">
          Join Totus today and start securely managing, visualizing, and sharing
          your health insights.
        </p>
        <div className="mt-8">
          <Button size="lg" className="text-base" asChild>
            <Link href="/sign-up">Get Started — It&apos;s Free</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
