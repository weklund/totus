"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CallToAction() {
  return (
    <section className="px-4 py-20 md:py-28">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        viewport={{ once: true }}
        className="mx-auto max-w-3xl rounded-3xl bg-gradient-to-br from-[var(--totus-ocean)] to-[#14405a] px-8 py-14 text-center text-white md:px-16"
      >
        <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to see your health data in one place?
        </h2>
        <p className="mb-8 text-lg text-white/70">
          Free during early access. Connect your Oura Ring in 30 seconds.
        </p>
        <Button
          size="lg"
          className="rounded-full bg-[var(--totus-coral)] px-10 text-base text-white hover:bg-[var(--totus-coral)]/90"
          asChild
        >
          <Link href="/sign-up">
            Get started free
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </motion.div>
    </section>
  );
}
