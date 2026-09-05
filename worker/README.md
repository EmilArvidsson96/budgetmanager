# Report worker

Receives in-app bug/feature reports from the app and files them as GitHub
issues on the private `budgetmanager_data` repo (not the public app repo —
reports can carry a full app-state snapshot with real financial data).

This exists only because the app is a static site with no backend of its own:
something has to hold the GitHub token off the client, so a stranger without a
GitHub account can submit a report, on mobile, without leaving the app.

## One-time setup

1. **Cloudflare account** — create a free one at https://dash.cloudflare.com/sign-up if you don't have one.

2. **Log in from this machine**, from the `worker/` folder:
   ```
   cd worker
   npx wrangler login
   ```
   This opens a browser tab — approve it there.

3. **GitHub token** — create a fine-grained personal access token scoped to
   *only* this repo and *only* Issues:
   - https://github.com/settings/personal-access-tokens/new
   - Resource owner: your account
   - Repository access: **Only select repositories** → `budgetmanager_data`
   - Permissions: **Issues** → Read and write. Leave everything else at No access.
   - Generate, copy the token (starts with `github_pat_`).

4. **Store it as a Worker secret** (never committed to git):
   ```
   npx wrangler secret put GITHUB_TOKEN
   ```
   Paste the token when prompted.

5. **Deploy:**
   ```
   npx wrangler deploy
   ```
   This prints the Worker's URL, e.g. `https://budgetmanager-report.<your-subdomain>.workers.dev`.

6. **Wire it into the app** — put that URL in `src/components/feedback/ReportIssueButton.tsx`
   (the `REPORT_ENDPOINT` constant), then commit and push.

## Redeploying after code changes

```
cd worker
npx wrangler deploy
```

## Rotating the token

Generate a new fine-grained token the same way, then re-run
`npx wrangler secret put GITHUB_TOKEN` and revoke the old one on GitHub.
