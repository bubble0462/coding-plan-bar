# AI Workflow Rules

This repository uses Codex for planning, implementation, and review work. Keep changes scoped, verify behavior locally, and do not overwrite user edits.

## Planning Mode

When the user asks to plan, split tasks, or run `plantask`:

- Create or update `.ai/PLAN.md`.
- Create or update `.ai/TASK.md`.
- Create or update `.ai/ACCEPTANCE.md`.
- Do not modify application source code as part of the planning pass.
- Make tasks executable and verifiable.
- Call out affected files, risks, dependencies, and test expectations.

## Review Mode

When the user asks for review:

- Read `.ai/PLAN.md`, `.ai/TASK.md`, and `.ai/ACCEPTANCE.md`.
- If present, read `.ai/IMPLEMENTATION.md` and `.ai/IMPLEMENTATION.diff`.
- Inspect the current `git diff`.
- Lead with findings ordered by severity and cite file paths/lines.
- If there are no issues, say so and mention residual test gaps.

## Implementation Mode

When implementing:

- Prefer existing Electron, renderer, and settings patterns.
- Use `apply_patch` for manual edits.
- Preserve user configuration files and generated release assets unless explicitly asked.
- Run relevant validation before finishing, usually `npm run check`, `npm run smoke`, `npm run smoke:electron`, and screenshot scripts for UI changes.
