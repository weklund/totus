"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  Share2,
  ShieldCheck,
  Check,
  Copy,
  Eye,
  Clock,
} from "lucide-react";

interface DemoStep {
  step: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  visual: React.ReactNode;
}

function VisualizeVisual() {
  return (
    <div className="space-y-3">
      {/* Metric pills */}
      <div className="flex flex-wrap gap-1.5">
        {["Sleep Score", "HRV", "Resting HR", "Steps", "Readiness"].map(
          (m, i) => (
            <span
              key={m}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                i < 3
                  ? "bg-[var(--totus-ocean)] text-white"
                  : "bg-[var(--totus-mist)] text-[var(--totus-slate)] dark:bg-[#1e2d3d]"
              }`}
            >
              {m}
            </span>
          ),
        )}
      </div>
      {/* Chart placeholder bars */}
      <div className="flex items-end gap-1 pt-2">
        {Array.from({ length: 20 }).map((_, i) => {
          const height = 20 + Math.sin(i * 0.5) * 15 + Math.random() * 10;
          return (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              whileInView={{ height }}
              transition={{ duration: 0.5, delay: i * 0.03 }}
              viewport={{ once: true }}
              className="flex-1 rounded-t bg-[var(--totus-emerald)]"
              style={{ opacity: 0.3 + (height / 45) * 0.7 }}
            />
          );
        })}
      </div>
      <p className="text-center text-xs text-[var(--totus-slate)]">
        30 days of sleep score trend
      </p>
    </div>
  );
}

function ShareVisual() {
  return (
    <div className="space-y-3">
      {/* Share modal mock */}
      <div className="rounded-lg border border-[var(--totus-mist)] bg-white p-3 dark:border-[#2a3a4a] dark:bg-[#1a2332]">
        <p className="mb-2 text-xs font-semibold text-[var(--totus-ink)] dark:text-[var(--totus-cloud)]">
          Share with Dr. Patel
        </p>
        <div className="mb-2 space-y-1.5">
          {["Sleep Score", "HRV", "Resting HR"].map((m) => (
            <div key={m} className="flex items-center gap-2">
              <div className="flex size-4 items-center justify-center rounded border border-[var(--totus-ocean)] bg-[var(--totus-ocean)]">
                <Check className="size-3 text-white" />
              </div>
              <span className="text-xs text-[var(--totus-ink)] dark:text-[var(--totus-cloud)]">
                {m}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--totus-slate)]">
          <Clock className="size-3" />
          Expires in 7 days
        </div>
      </div>
      {/* Copy link */}
      <motion.div
        initial={{ opacity: 0.5 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="flex items-center gap-2 rounded-lg bg-[var(--totus-emerald-tint)] px-3 py-2"
      >
        <Copy className="size-3 text-[var(--totus-emerald)]" />
        <span className="flex-1 truncate font-mono text-[11px] text-[var(--totus-emerald)]">
          totus.com/v/a3k9x2m
        </span>
        <span className="text-[10px] font-semibold text-[var(--totus-emerald)]">
          Copied!
        </span>
      </motion.div>
    </div>
  );
}

function ControlVisual() {
  const entries = [
    {
      icon: Eye,
      who: "Dr. Patel",
      action: "Viewed sleep + HRV",
      time: "2m ago",
      color: "var(--totus-ocean)",
    },
    {
      icon: Eye,
      who: "Coach Kim",
      action: "Viewed readiness",
      time: "1d ago",
      color: "var(--totus-ocean)",
    },
    {
      icon: ShieldCheck,
      who: "You",
      action: "Revoked Dr. Patel link",
      time: "Just now",
      color: "var(--totus-coral)",
    },
  ];
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -15 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.15, duration: 0.4 }}
          viewport={{ once: true }}
          className="flex items-center gap-3 rounded-lg border border-[var(--totus-mist)] bg-white px-3 py-2 dark:border-[#2a3a4a] dark:bg-[#1a2332]"
        >
          <entry.icon
            className="size-4 shrink-0"
            style={{ color: entry.color }}
          />
          <div className="flex-1">
            <span className="text-xs font-medium text-[var(--totus-ink)] dark:text-[var(--totus-cloud)]">
              {entry.who}
            </span>
            <span className="mx-1.5 text-[10px] text-[var(--totus-slate)]">
              {entry.action}
            </span>
          </div>
          <span className="shrink-0 text-[10px] text-[var(--totus-slate)]">
            {entry.time}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const steps: DemoStep[] = [
  {
    step: 1,
    icon: <BarChart3 className="size-5" />,
    title: "Visualize everything",
    subtitle:
      "Sleep, HRV, heart rate, steps, readiness — see months and years of trends in interactive charts.",
    color: "var(--totus-emerald)",
    visual: <VisualizeVisual />,
  },
  {
    step: 2,
    icon: <Share2 className="size-5" />,
    title: "Share with one link",
    subtitle:
      "Pick exactly which metrics and dates to share. Your doctor opens a clean viewer — no account needed.",
    color: "var(--totus-ocean)",
    visual: <ShareVisual />,
  },
  {
    step: 3,
    icon: <ShieldCheck className="size-5" />,
    title: "Stay in control",
    subtitle:
      "Every view is logged. Revoke any link instantly. Export or delete your data at any time.",
    color: "var(--totus-coral)",
    visual: <ControlVisual />,
  },
];

export function ProductDemo() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Three steps to{" "}
            <span className="text-[var(--totus-ocean)]">own your data</span>
          </h2>
        </motion.div>

        <div className="space-y-16 md:space-y-24">
          {steps.map((step, i) => (
            <DemoStepRow key={step.step} step={step} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoStepRow({ step, index }: { step: DemoStep; index: number }) {
  const isEven = index % 2 === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true, margin: "-80px" }}
      className={`flex flex-col items-center gap-8 md:flex-row md:gap-12 ${
        isEven ? "" : "md:flex-row-reverse"
      }`}
    >
      {/* Text side */}
      <div className="flex-1 text-center md:text-left">
        <div
          className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold text-white"
          style={{ backgroundColor: step.color }}
        >
          {step.icon}
          Step {step.step}
        </div>
        <h3 className="mb-2 text-2xl font-bold md:text-3xl">{step.title}</h3>
        <p className="text-base leading-relaxed text-[var(--totus-slate)] md:text-lg">
          {step.subtitle}
        </p>
      </div>

      {/* Visual side */}
      <div className="w-full max-w-sm flex-1 rounded-2xl bg-[var(--totus-cloud)] p-5 dark:bg-[#0f1824]">
        {step.visual}
      </div>
    </motion.div>
  );
}
