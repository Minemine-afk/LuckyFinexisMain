import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // Pages serves dist/ wholesale, so an emitted .map is published next to the
    // bundle and hands any visitor the full annotated source — 2 MB of it.
    // "hidden" would only drop the comment pointing at the file, which is not
    // the same as not shipping it. `npm run dev` still has full maps; a
    // production build does not need them until there is an error tracker to
    // upload them to privately.
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
