import { LandingHeader } from "@/components/landing/LandingHeader";
import { Hero } from "@/components/landing/Hero";
import { ProductDemo } from "@/components/landing/ProductDemo";
import { TrustStrip } from "@/components/landing/TrustStrip";
import { CallToAction } from "@/components/landing/CallToAction";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <ProductDemo />
        <TrustStrip />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
