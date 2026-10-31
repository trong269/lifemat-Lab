/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        accent: {
          50: "#eef5fd", 100: "#d8e8fa", 200: "#b3d1f4", 300: "#82b2ec", 400: "#4f8fe0",
          500: "#2a78d6", 600: "#1f62b6", 700: "#1b4f92", 800: "#1a4377", 900: "#1a3962", 950: "#0f2440",
        },
      },
    },
  },
  plugins: [],
};
