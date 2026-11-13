# Documentation website

An Astro static website with MDX pages, styled after the supplied documentation reference. The website is independent of the account backend and does not access the vault, credentials, or daemon.

## Development

```bash
bun install --cwd website --frozen-lockfile
bun run docs:dev
```

Open `http://localhost:4321`. From inside this directory, use `bun run dev`.

## Editing

Edit content in `src/pages/*.mdx`. Each page declares its title, description, and shared layout in frontmatter. Add navigation entries in `src/navigation.ts`. The right-hand table of contents is generated from rendered second-level headings. Update web pages when the corresponding repository documentation changes.

The layout includes page search (titles and descriptions), a keyboard shortcut (Ctrl/Cmd+K), code and page copy controls, a persistent theme selector, and a mobile navigation drawer. All content is English, following repository policy. Search is local and does not send queries to a service.

## Build and validation

The production URL is `https://codex-accounts.eduardoaugusto.work`, configured through Astro's `site` option and canonical links. Hosting domain assignment and authoritative DNS must also be configured with the selected providers; the Astro setting alone does not publish the site or create DNS records.

```bash
bun run docs:build
bun run docs:preview
```

The build generates seven static routes in `website/dist/`; deploy that directory to a static host. No backend environment variables are needed. Build validation was completed on 2026-11-13. Browser interaction and visual checks should be performed before publication.

## GitHub Pages and Cloudflare DNS

`.github/workflows/docs.yml` builds and deploys the documentation when `website/` changes on `main`, or when manually dispatched. In repository **Settings → Pages**, select **GitHub Actions** and set the custom domain to `codex-accounts.eduardoaugusto.work`.

In Cloudflare's DNS page for `eduardoaugusto.work`, configure this record:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `codex-accounts` | `eduardoaugustolb.github.io` | DNS only |

Use automatic TTL. The CNAME target excludes the repository name. Preserve all unrelated DNS records. After GitHub validates DNS and provisions its certificate, enable **Enforce HTTPS** in Pages settings. `public/CNAME` is included in the generated static output; the GitHub Pages domain setting remains authoritative for Actions deployments.

## Icons

Interface icons use the regular-weight SVG assets from `@phosphor-icons/core` (MIT), rendered inline through `src/components/Icon.astro`. Import only the icons the interface uses; no icon font or external CDN is required. Decorative SVGs are hidden from assistive technology, and icon-only controls keep accessible labels.

## Brand asset

`public/brand/codex-accounts-logo.png` is the generated Codex Accounts logo used in the documentation header, PNG favicon, and Apple touch icon. The header adapts it to the light theme through CSS. The original concept is retained alongside the selected asset.

Documentation navigation uses one header bar and the sidebar. Previous/next links follow the order in `src/navigation.ts`; the first and last pages show only the available direction.
