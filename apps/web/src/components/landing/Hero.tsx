"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "./DashboardPreview";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const perspective = useTransform(scrollYProgress, [0, 0.5], [12, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [0.92, 1]);

  return (
    <section ref={sectionRef} className="relative px-4 pt-20 pb-8 md:pt-28">
      {/* Subtle dot grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--totus-ocean) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative mx-auto max-w-5xl text-center">
        {/* Minimal headline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-4 inline-flex rounded-full bg-[var(--totus-ocean-tint)] px-4 py-1.5 text-sm font-medium text-[var(--totus-ocean)]"
        >
          Your health data, finally in one place
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="mx-auto mb-5 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        >
          All your health data. One vault.{" "}
          <span className="text-[var(--totus-ocean)]">You hold the keys.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mx-auto mb-8 max-w-xl text-lg text-[var(--totus-slate)]"
        >
          Connect your Oura Ring (CGM and Garmin coming soon). See trends across
          months and years. Share a secure link with your doctor or coach — it
          expires when you want.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mb-12 flex justify-center gap-3"
        >
          <Button
            size="lg"
            className="rounded-full bg-[var(--totus-coral)] px-8 text-base text-white hover:bg-[var(--totus-coral)]/90"
            asChild
          >
            <Link href="/sign-up">
              Get started free
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </motion.div>

        {/* Product preview with perspective tilt */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          style={{
            rotateX: perspective,
            scale,
            transformPerspective: "1200px",
          }}
        >
          <DashboardPreview />
        </motion.div>
      </div>
    </section>
  );
}
