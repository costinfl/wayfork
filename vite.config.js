import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `base` must match the GitHub Pages project path: https://<user>.github.io/wayfork/
// The preview deploy overrides it (VITE_BASE=/wayfork/v2/) to publish into a
// subfolder next to the live site — see .github/workflows/deploy.yml.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || "/wayfork/",
});
