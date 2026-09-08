import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const packageVersion = (JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }).version;

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
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [react()],
  server: { proxy: tcgplayerProxy },
  preview: { proxy: tcgplayerProxy },
});
