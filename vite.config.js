import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // En dev local, proxy vers les fonctions Vercel
      "/api": "http://localhost:3000",
    },
  },
});
