import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  server: { port: 4200, strictPort: true, host: "127.0.0.1" },
  // One copy each: a second reactor-browser would not see the same window.ph brands.
  resolve: { dedupe: ["react", "react-dom", "@powerhousedao/reactor-browser", "document-model"] },
});
