---
name: small-commit
description: Stage specific files, commit with co-author, push
allowed-tools: Bash
---

# Small Commit

Focused commit workflow for small, atomic changes.

## Step 1: Show Status

```bash
powershell -Command "git status -sb"
```

## Step 2: Ask User

Use AskUserQuestion to ask:

1. **Files to stage**: Which files? (explicit paths, comma-separated)
2. **Commit message**: Message? (imperative mood, 1-2 lines)

## Step 3: Execute

Run in sequence:

```bash
git add <file1> <file2> ...
```

```bash
git commit -m "$(cat <<'EOF'
<user's message>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

```bash
git push
```

## Step 4: Confirm

Output:
- Commit SHA
- Files committed
- Push status

## Forbidden

- `git add -A`
- `git add .`
- `git push --force`
- `git reset --hard`
- Skipping co-author line
