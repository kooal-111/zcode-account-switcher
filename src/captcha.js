
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { init, t, lang, stripErr } from "./i18n.js";

const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const TRACELESS_TIMEOUT = 8000;
const SDK_LOAD_TIMEOUT_MS = 15000;
const SUBMIT_TIMEOUT_MS = 30000;
const MAX_SDK_ATTEMPTS = 3;
const MAX_RETRIES = 3;

// Состояния: loading_config → loading_sdk → initializing → traceless →
//   interactive → submitting → success
// Ошибки: retryable_error (кнопка «Повторить») / fatal_error / canceled
let state = "loading_config";
let claimId = null;
let submitted = false;
let retries = 0;
let region = null;
let tracelessTimer = 0;
let canceled = false;

const $text = document.getElementById("cap-text");
const $detail = document.getElementById("cap-detail");
const $dot = document.getElementById("cap-dot");
const $btn = document.getElementById("cap-btn");

function status(text, tone = "run") {
  $text.textContent = text;
  $dot.className = "cap-dot" + (tone === "ok" ? " ok" : tone === "err" ? " err" : "");
}

function detail(text) {
  $detail.textContent = text || "";
}

function setState(next, tone) {
  state = next;
  if (tone) status($text.textContent, tone);
}

document.addEventListener("securitypolicyviolation", (e) => {
  detail(t("c.cspBlocked", { directive: e.violatedDirective, uri: String(e.blockedURI).slice(0, 70) }));
});

const notifyStuck = () => { emit("captcha://interactive").catch(() => {}); };

// Закрытие окна (крестик/Alt+F4) отменяет ровно свою попытку claim.
window.addEventListener("beforeunload", () => {
  if (!submitted && !canceled) {
    canceled = true;
    emit("captcha://closed", { claimId }).catch(() => {});
  }
});

function loadSdk(timeoutMs = SDK_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (typeof window.initAliyunCaptcha === "function") return resolve();
    const timer = setTimeout(() => reject(new Error(t("c.sdkTimeout"))), timeoutMs);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); reject(new Error(t("c.sdkFail"))); };
    document.head.appendChild(s);
  });
}

function showRetry() {
  $btn.hidden = false;
  $btn.textContent = t("c.retry");
  $btn.dataset.retry = "1";
  $btn.focus();
}

function clearRetry() {
  delete $btn.dataset.retry;
  $btn.hidden = true;
  $btn.textContent = t("c.btn");
}

async function run() {
  setState("loading_config", "run");
  try {
    const st = await invoke("get_state");
    if (st?.language) init(st.language);
  } catch { }
  document.title = t("c.title");
  $btn.textContent = t("c.btn");
  document.querySelector(".cap-foot").textContent = t("c.foot");
  status(t("c.preparing"));
  detail("");

  // Привязка к активной попытке claim (claim_id приходит из pending-хранилища).
  let info;
  try {
    info = await invoke("claim_pending_info");
    claimId = info?.claimId || null;
  } catch (e) {
    setState("fatal_error", "err");
    status(t("c.cfgUnavailable"), "err");
    detail(t("c.cfgUnavailableDetail"));
    detail(stripErr(e));
    return;
  }

  let cfg;
  try {
    cfg = await invoke("claim_captcha_config");
  } catch (e) {
    setState("retryable_error", "err");
    status(t("c.cfgFail"), "err");
    detail(stripErr(e));
    showRetry();
    return;
  }
  if (!cfg.enabled || !cfg.scene_id) {
    setState("fatal_error", "err");
    status(t("c.cfgUnavailable"), "err");
    detail(t("c.cfgUnavailableDetail"));
    return;
  }
  region = cfg.region || null;

  // Загрузка SDK: таймаут + до трёх попыток.
  setState("loading_sdk", "run");
  status(t("c.preparing"));
  let sdkReady = false;
  for (let attempt = 1; attempt <= MAX_SDK_ATTEMPTS; attempt++) {
    try {
      await loadSdk();
      sdkReady = true;
      break;
    } catch (e) {
      if (attempt >= MAX_SDK_ATTEMPTS || canceled) {
        setState("retryable_error", "err");
        status(e.message || t("c.sdkFail"), "err");
        showRetry();
        return;
      }
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
  if (!sdkReady) return;

  window.AliyunCaptchaConfig = { region: cfg.region, prefix: cfg.prefix };

  const submit = (param) => {
    if (submitted || !param || !param.trim()) return;
    submitted = true;
    clearTimeout(tracelessTimer);
    setState("submitting", "run");
    status(t("c.passed"));
    const req = invoke("claim_captcha_submit", { claimId, param, region });
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error(t("c.timedOut"))), SUBMIT_TIMEOUT_MS),
    );
    Promise.race([req, timeout])
      .then(() => {
        // Успех/ошибка уже приходят событием claim://result; окно закроет бэкенд.
        setState("success", "ok");
      })
      .catch((e) => {
        setState("retryable_error", "err");
        status(t("c.claimReqFail"), "err");
        detail(stripErr(e));
        notifyStuck();
        showRetry();
      });
  };

  const interactive = (why) => {
    notifyStuck();
    clearTimeout(tracelessTimer);
    setState("interactive", "run");
    status(t("c.interactive"));
    $btn.hidden = false;
    $btn.focus();
    if (why) detail(typeof why === "string" ? why.slice(0, 120) : JSON.stringify(why).slice(0, 120));
  };

  try {
    window.initAliyunCaptcha({
      SceneId: cfg.scene_id,
      mode: "popup",
      language: lang() === "zh" ? "zh-CN" : "en",
      showErrorTip: false,
      element: "#cap-holder",
      button: "#cap-btn",
      getInstance: (instance) => {
        if (canceled || submitted) return;
        // Сервер просит пропустить невидимую проверку — сразу ручной режим.
        if (cfg.skip_model_request) {
          interactive("skip_model_request");
          return;
        }
        if (typeof instance.startTracelessVerification === "function") {
          setState("traceless", "run");
          instance.startTracelessVerification();
          tracelessTimer = setTimeout(interactive, TRACELESS_TIMEOUT);
        } else {
          interactive();
        }
      },
      success: (param) => submit(typeof param === "string" ? param : param?.captchaVerifyParam),
      fail: (p) => interactive(p),
      onError: (p) => interactive(p),
    });
  } catch (e) {
    setState("fatal_error", "err");
    status(t("c.initFail"), "err");
    detail(String(e));
  }
}

$btn.addEventListener("click", () => {
  if ($btn.dataset.retry) {
    retries += 1;
    if (retries > MAX_RETRIES) {
      setState("fatal_error", "err");
      status(t("c.cfgUnavailable"), "err");
      return;
    }
    clearRetry();
    run();
    return;
  }
  if (!$btn.hidden) status(t("c.inPopup"));
});

run();
