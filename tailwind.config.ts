import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Core surfaces — near-black with a cold blue cast.
        void: {
          950: "#04060a",
          900: "#070a10",
          850: "#0a0e15",
          800: "#0e131b",
          700: "#151b25",
          600: "#1d2532",
        },
        // Ostra signal colour (mint/teal) — used for system status + primary actions.
        signal: {
          50: "#e8fff7",
          200: "#9df5d6",
          300: "#6ee9c2",
          400: "#3fd8a8",
          500: "#1fbf8f",
          600: "#129a73",
          700: "#0d7a5c",
        },
        // Amber for "prototype / not yet wired" affordances.
        ember: {
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -30px rgba(0,0,0,0.9)",
        "signal-glow": "0 0 0 1px rgba(63,216,168,0.35), 0 12px 40px -16px rgba(63,216,168,0.45)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseRing: {
          "0%": { opacity: "0.9", transform: "scale(0.8)" },
          "70%": { opacity: "0", transform: "scale(2.2)" },
          "100%": { opacity: "0", transform: "scale(2.2)" },
        },
        orbit: {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "dot-bounce": {
          "0%, 80%, 100%": { opacity: "0.25", transform: "translateY(0)" },
          "40%": { opacity: "1", transform: "translateY(-3px)" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulseRing 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        orbit: "orbit 14s linear infinite",
        "dot-bounce": "dot-bounce 1.2s ease-in-out infinite",
        sweep: "sweep 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
