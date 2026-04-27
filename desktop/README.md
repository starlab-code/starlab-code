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
