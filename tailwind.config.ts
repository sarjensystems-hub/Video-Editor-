import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-bricolage)", "system-ui", "sans-serif"],
      },
      colors: {
        /* ── Design token colours (referenced by CSS var) ── */
        canvas: {
          DEFAULT: "var(--bg)",
          subtle:  "var(--bg-subtle)",
          muted:   "var(--bg-muted)",
        },
        wall: {
          DEFAULT: "var(--wall)",
          hover:   "var(--wall-hover)",
          active:  "var(--wall-active)",
          edge:    "var(--wall-edge)",
        },
        panel: {
          DEFAULT: "var(--surface)",
          raised:  "var(--surface-2)",
        },
        edge: {
          DEFAULT: "var(--edge)",
          faint:   "var(--edge-faint)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          muted:   "var(--ink-muted)",
          faint:   "var(--ink-faint)",
        },
        chalk: {
          DEFAULT: "var(--chalk)",
          dim:     "var(--chalk-dim)",
        },
        fire: {
          DEFAULT: "var(--fire)",
          hover:   "var(--fire-hover)",
          wash:    "var(--fire-wash)",
        },
        field: {
          DEFAULT: "var(--field)",
          edge:    "var(--field-edge)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          wash:    "var(--danger-wash)",
        },
        success: {
          DEFAULT: "var(--success)",
          wash:    "var(--success-wash)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          wash:    "var(--warning-wash)",
        },
        select: {
          DEFAULT: "var(--select)",
          wash:    "var(--select-wash)",
          ink:     "var(--select-ink)",
        },
        stage: {
          DEFAULT: "var(--stage)",
          frame:   "var(--stage-frame)",
        },
        sheet: {
          DEFAULT: "var(--sheet)",
          grip:    "var(--sheet-grip)",
        },
        overlay: "var(--overlay)",

        /* ── Brand orange (legacy + landing-page builder) ── */
        brand: {
          50:  "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea6c0a",
          700: "#c2550a",
          900: "#7c2d12",
        },
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      keyframes: {
        "btn-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(249,115,22,0.35)" },
          "50%":       { boxShadow: "0 0 0 6px rgba(249,115,22,0)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to:   { transform: "translateX(0)" },
        },
      },
      animation: {
        "btn-glow":      "btn-glow 1.8s ease-in-out infinite",
        "fade-in":       "fade-in 0.2s ease-out",
        "slide-in-left": "slide-in-left 0.2s ease-out",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
export default config;
