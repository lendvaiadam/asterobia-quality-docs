# SKILL: Cleanup Deadcode

**ID**: `skill-cleanup-deadcode`
**Role**: Refactor / Maintenance
**Status**: ACTIVE

---

## 1. Purpose
Identify and safely remove unused code artifacts, orphaned files, and deprecated logic to maintain codebase hygiene.

## 2. Scope
- File deletion (`*_old.js`, `*_backup.js`).
- Export pruning (unused functions).
- Comment cleanup (commented-out blocks).

## 3. Hard Constraints (MUST NOT)
- **NO Blind Deletes**: Must verify 0 references via grep/search.
- **NO Logic Change**: Removal must not affect runtime behavior.
- **NO Test Removal**: Do not remove tests unless the subject code is permanently gone.

## 4. Triggers (When to Use)
- Post-merge cleanup.
- Tech debt sprints.
- "Spring cleaning" (RF Worker).

## 5. Checklist
- [ ] Grep for usages returns 0 results.
- [ ] File is not strictly required by build tools/config.
- [ ] Tests pass after removal.

## 6. Usage Examples

### A. Removing a Backup File
```bash
# Verify usage
grep -r "Game_backup" src/
# If empty, delete
rm src/Core/Game_backup.js
```

## 7. Out of Scope
- Refactoring active logic (Use `skill-refactor-logic` - future).
