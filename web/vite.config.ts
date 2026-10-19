import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El front vive en web/; el backend corre en PORT (8787 por defecto).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
