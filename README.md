# Grey FMS — LD Silk Mills

Internal grey-fabric management system for LD Silk Mills. Built with **Next.js 15
(App Router)** + **TypeScript**, styled with the in-house **"selvedge"** design
system, and backed (later) by **Supabase**.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start the dev server (hot reload)    |
| `npm run build` | Production build                     |
| `npm run start` | Serve the production build           |
| `npm run lint`  | Lint with Next's ESLint config       |

## Project structure

```
src/
  app/                 # routes (App Router) — one folder per screen
    layout.tsx         # root layout: fonts, theme bootstrap, app shell
    page.tsx           # Dashboard (/)
    <section>/page.tsx # one page per nav item
  components/
    shell/             # AppShell, Sidebar, TopBar (the chrome)
    theme/             # ThemeProvider (light/dark, persisted)
    ui/                # Icon set, PagePlaceholder
  lib/
    nav.ts             # single source of truth for sidebar navigation
  styles/
    tokens.css         # selvedge design tokens (light + dark)
    shell.css          # app shell + component styles
```

## Design system

This app follows the **selvedge** style. Key rules:

- **Sora** for all text; **JetBrains Mono** only for numbers in tables / metric cards.
- Indigo (`--primary`) + teal (`--teal`) brand, with an indigo→teal "selvedge"
  gradient on accents. **All colors are semantic CSS variables** in
  `src/styles/tokens.css` — never hardcode a color.
- Light (default) + dark themes via a top-bar toggle. The choice is persisted and
  applied before paint (no flash).
- Respects `prefers-reduced-motion`.

## Backend (not yet connected)

Supabase project details live in `.env.local` (gitignored; see `.env.example`).
The database is **not** wired up yet — this milestone is navigation + layout only.

## Environment variables

| Variable                        | Purpose                                  |
| ------------------------------- | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (browser-safe)      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key (browser-safe)  |
