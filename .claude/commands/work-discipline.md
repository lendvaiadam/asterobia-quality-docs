# Work Discipline

Project-scope rules for Claude Code sessions in this repository.

## Output Rules

1. **Write to files, not chat.** Produce artifacts (code, docs, plans) in files. Chat is for coordination only.
2. **No unrelated documentation.** Do not create README files, tutorials, or docs unless explicitly requested.
3. **Small commits + push.** Commit frequently with focused messages. Push after each logical unit of work.

## Approval Rules

4. **Ask before PASS/FAIL changes.** Any gate status change (PENDING → PASS, etc.) requires human confirmation before commit.
5. **Ask before destructive git operations.** No force push, reset --hard, or branch deletion without explicit approval.

## Search Rules

6. **Prefer Grep over manual browsing.** Use ripgrep/Grep tool for code search. Do not read files speculatively.
7. **Use Glob for file discovery.** Find files by pattern before reading.

## Shell Rules

8. **Default shell: PowerShell on Windows.** Use `powershell -Command "..."` for path-sensitive operations.
9. **Verify paths before file operations.** Confirm target directory exists before creating files.

## Commit Rules

10. **Stage specific files.** Use explicit file paths in `git add`, not `-A` or `.`
11. **Co-author line required.** All commits must include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
12. **No secrets in commits.** Never commit `.env`, credentials, or API keys.

---

*Effective: 2026-01-28*
