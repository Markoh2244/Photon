import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12263a",
        mist: "#f4f1ea",
        clay: "#c45c26",
      },
    },
  },
  plugins: [],
};

export default config;
