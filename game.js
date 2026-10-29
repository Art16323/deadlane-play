(() => {
  "use strict";

  const canvas = document.getElementById("unity-canvas");
  const welcome = document.getElementById("welcome");
  const loading = document.getElementById("loading");
  const errorScreen = document.getElementById("error");
  const playButton = document.getElementById("play-button");
  const retryButton = document.getElementById("retry-button");
  const status = document.getElementById("loading-status");
  const progressBar = document.getElementById("progress");
  const progressFill = document.getElementById("progress-fill");
  const progressNumber = document.getElementById("progress-number");
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.5);
  let unityInstance = null;
  let started = false;
  let failed = false;
  let reportedProgress = 0;
  let loadWatchdog = null;

  document.documentElement.classList.toggle("is-mobile", isMobile);

  function setProgress(value) {
    reportedProgress = Math.max(reportedProgress, Math.min(1, Math.max(0, value)));
    const percent = Math.round(reportedProgress * 100);
    progressFill.style.width = `${percent}%`;
    progressNumber.textContent = String(percent);
    progressBar.setAttribute("aria-valuenow", String(percent));
    status.textContent = percent >= 90 ? "Запускаем игру…" : "Загружаем мир и бойцов…";
  }

  function clearWatchdog() {
    window.clearTimeout(loadWatchdog);
    loadWatchdog = null;
  }

  function armWatchdog() {
    clearWatchdog();
    loadWatchdog = window.setTimeout(() => {
      if (!unityInstance && !failed) {
        status.textContent = navigator.onLine
          ? "Загрузка продолжается. На мобильной сети это может занять больше времени."
          : "Нет подключения. Загрузка продолжится, когда появится сеть.";
      }
    }, 45000);
  }

  function showError(error, description) {
    if (failed) return;
    failed = true;
    clearWatchdog();
    welcome.hidden = true;
    loading.hidden = true;
    errorScreen.hidden = false;
    document.getElementById("error-description").textContent = description ||
      "Проверь подключение и попробуй ещё раз. Если вкладка закрывалась сама, закрой другие вкладки перед запуском.";
    document.getElementById("error-message").textContent = String(error && (error.message || error) || "Неизвестная ошибка").slice(0, 1500);
    retryButton.focus({ preventScroll: true });
  }

  function sendToGame(method, value) {
    if (!unityInstance || failed) return;
    try {
      unityInstance.SendMessage("WebRuntimeBridge", method, value);
    } catch (error) {
      console.warn("DEADLANE browser bridge:", error);
    }
  }

  async function readConfig() {
    const response = await fetch("./build-config.json", { cache: "no-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Конфигурация игры недоступна (HTTP ${response.status}).`);
    const config = await response.json();
    for (const key of ["loaderUrl", "dataUrl", "frameworkUrl", "codeUrl"]) {
      if (typeof config[key] !== "string" || !config[key].trim()) {
        throw new Error(`В конфигурации игры отсутствует ${key}.`);
      }
      const url = new URL(config[key], document.baseURI);
      if (!/^https?:$/.test(url.protocol)) throw new Error(`Некорректный адрес ${key}.`);
    }
    return config;
  }

  function loadLoader(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Не удалось загрузить модуль запуска игры. Проверь подключение."));
      document.head.appendChild(script);
    });
  }

  async function startGame() {
    if (started) return;
    started = true;
    playButton.disabled = true;
    welcome.hidden = true;
    loading.hidden = false;
    armWatchdog();
    try {
      if (typeof WebAssembly !== "object") {
        throw new Error("В этом браузере недоступен WebAssembly. Попробуй актуальную версию Safari или Chrome.");
      }
      const build = await readConfig();
      if (failed) return;
      await loadLoader(build.loaderUrl);
      if (failed) return;
      if (typeof window.createUnityInstance !== "function") throw new Error("Загрузчик Unity не запустился.");
      const { loaderUrl, ...buildConfig } = build;
      const config = {
        ...buildConfig,
        streamingAssetsUrl: build.streamingAssetsUrl || "StreamingAssets",
        companyName: build.companyName || "DEADLANE",
        productName: build.productName || "DEADLANE",
        productVersion: build.productVersion || "demo",
        devicePixelRatio,
        matchWebGLToCanvasSize: true,
        autoSyncPersistentDataPath: true,
        showBanner(message, type) {
          if (type === "error") showError(message);
          else console.info("Unity:", message);
        }
      };
      unityInstance = await window.createUnityInstance(canvas, config, (progress) => {
        if (failed) return;
        setProgress(progress);
        armWatchdog();
      });
      if (failed) return;
      clearWatchdog();
      setProgress(1);
      sendToGame("ConfigureMobile", isMobile ? "1" : "0");
      if (document.hidden) sendToGame("OnPageHidden", "visibilitychange");
      loading.hidden = true;
      canvas.focus({ preventScroll: true });
    } catch (error) {
      showError(error);
    }
  }

  playButton.addEventListener("click", startGame);
  retryButton.addEventListener("click", () => window.location.reload());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sendToGame("OnPageHidden", "visibilitychange");
  });
  window.addEventListener("pagehide", () => sendToGame("OnPageHidden", "pagehide"));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && started && !unityInstance) window.location.reload();
  });
  canvas.addEventListener("webglcontextlost", () => {
    showError("WebGL context lost", "Браузер освободил память игры. Закрой лишние вкладки и запусти игру снова.");
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  // Block only Safari's page-zoom gesture over the canvas. Raw multi-touch events
  // still reach Unity so its two-finger camera control remains available.
  canvas.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
  canvas.addEventListener("gesturechange", (event) => event.preventDefault(), { passive: false });
})();
