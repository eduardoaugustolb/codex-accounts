import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
export default defineConfig({
  site: "https://codex-accounts.eduardoaugusto.work",
  integrations: [mdx()],
});
