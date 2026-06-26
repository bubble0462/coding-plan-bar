# Release v0.3.7

## Scope

- Added Settings > About & Update page.
- Added GitHub Release update checking, installer download progress, and installer launch.
- Added startup auto-check config, enabled by default and never auto-downloads or auto-installs.
- Hid the default Electron File/Edit/View/Window menu from the settings window.
- Fixed update-page auto-check preference saving and GitHub release links opening through the OS browser.

## Verification

- `npm run check`
- `npm run smoke`
- `npm run smoke:electron`
- `npm run screenshot:settings:update`
- `npm run dist`
- `release\win-unpacked\Coding Plan Bar.exe --smoke-startup`

## Artifact

- `release\Coding Plan Bar-Setup-0.3.7-x64.exe`
- SHA256: `7AF396A46110906D11AEA62323683FCBCA8F74BBCE706EF63EF2A6F94325083B`
