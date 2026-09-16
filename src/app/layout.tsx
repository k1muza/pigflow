import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PigFlow — Piggery cashflow planner",
  description:
    "A transparent piggery planning model connecting herd performance, feed conversion and operating costs to monthly cashflow.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
