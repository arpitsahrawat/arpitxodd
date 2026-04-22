# NEXUS · data-loader.js v1.1.0 — Debug Visible Edition

Drop-in replacement for the previous `data-loader.js`. Same file path, same place in your repo — just overwrite it and redeploy.

---

## What changed vs v1.0

A **floating debug panel** now renders on the dashboard itself. You don't need to open browser DevTools or paste console logs. Everything that's happening (and failing) is visible right on the page.

![panel location: bottom-right corner]

## What the panel shows

- **CLIENT_ID** — set / empty / wrong format
- **Google GSI library** — loaded / not loaded
- **SheetJS** — loaded / not loaded
- **OAuth token** — valid + seconds remaining / expired
- **Folders fetched** — e.g. `7/7`
- **Last sync** — local timestamp
- **Origin** — the exact URL string that must match "Authorized JavaScript Origins" in Google Cloud Console

## Live log stream

Every step shows up with a timestamp and color:
- **Red** = error (with stack trace)
- **Orange** = warning
- **Green** = success
- **Cream** = info

## Action buttons (bottom of panel)

| Button | What it does |
|---|---|
| 📋 Copy logs | Copies everything (status + logs + UA + origin) to clipboard — paste to me for instant diagnosis |
| 🔄 Force resync | Clears cache, re-fetches everything from Drive |
| 🔑 Re-auth | Re-triggers OAuth popup (use if token expired or you changed Google accounts) |
| 🗑 Clear cache | Wipes localStorage cache |
| 🧪 Test Drive | Pings every folder and reports file counts — fastest way to confirm Drive is reachable |

## Keyboard shortcut

Press **`** (backtick, top-left of keyboard) anywhere on the dashboard to toggle the panel open/closed.

## Collapsing it

Click the red header bar to minimize. Click `×` to hide entirely — then click the floating red 🐞 button bottom-right to bring it back.

---

## Deploy steps

1. Replace `data-loader.js` in your repo with this file.
2. Commit + push. Vercel auto-redeploys.
3. Open dashboard. Panel appears bottom-right automatically.
4. If still not fetching: click **🧪 Test Drive** in the panel, then **📋 Copy logs**, paste back to me.

## Once it's working

Minimize the panel (click the red bar) — it's only 32px tall when collapsed. Or hide it completely with `×` and forget it exists.

## For future sessions

To silence the panel by default in production, set `window.NEXUS_LIVE.DEBUG = false;` before calling `autoConnect()` — currently debug is always-on (we're still diagnosing).
