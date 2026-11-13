# Little Days Design

The user approved this design in the conversation and requested implementation in the current project. No Git actions are requested.

## Product

A personal, responsive English-learning journal with a Chinese interface. Daily mode has one entry per local calendar date; memory mode has independent experiences with editable titles. A warm paper-like visual language, forest green accents, serif English headings, desktop history sidebar and mobile history drawer.

Each conversation opens with a bilingual question. AI asks one gentle, context-aware English question at a time with Chinese assistance. Users answer in either language. Each answer retains its original text, followed by a natural English version. Incorrect English gets brief Chinese explanations; Chinese receives translation only. The app does not invent personal facts or force disclosure.

## Storage And Lifecycle

Use browser localStorage only for entries, input drafts and non-secret settings. Keys stay in component memory by default (refresh clears them); opt-in persistence stores keys locally with an explicit plaintext warning. Autosave all original answers before requesting AI. Detect and surface storage failures, preserving existing stored content rather than silently overwriting corrupt data. No cross-device sync; clearing site data deletes entries. Provide JSON export/import for user-controlled backups. Imported records are validated and merged by ID with daily-date uniqueness.

Archive only after successful AI generation of an English title and first-person summary based on the current entry. Retain the complete conversation. Archived entries may resume; resuming clears the stale summary. Editing an original regenerates its English version without deleting later conversation, reopens the entry, and clears stale summary. Retry failed responses without duplicating original answers. No fabricated AI translations or summaries when offline.

## AI Boundary

Call mainland DeepSeek and MiniMax directly from the browser using user-provided provider keys. No OpenAI service or SDK. Use fetch with Authorization Bearer and fixed HTTPS provider URLs. DeepSeek model deepseek-flash with thinking disabled and JSON mode. MiniMax model MiniMax-M3.1-Flash with reasoning_effort low, split reasoning, and prompt-enforced JSON validated locally. Timeout at 90 seconds; cancellation and malformed, truncated, authorization, balance, rate-limit, network/CORS responses produce actionable Chinese errors. Only the active entry is sent, never other journal history or drafts. Corrections send context up to the edited message. No automatic paid retry.

## Verification

Vitest covers daily uniqueness, local date, storage corruption/quota failures, backup validation/merging, key opt-in, provider request differences, current-entry privacy, response parsing and HTTP errors. React component tests use synthetic model responses to exercise conversation and recovery flows. Production build/typecheck must pass. No Playwright or Superpowers workflow is used for subsequent work, per user request. Live quality and authorized browser API compatibility remain unverified without user keys.
