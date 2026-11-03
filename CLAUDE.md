# feel-the-notion

Obsidian plugin (TypeScript) providing Notion-style block editing, folder notes (`Folder/Folder.md`), page icons and covers, sub-pages, and templates.

## CRITICAL: Obsidian Vault Access & Installation

- **NEVER access the user's Obsidian vault.** Do not read, list, search, or modify any files in the vault or read `OBSIDIAN_VAULT` from `.env`.
- **NEVER install or update the plugin in the vault yourself.** Do not run `just install` or `~/Code/Scripts/new-mac-setup/user/obsidian_feel_the_notion.nu`. Installing or updating the plugin in the vault must ONLY be done by the user running `just install` themselves.

## Commands

Run from the repo root (uses `npm`, not `pnpm`, so `overrides` keeps a single `@codemirror/state` instance):

- `just verify` — runs typecheck/lint, production build, and unit tests
- `just lint` / `just check` — runs `tsc --noEmit --skipLibCheck` (with strict unused/return checks) and bundle check
- `just test` — compiles pure modules into `test/.build` and runs `node --test test/*.test.mjs`
- `just build` — builds `main.js` in the repo root (`npm run build`)
- `just install` — **user-only**: builds and copies `main.js`, `manifest.json`, and `styles.css` into the Obsidian vault

## Architecture

- Pure, DOM-free and Obsidian-free logic lives in standalone modules (`src/folderNotes.ts`, `src/explorerOrder.ts`, `src/pageMeta.ts`, `src/insertPlan.ts`, etc.) and is unit-tested in `test/*.test.mjs` (registered in `scripts/build-tests.mjs`).
- Obsidian and CodeMirror 6 integration lives in view/glue modules (`src/folderNoteView.ts`, `src/explorerSort.ts`, `src/explorerDecor.ts`, `src/pageHeader.ts`, `src/pageLinkView.ts`, etc.).
