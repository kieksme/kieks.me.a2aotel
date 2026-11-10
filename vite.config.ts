import { defineConfig } from "vite";

// Die Demo ist eine rein statische Seite. Mit base "./" funktioniert sie
// unter jedem Pfad, also auf GitHub Pages genauso wie auf einem eigenen Server.
export default defineConfig({
  root: "demo",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true },
  // Die Demo bindet die Quelltexte aus ../src ein, statt sie zu kopieren.
  server: { fs: { allow: [".."] } },
});
