# Repository Guidelines

## Project Structure & Module Organization

Little Days is a browser-only bilingual journaling app built with React 19, TypeScript, and Vite. `src/main.tsx` mounts the app; `src/App.tsx` coordinates journal interactions. Keep persistence, backup validation, and calendar logic in `src/journal.ts`, provider requests and response validation in `src/ai.ts`, and shared types in `src/types.ts`. Reusable UI lives in `src/components/`; styling lives in `src/styles.css`. Tests sit beside source files. `docs/` contains design and model research; consult `docs/diary-design.md` when changing journaling behavior. `dist/` is generated output.

## Build, Test, and Development Commands

Use Node.js 22.12+; Node.js 24 matches CI.

- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start Vite with LAN access enabled.
- `npm test`: run all Vitest tests once.
- `npm test -- src/ai.test.ts`: run a focused test file.
- `npm run build`: run TypeScript checks and build `dist/`.
- `npm run preview`: serve the production build locally.

The Pages workflow tests and builds before deployment from `main`.

## Coding Style & Naming Conventions

Follow existing TypeScript conventions: two-space indentation, single quotes, semicolons, and strict typing. Use PascalCase for React components, camelCase for functions and variables, and uppercase names for storage-key constants. Use type-only imports for shared types. Keep changes consistent with neighboring code; no dedicated lint or formatting tool is configured.

## Testing Guidelines

Use Vitest with jsdom and React Testing Library. Name colocated tests `*.test.ts` or `*.test.tsx`; the root `tests/` directory is outside configured discovery. Add behavioral regression tests for storage safety, date boundaries, AI failures, and UI recovery. Mock provider responses and reset browser state between tests. No coverage threshold is configured. Run tests and build before submitting code. Follow the README's restriction against Playwright and Superpowers; report real-provider and mobile-browser validation separately.

## Commit & Pull Request Guidelines

History uses concise imperative subjects such as “Add diary memory feature” and “Configure GitHub Pages deployment.” Follow that style. Describe behavior changes, link relevant issues, report validation, and include screenshots for visual changes.

## Security & Configuration

Keep API keys and diary backups out of Git. Preserve explicit opt-in for key persistence, localStorage data protection, and manual retries for paid AI requests. Send historical context only under the documented memory settings.

<!-- postman-cli:installation:start -->
Postman CLI is installed on this device, and can be used for API Engineering work.
<!-- postman-cli:installation:end -->
