import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Engine",
  description: "AI-driven resume tailoring and cover letter generation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
