import { LayoutDashboard, Share2, ScrollText, ShieldCheck } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const features = [
  {
    title: "Interactive Dashboard",
    description:
      "Visualize your sleep, heart rate, activity, and readiness data with beautiful, interactive charts.",
    icon: LayoutDashboard,
  },
  {
    title: "Secure Sharing",
    description:
      "Share specific metrics with your doctor or coach via time-limited, revocable links. No account needed to view.",
    icon: Share2,
  },
  {
    title: "Complete Audit Trail",
    description:
      "See exactly who accessed your data, when, and what they viewed. Full transparency, always.",
    icon: ScrollText,
  },
  {
    title: "You're in Control",
    description:
      "Revoke access instantly, export all your data, or delete your account at any time. Your data, your rules.",
    icon: ShieldCheck,
  },
] as const;

export function Features() {
  return (
    <section className="bg-muted/50 px-4 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to own your health data
          </h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Totus gives you a secure, private vault for your wearable health
            data with powerful visualization and sharing tools.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="bg-background border-border/50 transition-shadow hover:shadow-md"
            >
              <CardHeader>
                <div className="bg-primary/10 text-primary mb-3 flex size-10 items-center justify-center rounded-lg">
                  <feature.icon className="size-5" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
                <CardDescription className="text-sm">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
