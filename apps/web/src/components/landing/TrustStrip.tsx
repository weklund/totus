"use client";

import { motion } from "framer-motion";
import { Shield, EyeOff, ClipboardList, Trash2 } from "lucide-react";

const items = [
  { icon: Shield, label: "AES-256 encrypted" },
  { icon: EyeOff, label: "Zero ads, zero data sales" },
  { icon: ClipboardList, label: "Full audit log" },
  { icon: Trash2, label: "Delete anytime" },
];

export function TrustStrip() {
  return (
    <section className="px-4 py-10">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        viewport={{ once: true }}
        className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-6 rounded-2xl border border-[var(--totus-mist)] bg-[var(--totus-cloud)] px-6 py-5 md:gap-10 dark:border-[#2a3a4a] dark:bg-[#0f1824]"
      >
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <item.icon className="size-4 text-[var(--totus-emerald)]" />
            <span className="text-sm font-medium text-[var(--totus-ink)] dark:text-[var(--totus-cloud)]">
              {item.label}
            </span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
