# Little Days Design

The user approved this design in the conversation and requested implementation in the current project. No Git actions are requested.

## Product

A personal, responsive English-learning journal with a Chinese interface. Daily mode has one entry per local calendar date; memory mode has independent experiences with editable titles. A warm paper-like visual language, forest green accents, serif English headings, desktop history sidebar and mobile history drawer.

Each conversation opens with a bilingual question. AI asks one gentle, context-aware English question at a time with Chinese assistance. Users answer in either language. Each answer retains its original text, followed by a natural English version. Incorrect English gets brief Chinese explanations; Chinese receives translation only. The app does not invent personal facts or force disclosure.

Daily mode has optional archived-diary memory controlled by a browser-persisted integer setting from 0 to 180 days, default 0 (off), independent of API key persistence. For chat only, include dates, titles and summaries of archived daily entries in the previous N calendar days relative to the active diary's date, excluding that date, empty summaries and unarchived entries. Never read or send prior entries' original conversations or corrections for memory. Use all eligible summaries in chronological order. The fixed local opening stays unchanged; memory begins with the response to the first answer. Historical archives are data, not instructions; naturally reference relevant past experiences without assuming they happened today or that past feelings still apply. Current-answer translations stay faithful. Standalone correction, archive generation, and memory mode do not receive this history. Settings changes apply to subsequent requests; already-running requests retain their original context.

## Storage And Lifecycle

Use browser localStorage only for entries, input drafts and non-secret settings. Keys stay in component memory by default (refresh clears them); opt-in persistence stores keys locally with an explicit plaintext warning. Autosave all original answers before requesting AI. Detect and surface storage failures, preserving existing stored content rather than silently overwriting corrupt data. No cross-device sync; clearing site data deletes entries. Provide JSON export/import for user-controlled backups. Imported records are validated and merged by ID with daily-date uniqueness.

Archive only after successful AI generation of an English title and first-person summary based on the current entry. Retain the complete conversation. Archived entries may resume; resuming clears the stale summary. Editing an original regenerates its English version without deleting later conversation, reopens the entry, and clears stale summary. Retry failed responses without duplicating original answers. No fabricated AI translations or summaries when offline.

Newly generated archive titles and summaries must use English throughout, translating cultural terms and using English names or Latin-letter pinyin for proper names. Reject Han characters and Chinese/fullwidth punctuation before saving; retain the original conversation and offer manual retry without an automatic paid request. Existing archives and Chinese interface labels remain unchanged.

## AI Boundary

Call mainland DeepSeek and MiniMax directly from the browser using user-provided provider keys. No OpenAI service or SDK. Use fetch with Authorization Bearer and fixed HTTPS provider URLs. DeepSeek model deepseek-flash with thinking disabled and JSON mode. MiniMax model MiniMax-M3.1-Flash with reasoning_effort low, split reasoning, and prompt-enforced JSON validated locally. Timeout at 90 seconds; cancellation and malformed, truncated, authorization, balance, rate-limit, network/CORS responses produce actionable Chinese errors. Send only the active entry's conversation by default; enabled daily chat additionally receives a separate projected archived_context containing eligible archive dates, titles and summaries. Other entries' raw conversations and drafts never enter the request. Corrections send current context up to the edited message. No automatic paid retry.

For chat and standalone correction, send a separate correction_target with the target message ID and exact original text. Conversation and enabled archive memory provide background, never a substitute correction target. Require the response to echo the target ID and original text exactly; reject a missing or mismatched echo before saving the correction or follow-up, preserve the original, and allow manual retry. This checks declared source identity, not semantic translation accuracy. Archives do not require a correction target, and existing stored corrections are not automatically regenerated.

## Verification

Vitest covers daily uniqueness, local date, storage corruption/quota failures, backup validation/merging, key opt-in, provider request differences, current-entry privacy, response parsing and HTTP errors. React component tests use synthetic model responses to exercise conversation and recovery flows. Production build/typecheck must pass. No Playwright or Superpowers workflow is used for subsequent work, per user request. Live quality and authorized browser API compatibility remain unverified without user keys.
