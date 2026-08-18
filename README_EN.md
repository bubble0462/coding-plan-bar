# Coding Plan Bar

[中文](README.md) | English

A lightweight Windows tray app for monitoring Codex, Claude, coding-plan quotas, and API balances in one place.

![Quota panel](docs/images/quota-panel.png)

## Features

- Lives in the Windows system tray; hover or click to open the quota panel.
- Shows five-hour limits, weekly limits, reset countdowns, and account balances.
- Shows request counts and token totals per quota window, with model-aware estimated cost in USD.
- The Settings page includes **Agent Usage**: switch between local Codex and Claude Code usage — today, the last 7 days, the last 30 days, requests, tokens, sessions, and model-level cost.
- Balance cards can show today's requests, tokens, and spend returned by the endpoint; DeepSeek uses seven-day local-log statistics.
- The popup has two levels: an overview of compact rows showing each provider's remaining quota and risk status, and a detail view entered by clicking a row. The top selector switches providers and remembers your choice.
- The GLM detail view shows today's calls, tokens, a 24-hour line chart, and the monthly MCP quota. The DeepSeek detail view can optionally use a platform token to show this month's cost, tokens, cache-hit breakdown, a daily cost line chart, and an off-peak pricing badge.
- Automatically fits up to six providers and switches to a scrollable fixed height beyond that.
- Graphical provider management without manually editing JSON.
- Reorder providers from the left drag handle; the quota panel follows the saved order.
- Drag cards directly from the quota panel to persist their display order.
- Grok/SuperGrok supports the Grok Build CLI, Web Billing fallback, monthly credits, and on-demand status.
- Only Codex is enabled by default; all other providers are opt-in.
- Generic `/v1/usage` balance template for compatible relay services.
- DeepSeek CNY balances are displayed with `￥`.

![Provider picker](docs/images/provider-picker.png)

## Installation

Download the latest Windows installer from [Releases](https://github.com/bubble0462/coding-plan-bar/releases/latest):

```text
Coding Plan Bar-Setup-0.4.4-x64.exe
```

Quit any running older version before installing. The installer supports a custom destination, including drives such as D:. Upgrading does not delete your user configuration.

## Usage

1. Launch Coding Plan Bar and find its icon in the system tray.
2. Hover over or click the icon to open the quota panel.
3. Select the gear icon to open Settings.
4. Select Add, choose a provider, and enter the required API key or endpoint.
5. Select Save and refresh quotas.

### Settings Toolbar

The three shortcut buttons beside "Accounts & Providers" have different purposes:

- **Latest**: finds the newest Claude or CPA account JSON in Downloads and prepares it for import.
- **Import**: opens one import card that accepts a dropped Claude/CPA JSON file, a file selected from disk, or pasted JSON content. Confirming the preview encrypts and saves the account immediately.
- **Add**: opens the provider template picker for creating and configuring a provider. It is the only one of the three buttons that adds a provider; it does not import account JSON.

**Latest** and **Import** support Claude and CPA account JSON files, while **Add** opens provider templates. Claude accounts update by email and CPA accounts update by `accountId`; accounts from different services are never merged just because they share an email. Confirmed imports are saved immediately. Only the access token required for quota queries is retained and encrypted with Windows DPAPI; Claude refresh tokens, CPA session tokens, and ID tokens are not stored or shown in previews. sub2api and sessions.json remain supported for migration. The Imported Accounts filter includes Claude, CPA, and sub2api accounts.

Persistent app data is stored by default at:

```text
D:\Apps\Coding Plan Bar Data
```

This is a sibling of the install directory `D:\Apps\Coding Plan Bar` (not inside it), so NSIS upgrades cannot wipe accounts. If D: is unavailable, the app falls back to `%APPDATA%\Coding Plan Bar`. On upgrade it migrates from `D:\Apps\Coding Plan Bar\Data`, `D:\Coding Plan Bar\Data`, and `%APPDATA%` (never overwriting existing files). Set `CODING_PLAN_BAR_DATA_DIR` to use a different directory.

### Token and cost estimates

- Codex usage is read from local JSONL sessions under `%USERPROFILE%\.codex\sessions` and `archived_sessions`.
- Agent Usage is intentionally account-agnostic: it combines the default and configured Codex session directories and removes replayed history carried by forked or subagent sessions.
- Claude usage is read from local JSONL sessions under `%USERPROFILE%\.claude\projects`.
- Kimi, GLM, and MiniMax coding-plan usage is assigned by the model ID recorded in the session. GLM pricing covers the common GLM 4.5/4.6/4.7 and GLM 5/5-Turbo/5.1/5.2 families.
- Codex pricing includes the GPT-5.6 Sol, Terra, and Luna limited preview. Cache reads use 10% of the input rate and cache writes use 1.25x the input rate.
- Requests, tokens, and cost are aggregated into the current five-hour and weekly quota windows. Cached tokens use each model's cache price.
- `Est. $` is an API-equivalent estimate based on published standard prices. It is **not an actual subscription charge or invoice**. Unknown or unpriced models still show tokens, while cost is shown as `$--`.
- When a compatible balance endpoint returns `usage.today`, the balance card displays its requests, tokens, and actual spend directly instead of estimating them again.

### Checking and installing updates

1. Open Settings and click "About & Update" at the bottom of the sidebar.
2. Click "Check for updates" to query GitHub Releases for the latest version.
3. When GitHub provides a valid SHA256, click "Download update", then "Install update" once the verified download finishes.
4. You can also click "Manual download" to open the GitHub Release page and download it yourself.

"Check for updates on launch" is enabled by default: the app checks once in the background on startup and only flags a new version in the navigation — it **never downloads or installs automatically**. Toggle it off on the "About & Update" page; once off, restarting the app will not perform any update request.

If the GitHub API is unavailable or a release has no SHA256 digest, the app only reports the version and offers the manual Release link. It will not download or launch an unverified installer.

## Supported Sources

- Official subscriptions: Codex, Claude, and Grok/SuperGrok.
- Coding plans: Kimi For Coding, Zhipu GLM, MiniMax, and compatible ZenMux responses.
- API balances: DeepSeek, Kimi/Moonshot, OpenRouter, and SiliconFlow.
- Generic balances: tries `{baseUrl}/v1/usage`, `{baseUrl}/usage`, and the complete `baseUrl`.

The generic balance template sends:

```http
Authorization: Bearer <API_KEY>
Accept: application/json
```

It recognizes common fields including `remaining`, `balance`, `available_balance`, `quota.remaining`, `data.remaining`, and `data.balance`. USD is the default unit; `unit` or `currency` from the response takes precedence.

## Development

Node.js and npm are required:

```powershell
npm install
npm run dev
```

Validation and packaging:

```powershell
npm run check
npm run smoke
npm run dist
```

The installer is written to `release/`.

## Security

- API keys and OAuth tokens imported into the app are encrypted with Electron safeStorage/Windows DPAPI and can only be decrypted by the current Windows user.
- Token statistics read only timestamps, model IDs, and usage fields from local session files; conversation content is neither read nor uploaded.
- Environment variables are recommended for API keys.
- Some quota endpoints are not stable public APIs and may require adapter updates when providers change them.
- Verify the trustworthiness and key scope of any relay service you configure.
- Updates are fetched only from this repository's GitHub Release at `bubble0462/coding-plan-bar`; only Windows x64 NSIS installers with a SHA256 digest are accepted, and both size and digest are verified after download.

- The Agent Usage cache stores only one aggregate statistics snapshot (maximum 512 KB); it never copies or uploads raw sessions or chat content. The app clears stale temporary files daily, retains at most 14 days / 10 MB of app logs, and clears the Electron HTTP cache.
## Credits

Design and provider-integration ideas were inspired by [codexbar](https://github.com/iamzjt-front-end/codexbar), [CodexBar](https://github.com/steipete/CodexBar), and [cc-switch](https://github.com/farion1231/cc-switch).

## License

[MIT](LICENSE)
