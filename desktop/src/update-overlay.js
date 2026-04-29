(() => {
  if (window.__starlabUpdateOverlayInstalled) {
    if (typeof window.__starlabUpdateOverlayRequestState === "function") {
      window.__starlabUpdateOverlayRequestState();
    }
    return;
  }
  window.__starlabUpdateOverlayInstalled = true;

  const STYLE = [
    "@keyframes starlab-update-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }",
    "@keyframes starlab-update-spin { to { transform: rotate(360deg); } }",
    "@keyframes starlab-update-bar-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }",
    ".starlab-update-overlay { position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Pretendard', 'Apple SD Gothic Neo', sans-serif; color: #1f2937; }",
    ".starlab-update-overlay.is-visible { display: flex; }",
    ".starlab-update-card { width: min(440px, calc(100vw - 48px)); background: #ffffff; border-radius: 16px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28); padding: 26px 28px 22px; box-sizing: border-box; animation: starlab-update-fade-in 180ms ease-out; }",
    ".starlab-update-card h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; color: #0f172a; }",
    ".starlab-update-card .starlab-update-version { font-size: 13px; color: #475569; margin-bottom: 16px; }",
    ".starlab-update-notes { font-size: 13px; color: #334155; line-height: 1.55; max-height: 140px; overflow: auto; white-space: pre-wrap; background: #f8fafc; border-radius: 10px; padding: 12px 14px; margin-bottom: 18px; border: 1px solid #e2e8f0; }",
    ".starlab-update-notes:empty { display: none; }",
    ".starlab-update-progress { margin-bottom: 18px; display: none; }",
    ".starlab-update-progress.is-visible { display: block; }",
    ".starlab-update-progress-row { display: flex; justify-content: space-between; font-size: 12px; color: #475569; margin-bottom: 8px; }",
    ".starlab-update-bar { position: relative; width: 100%; height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }",
    ".starlab-update-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #4f46e5, #6366f1); border-radius: 999px; transition: width 120ms ease-out; }",
    ".starlab-update-bar-fill.is-indeterminate { position: absolute; top: 0; left: -40%; width: 40% !important; transition: none; animation: starlab-update-bar-indeterminate 1.4s ease-in-out infinite; }",
    ".starlab-update-status { display: none; align-items: center; gap: 10px; font-size: 13px; color: #4338ca; margin-bottom: 18px; }",
    ".starlab-update-status.is-visible { display: flex; }",
    ".starlab-update-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #c7d2fe; border-top-color: #4f46e5; animation: starlab-update-spin 700ms linear infinite; flex-shrink: 0; }",
    ".starlab-update-error { display: none; font-size: 13px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 12px; margin-bottom: 16px; }",
    ".starlab-update-error.is-visible { display: block; }",
    ".starlab-update-actions { display: flex; justify-content: flex-end; gap: 8px; }",
    ".starlab-update-btn { appearance: none; border: 0; cursor: pointer; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 10px; transition: background 120ms ease; font-family: inherit; }",
    ".starlab-update-btn[disabled] { cursor: not-allowed; opacity: 0.65; }",
    ".starlab-update-btn-primary { background: #4f46e5; color: #ffffff; }",
    ".starlab-update-btn-primary:hover:not([disabled]) { background: #4338ca; }",
    ".starlab-update-btn-secondary { background: #f1f5f9; color: #1f2937; }",
    ".starlab-update-btn-secondary:hover:not([disabled]) { background: #e2e8f0; }",
  ].join("\n");

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-starlab-update", "true");
  styleEl.textContent = STYLE;
  (document.head || document.documentElement).appendChild(styleEl);

  const overlay = document.createElement("div");
  overlay.className = "starlab-update-overlay";
  overlay.setAttribute("data-starlab-update", "overlay");
  overlay.innerHTML = [
    '<div class="starlab-update-card" role="dialog" aria-modal="true" aria-live="polite">',
    '  <h2>Starlab Code 업데이트</h2>',
    '  <div class="starlab-update-version" data-role="version"></div>',
    '  <div class="starlab-update-notes" data-role="notes"></div>',
    '  <div class="starlab-update-progress" data-role="progress">',
    '    <div class="starlab-update-progress-row"><span data-role="progress-label">다운로드 중</span><span data-role="progress-percent">0%</span></div>',
    '    <div class="starlab-update-bar"><div class="starlab-update-bar-fill" data-role="progress-fill"></div></div>',
    '  </div>',
    '  <div class="starlab-update-status" data-role="status"><div class="starlab-update-spinner" aria-hidden="true"></div><span data-role="status-text"></span></div>',
    '  <div class="starlab-update-error" data-role="error"></div>',
    '  <div class="starlab-update-actions" data-role="actions"></div>',
    '</div>',
  ].join("");

  function attachOverlay() {
    if (!document.body) {
      requestAnimationFrame(attachOverlay);
      return;
    }
    document.body.appendChild(overlay);
  }
  attachOverlay();

  const refs = {
    version: overlay.querySelector('[data-role="version"]'),
    notes: overlay.querySelector('[data-role="notes"]'),
    progress: overlay.querySelector('[data-role="progress"]'),
    progressFill: overlay.querySelector('[data-role="progress-fill"]'),
    progressLabel: overlay.querySelector('[data-role="progress-label"]'),
    progressPercent: overlay.querySelector('[data-role="progress-percent"]'),
    status: overlay.querySelector('[data-role="status"]'),
    statusText: overlay.querySelector('[data-role="status-text"]'),
    error: overlay.querySelector('[data-role="error"]'),
    actions: overlay.querySelector('[data-role="actions"]'),
  };

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let unit = 0;
    let value = bytes;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const fixed = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return value.toFixed(fixed) + " " + units[unit];
  }

  function setActions(buttons) {
    refs.actions.innerHTML = "";
    for (const btn of buttons) {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = btn.label;
      el.className = "starlab-update-btn " + (btn.variant === "primary" ? "starlab-update-btn-primary" : "starlab-update-btn-secondary");
      if (btn.disabled) el.disabled = true;
      el.addEventListener("click", () => {
        if (btn.disabled || !btn.action) return;
        if (window.starlabUpdate && typeof window.starlabUpdate.invoke === "function") {
          window.starlabUpdate.invoke(btn.action);
        }
      });
      refs.actions.appendChild(el);
    }
  }

  function show() {
    overlay.classList.add("is-visible");
  }
  function hide() {
    overlay.classList.remove("is-visible");
  }

  function render(state) {
    if (!state) return;
    const manifest = state.manifest || {};
    refs.version.textContent = manifest.latest_version
      ? "새 버전 " + manifest.latest_version + " 이(가) 준비되었습니다."
      : "새 버전이 준비되었습니다.";
    refs.notes.textContent = manifest.release_notes || "";

    refs.progress.classList.remove("is-visible");
    refs.status.classList.remove("is-visible");
    refs.error.classList.remove("is-visible");

    const status = state.status || "idle";

    if (status === "available") {
      show();
      const buttons = [{ label: "지금 업데이트", action: "install", variant: "primary" }];
      if (!manifest.force_update) {
        buttons.unshift({ label: "나중에", action: "dismiss", variant: "secondary" });
      }
      setActions(buttons);
      return;
    }

    if (status === "downloading") {
      show();
      refs.progress.classList.add("is-visible");
      const total = (state.progress && state.progress.total) || 0;
      const downloaded = (state.progress && state.progress.downloaded) || 0;
      if (total > 0) {
        const percent = Math.min(100, Math.round((downloaded / total) * 100));
        refs.progressFill.classList.remove("is-indeterminate");
        refs.progressFill.style.width = percent + "%";
        refs.progressPercent.textContent = percent + "%";
        refs.progressLabel.textContent = "다운로드 중 · " + formatBytes(downloaded) + " / " + formatBytes(total);
      } else {
        refs.progressFill.classList.add("is-indeterminate");
        refs.progressPercent.textContent = formatBytes(downloaded) || "";
        refs.progressLabel.textContent = "다운로드 중";
      }
      setActions([{ label: "다운로드 중...", action: null, variant: "primary", disabled: true }]);
      return;
    }

    if (status === "installing") {
      show();
      refs.status.classList.add("is-visible");
      refs.statusText.textContent = "설치 중입니다. 잠시 후 앱이 자동으로 다시 시작됩니다.";
      setActions([{ label: "설치 중...", action: null, variant: "primary", disabled: true }]);
      return;
    }

    if (status === "failed") {
      show();
      refs.error.classList.add("is-visible");
      refs.error.textContent = state.error
        ? "업데이트 중 오류가 발생했습니다: " + state.error
        : "업데이트 중 오류가 발생했습니다.";
      setActions([
        { label: "닫기", action: "dismiss", variant: "secondary" },
        { label: "다시 시도", action: "retry", variant: "primary" },
      ]);
      return;
    }

    hide();
  }

  if (window.starlabUpdate && typeof window.starlabUpdate.onState === "function") {
    window.__starlabUpdateOverlayRequestState = () => {
      window.starlabUpdate.invoke("request-state").catch(() => {});
    };
    window.starlabUpdate.onState(render);
  }
})();
