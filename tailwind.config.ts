import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2f6bff",
          dark: "#1f4ed8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
