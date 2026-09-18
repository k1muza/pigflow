import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/hooks/use-auth";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const themeScript = `
try {
  var savedTheme = localStorage.getItem("pigflow-theme");
  var dark = savedTheme === "dark" ||
    (savedTheme === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch (_) {}
`;

export const metadata: Metadata = {
  title: "PigFlow — Piggery cashflow planner",
  description:
    "A transparent piggery planning model connecting herd performance, feed conversion and operating costs to monthly cashflow.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* One watch on who is signed in, shared by the planner and the login page. */}
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
