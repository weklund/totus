import type { Metadata } from "next";
import "./globals.css";
import { RootProviders } from "@/components/layout/RootProviders";

export const metadata: Metadata = {
  title: "Totus",
  description: "Your personal health data vault",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
