import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const tcgplayerProxy = {
  "/api/pull-list-jobs": {
    target: "https://card-list-formatter.vercel.app",
    changeOrigin: true,
  },
  "/tcgplayer-details-api": {
    target: "https://mp-search-api.tcgplayer.com",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/tcgplayer-details-api/, ""),
  },
  "/tcgplayer-pricepoints-api": {
    target: "https://mpapi.tcgplayer.com",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/tcgplayer-pricepoints-api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: tcgplayerProxy },
  preview: { proxy: tcgplayerProxy },
});
