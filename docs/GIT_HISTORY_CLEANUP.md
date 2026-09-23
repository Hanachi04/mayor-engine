# Git history size (~243 MB)

## Largest historical blobs (from mirror analysis)

Primarily:
`data/historical-stage-1y/*_5m.json` (~16–18 MB each, many symbols)

These files were removed from the current tree in past commits but remain in Git history.

## Recommended cleanup (manual, changes history)

```bash
# Requires git-filter-repo
git filter-repo --path data/historical-stage-1y/ --invert-paths
# then force-push (coordinate with collaborators):
# git push --force origin main
```

Alternatively: Git LFS for large historical datasets stored outside the main research tree.

**Do not force-push without an explicit team decision.**
