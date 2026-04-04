"use client";

import { useEffect } from "react";
import { motion, stagger, useAnimate } from "framer-motion";
import { cn } from "@/lib/cn";

interface TextGenerateEffectProps {
  words: string;
  className?: string;
  /** Highlighted segment — rendered with text-primary */
  highlight?: string;
}

/**
 * TextGenerateEffect — word-by-word fade-in for headlines.
 * Inspired by Aceternity UI.
 */
export function TextGenerateEffect({
  words,
  className,
  highlight,
}: TextGenerateEffectProps) {
  const [scope, animate] = useAnimate();
  const wordArray = words.split(" ");

  // Compute which word indices fall inside the highlight phrase
  const highlightWords = highlight ? highlight.split(" ") : [];
  const highlightStartIdx = highlight
    ? wordArray.findIndex((_, i) =>
        highlightWords.every((hw, hi) => wordArray[i + hi] === hw),
      )
    : -1;
  const highlightEndIdx =
    highlightStartIdx >= 0 ? highlightStartIdx + highlightWords.length : -1;

  useEffect(() => {
    animate(
      "span",
      { opacity: 1, filter: "blur(0px)" },
      { duration: 0.4, delay: stagger(0.06) },
    );
  }, [animate]);

  return (
    <motion.h1
      ref={scope}
      className={cn("flex flex-wrap justify-center", className)}
    >
      {wordArray.map((word, idx) => {
        const isHighlighted = idx >= highlightStartIdx && idx < highlightEndIdx;

        return (
          <span
            key={`${word}-${idx}`}
            className={cn(
              "mr-[0.25em] inline-block opacity-0",
              isHighlighted ? "text-primary" : "",
            )}
            style={{ filter: "blur(8px)" }}
          >
            {word}
          </span>
        );
      })}
    </motion.h1>
  );
}
