# Starlab Code Desktop

This folder adds a Windows desktop app without changing the existing `frontend` or `backend` structure.

The normal installer build packages the frontend into the app. The installed app runs its own UI and calls the deployed backend API directly.

## Local development

Start the existing backend and frontend first:

```powershell
cd ..\backend
python -m uvicorn app.main:app --reload
```

```powershell
cd ..\frontend
npm run dev
```

Then open the desktop app in development mode:

```powershell
cd ..\desktop
npm install
npm run dev
```

Development mode opens:

```text
http://localhost:5173
```

## Build an independent Windows installer

Create a root `.env` file from `.env.example`, then set the deployed backend URL:

```text
STARLAB_API_BASE_URL=https://your-backend.example.com
```

Then build:

```powershell
npm run dist
```

The installer output is created under `desktop/dist`.

For the deployed backend CORS setting, include the desktop app origin:

```text
starlab://app
```

For example:

```text
https://your-frontend.example.com,starlab://app
```

## Build a remote-web wrapper

If you intentionally want the app to open a deployed frontend URL instead of packaging the frontend locally:

```powershell
$env:STARLAB_DESKTOP_URL="https://your-web-app.example.com"
npm run dist:remote
```

If `STARLAB_DESKTOP_URL` is set at runtime, it takes priority over the packaged frontend.

## Desktop updates

The installed app checks the backend endpoint below after startup:

```text
GET /desktop/update?version=<current-app-version>&platform=win32
```

To publish an update:

1. Increase `desktop/package.json` version.
2. Build a new installer with `npm run dist`.
3. Upload `desktop/dist/Starlab Code Setup <version>.exe` to a public download URL.
4. Set these backend environment variables and redeploy:

```text
STARLAB_DESKTOP_LATEST_VERSION=0.1.1
STARLAB_DESKTOP_DOWNLOAD_URL=https://your-download-host.example.com/Starlab-Code-Setup-0.1.1.exe
STARLAB_DESKTOP_RELEASE_NOTES=Update message shown to users.
STARLAB_DESKTOP_FORCE_UPDATE=false
```

When users open an older installed app, the window opens directly on a dedicated update screen (no login is shown first, no native dialog appears). The installer downloads automatically with a live progress bar, then runs silently (`/S`) and the app re-launches on the new version. The user never has to click an "update" button or close the app.

Boot sequence inside the same window:

1. `update.html` renders a splash with "업데이트 확인 중...".
2. Main process queries `/desktop/update`.
3. If no update is available (or the request times out / fails), the window navigates to the main app URL.
4. If an update is available, the splash transitions to a download progress view, then to an "설치 중" view, and the installer is launched silently with auto-relaunch chained.

To verify the flow during development, start the app with `STARLAB_CHECK_UPDATES_IN_DEV=1` so the update check runs even when not packaged.

## Version rules

The desktop version comes from `desktop/package.json`.

```text
patch: 0.1.0 -> 0.1.1
Bug fixes and small UI changes.

minor: 0.1.1 -> 0.2.0
New features or new screens.

major: 0.2.0 -> 1.0.0
Large structural changes or compatibility changes.
```

Common release command:

```powershell
npm version patch
npm run dist
```

## GitHub Releases download URL

Use GitHub Releases to host the installer:

1. Build the installer.
2. Rename it to a URL-friendly name such as `Starlab-Code-Setup-0.1.1.exe`.
3. Create a GitHub Release with a tag such as `desktop-v0.1.1`.
4. Upload the installer as a release asset.
5. Use the release asset URL as `STARLAB_DESKTOP_DOWNLOAD_URL`.

Example:

```text
https://github.com/<owner>/<repo>/releases/download/desktop-v0.1.1/Starlab-Code-Setup-0.1.1.exe
```

Test the backend manifest before opening the old app:

```text
https://your-backend.example.com/desktop/update?version=0.1.0&platform=win32
```

It should return `"available": true` when the backend latest version is newer.
