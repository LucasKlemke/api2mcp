import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em dev, /api e /mcp vão para `api2mcp ui` (src/web/server.ts)
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  // a interface vai junto com o pacote npm, servida por `api2mcp ui`
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4100",
      "/mcp": "http://localhost:4100",
    },
  },
});
