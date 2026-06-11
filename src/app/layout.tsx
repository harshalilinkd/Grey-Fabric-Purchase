import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/shell.css";
import "@/styles/components.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Providers } from "@/components/providers/Providers";

/* Sora is the ONLY font — body, headings, display text and figures. */
const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Grey FMS · LD Silk Mills",
  description: "Grey fabric management system for LD Silk Mills",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

/**
 * Runs before first paint to apply the saved theme + sidebar state to <html>,
 * so there's no flash of the wrong theme or an un-collapsed sidebar.
 */
const initScript = `
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem('grey-fms-theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    if (localStorage.getItem('grey-fms-sidebar') === 'collapsed') {
      root.classList.add('sb-collapsed');
    }
  } catch (e) {
    document.documentElement.classList.add('light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sora.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
