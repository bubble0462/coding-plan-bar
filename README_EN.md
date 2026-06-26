# Coding Plan Bar

[中文](README.md) | English

A lightweight Windows tray app for monitoring Codex, Claude, coding-plan quotas, and API balances in one place.

![Quota panel](docs/images/quota-panel.png)

## Features

- Lives in the Windows system tray; hover or click to open the quota panel.
- Shows five-hour limits, weekly limits, reset countdowns, and account balances.
- Automatically fits up to three providers and switches to a scrollable fixed height for four or more.
- Graphical provider management without manually editing JSON.
- Only Codex is enabled by default; all other providers are opt-in.
- Generic `/v1/usage` balance template for compatible relay services.
- DeepSeek CNY balances are displayed with `￥`.

![Provider picker](docs/images/provider-picker.png)

## Installation

Download the latest Windows installer from [Releases](https://github.com/bubble0462/coding-plan-bar/releases/latest):

```text
Coding Plan Bar-Setup-0.3.7-x64.exe
```

Quit any running older version before installing. The installer supports a custom destination, including drives such as D:. Upgrading does not delete your user configuration.

## Usage

1. Launch Coding Plan Bar and find its icon in the system tray.
2. Hover over or click the icon to open the quota panel.
3. Select the gear icon to open Settings.
4. Select Add, choose a provider, and enter the required API key or endpoint.
5. Select Save and refresh quotas.

User configuration is stored at:

```text
%APPDATA%\Coding Plan Bar\config.json
```

### Checking and installing updates

1. Open Settings and click "About & Update" at the bottom of the sidebar.
2. Click "Check for updates" to query GitHub Releases for the latest version.
3. When a newer version is found, click "Download update", then "Install update" once the download finishes to launch the downloaded installer.
4. You can also click "Manual download" to open the GitHub Release page and download it yourself.

"Check for updates on launch" is enabled by default: the app checks once in the background on startup and only flags a new version in the navigation — it **never downloads or installs automatically**. Toggle it off on the "About & Update" page; once off, restarting the app will not perform any update request.

## Supported Sources

- Official subscriptions: Codex and Claude.
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

- API keys stay in the current Windows user's configuration directory and are not committed to this repository.
- Environment variables are recommended for API keys.
- Some quota endpoints are not stable public APIs and may require adapter updates when providers change them.
- Verify the trustworthiness and key scope of any relay service you configure.
- Updates are fetched only from this repository's GitHub Release at `bubble0462/coding-plan-bar` and only the Windows x64 NSIS installer asset is accepted; the installer is written to a temporary path and only marked ready once the download completes with a non-empty size.

## Credits

Design and provider-integration ideas were inspired by [codexbar](https://github.com/iamzjt-front-end/codexbar) and [cc-switch](https://github.com/farion1231/cc-switch).

## License

[MIT](LICENSE)
