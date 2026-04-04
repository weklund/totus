"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spotlight } from "@/components/ui/spotlight";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay, ease: "easeOut" as const },
  }),
};

export function Hero() {
  return (
    <Spotlight className="w-full">
      <section className="flex flex-col items-center justify-center gap-8 px-4 py-24 text-center md:py-32 lg:py-40">
        {/* Badge */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0}
          className="bg-primary/10 text-primary flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
        >
          <Heart className="size-4" />
          <span>Your health data, your control</span>
        </motion.div>

        {/* Headline — word-by-word reveal */}
        <TextGenerateEffect
          words="Your Personal Health Data Vault"
          highlight="Health Data Vault"
          className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        />

        {/* Subtitle */}
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.5}
          className="text-muted-foreground max-w-2xl text-lg md:text-xl"
        >
          Securely store, visualize, and share your Oura Ring health data. Keep
          full control over who sees what, when, and for how long.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.7}
          className="flex flex-col gap-4 sm:flex-row"
        >
          <Button size="lg" className="text-base" asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
          <Button size="lg" variant="outline" className="text-base" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </motion.div>
      </section>
    </Spotlight>
  );
}
