import { Link2, BarChart3, Share } from "lucide-react";

const steps = [
  {
    step: 1,
    title: "Connect",
    description:
      "Link your Oura Ring with one click. Your data is encrypted and stored securely in your personal vault.",
    icon: Link2,
  },
  {
    step: 2,
    title: "Visualize",
    description:
      "Explore your sleep, heart rate, HRV, and activity trends with interactive charts and smart insights.",
    icon: BarChart3,
  },
  {
    step: 3,
    title: "Share",
    description:
      "Create secure, time-limited links to share specific metrics with your healthcare providers.",
    icon: Share,
  },
] as const;

export function HowItWorks() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Get started in three simple steps
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((item) => (
            <div
              key={item.step}
              className="flex flex-col items-center text-center"
            >
              <div className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-full text-lg font-bold">
                {item.step}
              </div>
              <div className="text-primary mb-2">
                <item.icon className="mx-auto size-6" />
              </div>
              <h3 className="mb-2 text-xl font-semibold">{item.title}</h3>
              <p className="text-muted-foreground text-sm">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
