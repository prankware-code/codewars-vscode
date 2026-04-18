# Codewars for VS Code

Unofficial Codewars integration: browse your profile, pick a kata, solve it in the editor, and submit — without leaving VS Code.

> Not affiliated with Codewars. Uses public endpoints plus a session cookie you paste yourself.

## Features

- **Profile sidebar** — overall rank, honor, leaderboard position, completed count. Webview with tabs: Overview, Languages (per-language ranks), Completed katas.
- **Trainer** — pick a mode (Fundamentals / Rank Up / Random / Practice / Beta / Kumite) and a language. The extension fetches a kata matching your rank (`-5 / -4` for Fundamentals, `-3` for Rank Up at 4 kyu, etc.) via the public search page.
- **Kata view** — description (markdown), tags, supported languages, rank pill, author, stats. Buttons: **Train this kata**, **▶ Test**, **⤴ Attempt**, **↻ Skip**.
- **Solve inside VS Code** — description on the left, starter code on the top-right, sample tests on the bottom-right. Files live under the extension's global storage, so `Ctrl+S` just saves.
- **Test** runs your solution + your (possibly edited) sample tests via `cr.codewars.com` and shows a test tree in the Output channel.
- **Attempt** submits to the hidden full test suite, finalizes on codewars.com — the kata is marked as completed on your profile.
- **Skip** rerolls with the same mode and language.
- **Open kata by URL / ID** — paste a kata link or slug, the details render inside VS Code.

## Quick start

1. Install the extension and open the **Codewars** view in the activity bar.
2. Click **Login** → enter your Codewars username.
3. When prompted for `_session_id`, paste the cookie from your browser:
   - On codewars.com, open DevTools → **Application** (Chrome) / **Storage** (Firefox) → **Cookies** → `https://www.codewars.com` → copy the value of `_session_id`.
   - This cookie is stored in VS Code's `SecretStorage` (encrypted), never written to plain settings.
4. The profile opens. Go to **Kata list** → **Start training...** → pick a mode → **Start Training**.
5. In the kata webview press **Train this kata**. Description docks to the left, starter code + sample tests appear on the right.
6. Edit the solution, press **▶ Test** to run locally, **⤴ Attempt** to submit.

## Authentication

The extension uses only what you give it:

- `username` — kept in `globalState` (plain).
- `_session_id` cookie — kept in VS Code `SecretStorage`.
- A short-lived runner JWT is fetched on each Test/Attempt via `POST /api/v1/runner/authorize`.

If the cookie expires or is revoked, any authenticated request will land on the sign-in redirect; the extension notices this and signs you out automatically.

## Commands

| Command | Description |
|---|---|
| `Codewars: Open Welcome Screen` | Welcome webview with the Login button |
| `Codewars: Sign In` / `Sign Out` | Start / end the session |
| `Codewars: Open Profile` | Profile webview with tabs |
| `Codewars: Refresh Profile` | Re-fetch profile + completed katas |
| `Codewars: Open Trainer` | Setup webview (mode + language) |
| `Codewars: Open Kata by URL or ID` | Paste a kata link or slug |
| `Codewars: Train Current Kata` | Open solution + tests editors for the active kata |
| `Codewars: Test Current Kata` | Run solution against the visible sample tests |
| `Codewars: Attempt Current Kata` | Run against the hidden full suite and finalize |

## How kata files are stored

Starter code and sample tests are written under VS Code's extension global storage:

- Linux: `~/.config/Code/User/globalStorage/<publisher>.codewars-vscode/katas/<slug>/<language>/`
- macOS: `~/Library/Application Support/Code/User/globalStorage/<publisher>.codewars-vscode/katas/...`
- Windows: `%APPDATA%\Code\User\globalStorage\<publisher>.codewars-vscode\katas\...`

Existing files are never overwritten on re-train — your edits persist. To reset a kata to the starter, delete its `solution.<ext>` file and press **Train this kata** again.

## Known limitations

- The Trainer's mode labels mirror codewars.com, but selection is done by filtering the public `/kata/search/{language}` page by rank. It's not the exact algorithm the official trainer uses (that requires server-side state).
- `Attempt` works for public test-runner katas (the vast majority). Katas that rely on unusual runner setups may report a decrypter error — fall back to **Open on codewars.com**.
- Attempt flow depends on the `/api/v1/runner/authorize` → `runner.codewars.com/run` → `/api/v1/.../notify` pipeline. If Codewars changes this pipeline, the Test/Attempt buttons may break until the extension is updated.
- No offline mode — the extension always talks to codewars.com.

## Development

```bash
git clone https://github.com/<you>/codewars-vscode.git
cd codewars-vscode/codewars-vscode
npm install
npm run watch      # TypeScript in watch mode
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded. After code changes, reload the host with `Ctrl+R`.

Project layout:

- `src/extension.ts` — single-file extension: tree providers, webviews, commands, Codewars API glue.
- `src/logo.svg` — activity bar icon.
- `out/` — compiled JS (generated).

## Contributing

Issues and PRs welcome. When reporting a bug, please include:

- Output from the `Codewars` output channel (last session + last Test/Attempt run).
- VS Code version and OS.

## License

MIT.
