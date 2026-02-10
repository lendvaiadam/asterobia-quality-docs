# SKILL: Lint Autofix

**ID**: `skill-lint-autofix`
**Role**: Refactor / Style
**Status**: ACTIVE

---

## 1. Purpose
Apply automated style fixes (ESLint/Prettier) to ensure code consistency without altering logic.

## 2. Scope
- Whitespace / Indentation.
- Semicolons / Quotes.
- Trailing commas.
- Order of imports (if configured).

## 3. Hard Constraints (MUST NOT)
- **NO Logic Mod**: Must only use `--fix` for style rules. Do not manually rewrite logic under the guise of linting.
- **NO Config Change**: Do not alter `.eslintrc` or `.prettierrc` without CTO approval.
- **NO Broken Tests**: Code must still run validly after formatting.

## 4. Triggers (When to Use)
- Pre-commit hook failures.
- Merging disparate branches with conflicts.
- General codebase normalization.

## 5. Checklist
- [ ] Run `npm run lint`.
- [ ] Run `npm run lint:fix` (or equivalent).
- [ ] Verify no "unused-vars" triggered logic deletion.

## 6. Usage Examples

### A. Standard Fix
```bash
npx eslint src/ --fix
```

## 7. Out of Scope
- Architectural refactoring.
