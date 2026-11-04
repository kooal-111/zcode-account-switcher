use crate::quota;
use crate::zcrypto;
use chrono::Local;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

pub const BILLING_PREVIEW_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/preview";
pub const BILLING_CLAIM_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/claim";
pub const CLIENT_CONFIGS_URL: &str = "https://zcode.z.ai/api/v1/client/configs";
pub const MARKETING_TOUCH_URL: &str = "https://zcode.z.ai/api/v1/marketing/touch";

const CLAIM_TIMEOUT_SECS: u64 = 25;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClaimGrant {
    pub name: String,
    pub units: f64,
    pub period: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClaimPlan {
    pub plan_id: String,
    pub name: String,
    pub description: String,
    pub priority: i64,
    pub grant_items: Vec<ClaimGrant>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptchaConfig {
    pub enabled: bool,
    pub region: String,
    pub prefix: String,
    pub scene_id: String,
    pub skip_model_request: bool,
}

pub fn requires_request_verification(config: &CaptchaConfig) -> bool {
    config.enabled && !config.skip_model_request
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimOutcome {
    pub claim_id: String,
    pub account_id: String,
    pub account_name: String,
    pub plan_name: String,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub server_time: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ClaimError {
    pub code: i64,
    pub message: String,
    pub next_at: Option<i64>,
}

impl From<String> for ClaimError {
    fn from(message: String) -> Self {
        ClaimError {
            code: -1,
            message,
            next_at: None,
        }
    }
}

// Сервер присылает код и числом, и строкой ("0", "1001") — принимаем оба варианта.
pub(crate) fn response_code(v: &Value) -> Option<i64> {
    match v.get("code") {
        Some(Value::Number(n)) => n.as_i64(),
        Some(Value::String(s)) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn claim_error(code: i64, body: &Value) -> ClaimError {
    let next_at = if code == 1005 {
        body.pointer("/data/plan/ends_at")
            .and_then(|x| x.as_i64())
            .map(|s| s * 1000)
    } else {
        None
    };
    ClaimError {
        code,
        message: failure_message(code, body),
        next_at,
    }
}

pub fn failure_payload(
    claim_id: &str,
    account_id: &str,
    account_name: &str,
    plan_name: &str,
    err: &ClaimError,
) -> Value {
    serde_json::json!({
        "ok": false,
        "claimId": claim_id,
        "accountId": account_id,
        "accountName": account_name,
        "planName": plan_name,
        "code": err.code,
        "nextAt": err.next_at,
        "message": err.message,
    })
}

fn claim_token(creds: &Value, config: Option<&Value>, secret: &str) -> Result<String, String> {
    let jwt = creds
        .get("zcodejwttoken")
        .and_then(|v| v.as_str())
        .and_then(|v| decrypt_credential(v, secret));
    if let Some(t) = jwt.filter(|t| t.trim().len() > 20) {
        return Ok(t);
    }
    if let Some(t) = quota::zai_billing_token(creds, config, secret) {
        return Ok(t);
    }
    Err(crate::i18n::tr("err.claim.no_jwt"))
}

fn decrypt_credential(v: &str, secret: &str) -> Option<String> {
    if zcrypto::is_encrypted(v) {
        zcrypto::decrypt_with_secret(v, secret).ok()
    } else {
        Some(v.to_string())
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(CLAIM_TIMEOUT_SECS))
        .build()
}

pub const EVENT_REPORT_URL: &str = "https://zcode.z.ai/api/v1/event/report";
const APP_LAUNCH_REFRESH_SECS: i64 = 10 * 60;
const ACTIVATION_TIMEOUT_SECS: u64 = 10;
static ACTIVATION_CACHE_LOCK: Mutex<()> = Mutex::new(());
static MARKETING_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivationEvent {
    AppLaunch,
    DailyActive,
}

impl ActivationEvent {
    fn element(self) -> &'static str {
        match self {
            Self::AppLaunch => "app_launch",
            Self::DailyActive => "app_daily_active",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ActivationDue {
    pub app_launch: bool,
    pub daily_active: bool,
}

pub(crate) fn telemetry_user_id(home: &Path, creds: &Value) -> Option<String> {
    let secret = zcrypto::default_secret(home);
    let provider = creds
        .get("oauth:active_provider")
        .and_then(|v| v.as_str())
        .and_then(|v| decrypt_credential(v, &secret))
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "zai".to_string());
    let raw = creds.get(format!("oauth:{provider}:user_info"))?.as_str()?;
    let plain = decrypt_credential(raw, &secret)?;
    let info: Value = serde_json::from_str(&plain).ok()?;
    let pick = |k: &str| {
        info.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
    };
    pick("id").or_else(|| pick("user_id")).map(String::from)
}

fn activation_event_body(
    element: &str,
    event_id: &str,
    user_id: &str,
    mid: &str,
    screen_resolution: Option<String>,
) -> Value {
    let mut body = serde_json::json!({
        "event_id": event_id,
        "client_timezone": quota::client_timezone(),
        "client_language": quota::ZCODE_LANG,
        "element_name": element,
        "event_region": "app",
        "event_type": "view",
        "event_text": "",
        "event_extra_detail": { "ui_mode": "code" },
        "user_id": user_id,
        "app_version": quota::zcode_app_version(),
        "device_os_category": device_os_category(),
        "device_os_version": quota::os_version().unwrap_or_default(),
        "device_mid": mid,
        "mac_id": "",
        "marketing_params": "{}",
    });
    // Реальное разрешение экрана вместо фиксированного; неизвестно — поле не отправляем.
    if let Some(res) = screen_resolution {
        body["screen_resolution"] = Value::String(res);
    }
    body
}

fn device_os_category() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        _ => "linux",
    }
}

pub(crate) fn report_activation_event(
    home: &Path,
    creds: &Value,
    config: Option<&Value>,
    event: ActivationEvent,
    user_id: &str,
    device_mid: &str,
    screen_resolution: Option<String>,
) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(ACTIVATION_TIMEOUT_SECS))
        .build();
    let body = activation_event_body(
        event.element(),
        &uuid::Uuid::new_v4().to_string(),
        user_id,
        device_mid,
        screen_resolution,
    );
    let secret = zcrypto::default_secret(home);
    let token = claim_token(creds, config, &secret)?;
    let mut req = agent.post(EVENT_REPORT_URL);
    for (key, value) in quota::zai_billing_headers_with_mid(&token, Some(device_mid.to_string())) {
        req = req.set(&key, &value);
    }
    let resp = req
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| crate::i18n::trf("err.claim.activate_req", &[("e", http_err("", e).trim())]))?
        .into_string()
        .map_err(|e| crate::i18n::trf("err.claim.activate_req", &[("e", &e.to_string())]))?;
    let v: Value = serde_json::from_str(&resp).unwrap_or(Value::String(resp));
    let code = response_code(&v).unwrap_or(-1);
    if code != 0 {
        return Err(failure_message(code, &v));
    }
    Ok(())
}

pub fn preview_plans(
    home: &Path,
    creds: &Value,
    config: Option<&Value>,
    device_mid: Option<String>,
) -> Result<Vec<ClaimPlan>, String> {
    let secret = zcrypto::default_secret(home);
    let token = claim_token(creds, config, &secret)?;
    let url = format!(
        "{BILLING_PREVIEW_URL}?app_version={}&platform={}",
        quota::zcode_app_version(),
        quota::client_platform()
    );
    preview_once(&url, &token, device_mid)
}

/// Returns every currently claimable plan exposed by either server channel.
/// Recent Z Code campaigns may be delivered through marketing/touch without
/// appearing in billing/preview, so callers must use this function for both
/// display and the final pre-claim validation.
pub fn collect_claimable_plans(
    home: &Path,
    creds: &Value,
    config: Option<&Value>,
    device_mid: String,
) -> Result<Vec<ClaimPlan>, String> {
    let preview = preview_plans(home, creds, config, Some(device_mid.clone()));
    let marketing = marketing_touch_plans(home, creds, config, Some(device_mid));

    match (preview, marketing) {
        (Ok(base), Ok(extra)) => Ok(merge_claim_plans(base, extra)),
        (Ok(base), Err(_)) if !base.is_empty() => Ok(base),
        (Err(_), Ok(extra)) if !extra.is_empty() => Ok(extra),
        (Ok(_), Err(marketing_error)) => Err(format!("marketing/touch: {marketing_error}")),
        (Err(preview_error), Ok(_)) => Err(preview_error),
        (Err(preview_error), Err(marketing_error)) => Err(format!(
            "{preview_error}; marketing/touch: {marketing_error}"
        )),
    }
}

fn marketing_touch_plans(
    home: &Path,
    creds: &Value,
    config: Option<&Value>,
    device_mid: Option<String>,
) -> Result<Vec<ClaimPlan>, String> {
    let secret = zcrypto::default_secret(home);
    let token = claim_token(creds, config, &secret)?;
    // Официальный клиент увеличивает seq на каждом опросе. Это также не даёт
    // промежуточному кэшу удержать пустой ответ после включения акции.
    let seq = MARKETING_SEQ.fetch_add(1, Ordering::Relaxed);
    let url = format!("{MARKETING_TOUCH_URL}?seq={seq}");
    let mut req = agent().get(&url);
    for (key, value) in quota::zai_billing_headers_with_mid(&token, device_mid) {
        req = req.set(&key, &value);
    }
    let body = req
        .call()
        .map_err(|e| http_err("marketing/touch", e))?
        .into_string()
        .map_err(|e| crate::i18n::trf("err.http.read", &[("e", &e.to_string())]))?;
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::String(body));
    let code = response_code(&value).unwrap_or(-1);
    if code != 0 {
        return Err(failure_message(code, &value));
    }

    let mut plans = Vec::new();
    let mut action_plans = Vec::new();
    if let Some(deliveries) = value.pointer("/data/deliveries").and_then(Value::as_array) {
        for delivery in deliveries {
            walk_marketing_delivery(delivery, &mut plans, &mut action_plans);
        }
    }
    for (plan_id, action_text) in action_plans {
        if !plans.iter().any(|plan| plan.plan_id == plan_id) {
            plans.push(ClaimPlan {
                name: action_text.unwrap_or_else(|| plan_id.clone()),
                plan_id,
                description: String::new(),
                priority: 0,
                grant_items: Vec::new(),
            });
        }
    }
    plans.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.plan_id.cmp(&b.plan_id)));
    plans.dedup_by(|a, b| a.plan_id == b.plan_id);
    Ok(plans)
}

fn walk_marketing_delivery(
    value: &Value,
    plans: &mut Vec<ClaimPlan>,
    action_plans: &mut Vec<(String, Option<String>)>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                walk_marketing_delivery(item, plans, action_plans);
            }
        }
        Value::Object(map) => {
            if let Some(action) = map.get("action").and_then(Value::as_object) {
                let kind = action
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if kind == "claim_zcode_plan" || kind == "claim_plan" {
                    let plan_id = action
                        .get("args")
                        .and_then(|args| args.get("plan_id"))
                        .and_then(Value::as_str)
                        .or_else(|| action.get("planId").and_then(Value::as_str))
                        .map(str::trim)
                        .filter(|id| !id.is_empty());
                    if let Some(plan_id) = plan_id {
                        let text = map
                            .get("text")
                            .and_then(|value| value.get("content"))
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty())
                            .map(String::from);
                        action_plans.push((plan_id.to_string(), text));
                    }
                }
            }
            if let Some(plan) = parse_plan(value) {
                plans.push(plan);
            }
            for nested in map.values() {
                walk_marketing_delivery(nested, plans, action_plans);
            }
        }
        _ => {}
    }
}

fn merge_claim_plans(mut base: Vec<ClaimPlan>, extra: Vec<ClaimPlan>) -> Vec<ClaimPlan> {
    for plan in extra {
        if let Some(existing) = base.iter_mut().find(|item| item.plan_id == plan.plan_id) {
            if existing.description.is_empty() {
                existing.description = plan.description;
            }
            if existing.grant_items.is_empty() {
                existing.grant_items = plan.grant_items;
            }
        } else {
            base.push(plan);
        }
    }
    base.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.plan_id.cmp(&b.plan_id)));
    base
}

fn http_err(prefix: &str, e: ureq::Error) -> String {
    if let ureq::Error::Status(code, resp) = e {
        let body = resp.into_string().unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                ["msg", "message", "error"]
                    .iter()
                    .find_map(|k| v.get(k).and_then(|x| x.as_str()).map(String::from))
            })
            .unwrap_or_default();
        return format!("{prefix} HTTP {code}: {msg}");
    }
    format!("{prefix} {e}")
}

fn preview_once(url: &str, token: &str, mid: Option<String>) -> Result<Vec<ClaimPlan>, String> {
    let dump = std::env::var("ZSW_DUMP_PREVIEW").ok().as_deref() == Some("1");
    let mut resp_body = String::new();
    // Мягкий ретрай на 429 (rate limit): две паузы, суммарно ~2.8 с.
    for attempt in 0..3 {
        let mut req = agent().get(url);
        for (k, v) in quota::zai_billing_headers_with_mid(token, mid.clone()) {
            req = req.set(&k, &v);
        }
        match req.call() {
            Ok(resp) => {
                resp_body = resp
                    .into_string()
                    .map_err(|e| crate::i18n::trf("err.http.read", &[("e", &e.to_string())]))?;
                break;
            }
            Err(ureq::Error::Status(429, _)) if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(800 * (attempt as u64 + 1)));
                continue;
            }
            Err(e) => return Err(http_err(&crate::i18n::tr("err.claim.preview_req"), e)),
        }
    }
    let resp = resp_body;
    let v: Value = serde_json::from_str(&resp).unwrap_or(Value::String(resp));
    if dump {
        // Не печатаем ответ целиком: сервер может со временем добавить в него
        // персональные поля. Для диагностики достаточно code и plans.
        let safe = serde_json::json!({
            "code": response_code(&v),
            "plans": v.pointer("/data/plans").cloned().unwrap_or(Value::Null),
        });
        eprintln!("[zsw] preview response: {safe}");
    }
    let code = response_code(&v).unwrap_or(-1);
    if code != 0 {
        return Err(failure_message(code, &v));
    }
    let plans = v
        .pointer("/data/plans")
        .and_then(|p| p.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out: Vec<ClaimPlan> = plans.iter().filter_map(parse_plan).collect();
    out.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.plan_id.cmp(&b.plan_id)));
    Ok(out)
}

pub fn submit_claim(
    home: &Path,
    creds: &Value,
    config: Option<&Value>,
    plan_id: &str,
    captcha_param: &str,
    captcha_region: Option<&str>,
    device_mid: Option<String>,
) -> Result<Value, ClaimError> {
    let secret = zcrypto::default_secret(home);
    let token = claim_token(creds, config, &secret)?;
    let mut req = agent().post(BILLING_CLAIM_URL);
    for (k, v) in quota::zai_billing_headers_with_mid(&token, device_mid) {
        req = req.set(&k, &v);
    }
    if !captcha_param.trim().is_empty() {
        req = req.set("X-Aliyun-Captcha-Verify-Param", captcha_param.trim());
        if let Some(r) = captcha_region.filter(|r| !r.trim().is_empty()) {
            req = req.set("X-Aliyun-Captcha-Verify-Region", r.trim());
        }
    }
    let resp = req
        .send_json(serde_json::json!({ "plan_id": plan_id }))
        .map_err(|e| ClaimError {
            code: -1,
            message: http_err(&crate::i18n::tr("err.claim.claim_req"), e),
            next_at: None,
        })?
        .into_string()
        .map_err(|e| ClaimError {
            code: -1,
            message: crate::i18n::trf("err.http.read", &[("e", &e.to_string())]),
            next_at: None,
        })?;
    let v: Value = serde_json::from_str(&resp).unwrap_or(Value::String(resp));
    let code = response_code(&v).unwrap_or(-1);
    if code != 0 {
        return Err(claim_error(code, &v));
    }
    Ok(v)
}

// Для публичного эндпоинта пустой "Authorization: Bearer" не отправляем вовсе.
fn filter_public_headers(headers: Vec<(String, String)>) -> Vec<(String, String)> {
    headers
        .into_iter()
        .filter(|(k, v)| !(k == "Authorization" && v.trim().eq_ignore_ascii_case("Bearer")))
        .collect()
}

pub fn fetch_captcha_config() -> Result<CaptchaConfig, String> {
    let mut req = agent().get(CLIENT_CONFIGS_URL);
    for (k, v) in filter_public_headers(quota::zai_billing_headers("")) {
        req = req.set(&k, &v);
    }
    let resp = req
        .call()
        .map_err(|e| crate::i18n::trf("err.claim.config_req", &[("e", &e.to_string())]))?
        .into_string()
        .map_err(|e| crate::i18n::trf("err.http.read", &[("e", &e.to_string())]))?;
    let v: Value = serde_json::from_str(&resp).unwrap_or(Value::String(resp));
    if response_code(&v).unwrap_or(-1) != 0 {
        return Err(crate::i18n::tr("err.claim.config_unavailable"));
    }
    Ok(parse_captcha_config(&v))
}

fn parse_captcha_config(v: &Value) -> CaptchaConfig {
    let c = v
        .pointer("/data/configs/captcha")
        .cloned()
        .unwrap_or(Value::Null);
    let s = |k: &str| {
        c.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string()
    };
    CaptchaConfig {
        enabled: c.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false),
        region: s("region"),
        prefix: s("prefix"),
        scene_id: s("sceneId"),
        skip_model_request: c
            .get("skip_model_request")
            .and_then(|x| x.as_bool())
            .or_else(|| c.get("skipModelRequest").and_then(|x| x.as_bool()))
            .unwrap_or(false),
    }
}

fn str_field<'a>(e: &'a Value, snake: &str, camel: &str) -> Option<&'a str> {
    e.get(snake)
        .and_then(|v| v.as_str())
        .or_else(|| e.get(camel).and_then(|v| v.as_str()))
}

fn num_field(e: &Value, snake: &str, camel: &str) -> Option<f64> {
    e.get(snake)
        .and_then(|v| v.as_f64())
        .or_else(|| e.get(camel).and_then(|v| v.as_f64()))
}

fn parse_plan(p: &Value) -> Option<ClaimPlan> {
    let plan_id = str_field(p, "plan_id", "planId")?.trim().to_string();
    if plan_id.is_empty() {
        return None;
    }
    let grant_items: Vec<ClaimGrant> = p
        .get("entitlements")
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|e| {
                    str_field(e, "meter", "meter") == Some("model_usage")
                        && str_field(e, "unit_type", "unitType") == Some("token")
                        && str_field(e, "show_name", "showName")
                            .map(|s| !s.trim().is_empty())
                            .unwrap_or(false)
                })
                .map(|e| ClaimGrant {
                    name: str_field(e, "show_name", "showName")
                        .unwrap_or("")
                        .to_string(),
                    units: num_field(e, "grant_units", "grantUnits").unwrap_or(0.0),
                    period: str_field(e, "period", "period")
                        .unwrap_or("one_time")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    Some(ClaimPlan {
        name: p
            .get("name")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
        description: p
            .get("description")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .trim()
            .to_string(),
        priority: p.get("priority").and_then(|x| x.as_i64()).unwrap_or(0),
        plan_id,
        grant_items,
    })
}

// --- Дедупликация activation-телеметрии -------------------------------------
// Ключ = sha256(user_id | deviceMid | app_version): сам deviceMid нигде не хранится.
// app_daily_active отправляется раз в локальный день, как в официальном клиенте.
// app_launch можно повторить после cooldown: иначе акция, включённая уже после
// первого фонового прохода за день, остаётся невидимой до следующего дня.

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ActivationCacheEntry {
    daily_date: Option<String>,
    launch_at: Option<i64>,
}

fn activation_cache_path(home: &Path) -> PathBuf {
    home.join(".zcode-switch")
        .join("state")
        .join("activation-cache.json")
}

fn activation_cache_key(user_id: &str, device_mid: &str, app_version: &str) -> String {
    let mut h = Sha256::new();
    h.update(user_id.as_bytes());
    h.update(b"|");
    h.update(device_mid.as_bytes());
    h.update(b"|");
    h.update(app_version.as_bytes());
    format!("{:x}", h.finalize())
}

fn load_activation_cache(home: &Path) -> HashMap<String, ActivationCacheEntry> {
    let raw = std::fs::read_to_string(activation_cache_path(home)).unwrap_or_default();
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| {
            let version = v.get("v").and_then(Value::as_i64).unwrap_or(1);
            v.get("entries")
                .and_then(|e| e.as_object())
                .cloned()
                .map(|entries| (version, entries))
        })
        .map(|(version, obj)| {
            obj.into_iter()
                .filter_map(|(k, v)| {
                    // v1: значение было строкой с датой. Сохраняем дедупликацию
                    // daily, но считаем launch просроченным, чтобы обновление
                    // сразу устранило суточную слепую зону.
                    if let Some(daily_date) = v.as_str() {
                        return Some((
                            k,
                            ActivationCacheEntry {
                                daily_date: Some(daily_date.to_string()),
                                launch_at: None,
                            },
                        ));
                    }
                    let entry = ActivationCacheEntry {
                        daily_date: v
                            .get("daily_date")
                            .and_then(Value::as_str)
                            .map(String::from),
                        // v2 мог отметить анонимный event/report как успешный:
                        // до v3 запрос не содержал Authorization. Один раз
                        // освобождаем launch, сохраняя daily-дедупликацию.
                        launch_at: (version >= 3)
                            .then(|| v.get("launch_at").and_then(Value::as_i64))
                            .flatten(),
                    };
                    (entry.daily_date.is_some() || entry.launch_at.is_some()).then_some((k, entry))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn save_activation_cache(
    home: &Path,
    entries: HashMap<String, ActivationCacheEntry>,
    today: &str,
    now: i64,
) {
    // Старые версии клиента/аккаунты не должны бесконечно раздувать файл.
    let keep_after = now.saturating_sub(7 * 24 * 60 * 60);
    let kept: serde_json::Map<String, Value> = entries
        .into_iter()
        .filter(|(_, e)| {
            e.daily_date.as_deref() == Some(today)
                || e.launch_at.is_some_and(|launch_at| launch_at >= keep_after)
        })
        .map(|(k, e)| {
            (
                k,
                serde_json::json!({
                    "daily_date": e.daily_date,
                    "launch_at": e.launch_at,
                }),
            )
        })
        .collect();
    let body = serde_json::json!({ "v": 3, "entries": kept });
    let path = activation_cache_path(home);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_string(&body).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

pub(crate) fn activation_due(
    home: &Path,
    user_id: &str,
    device_mid: &str,
    app_version: &str,
    today: &str,
    now: i64,
) -> ActivationDue {
    let key = activation_cache_key(user_id, device_mid, app_version);
    let entry = load_activation_cache(home).remove(&key).unwrap_or_default();
    ActivationDue {
        app_launch: entry
            .launch_at
            .is_none_or(|last| last > now || now.saturating_sub(last) >= APP_LAUNCH_REFRESH_SECS),
        daily_active: entry.daily_date.as_deref() != Some(today),
    }
}

pub(crate) fn mark_activation_sent(
    home: &Path,
    user_id: &str,
    device_mid: &str,
    app_version: &str,
    today: &str,
    now: i64,
    event: ActivationEvent,
) {
    // preview-очередь выполняет два аккаунта параллельно; сериализуем
    // read-modify-write, чтобы один аккаунт не затёр отметку другого.
    let _cache_guard = ACTIVATION_CACHE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let key = activation_cache_key(user_id, device_mid, app_version);
    let mut entries = load_activation_cache(home);
    let entry = entries.entry(key).or_default();
    match event {
        ActivationEvent::AppLaunch => entry.launch_at = Some(now),
        ActivationEvent::DailyActive => entry.daily_date = Some(today.to_string()),
    }
    save_activation_cache(home, entries, today, now);
}

pub(crate) fn activation_today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub(crate) fn activation_now() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn failure_message(code: i64, body: &Value) -> String {
    let server_msg = ["msg", "message"]
        .iter()
        .find_map(|k| body.get(k).and_then(|x| x.as_str()).map(String::from))
        .unwrap_or_default();
    let base = crate::i18n::tr(match code {
        1001 => "claim.fail.1001",
        1002 => "claim.fail.1002",
        1003 => "claim.fail.1003",
        1004 => "claim.fail.1004",
        1005 => "claim.fail.1005",
        3001 => "claim.fail.3001",
        3007 => "claim.fail.3007",
        401 => "claim.fail.401",
        _ => "claim.fail.generic",
    });
    if server_msg.is_empty() {
        base
    } else {
        crate::i18n::trf(
            "claim.fail.with_server",
            &[("base", &base), ("server_msg", &server_msg)],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> Value {
        let raw = match name {
            "preview_two_plans.json" => include_str!("../tests/fixtures/preview_two_plans.json"),
            "preview_unknown_fields.json" => {
                include_str!("../tests/fixtures/preview_unknown_fields.json")
            }
            "claim_error_1005.json" => include_str!("../tests/fixtures/claim_error_1005.json"),
            "captcha_enabled_camel.json" => {
                include_str!("../tests/fixtures/captcha_enabled_camel.json")
            }
            "captcha_skip_snake.json" => include_str!("../tests/fixtures/captcha_skip_snake.json"),
            "captcha_disabled.json" => include_str!("../tests/fixtures/captcha_disabled.json"),
            other => panic!("unknown fixture: {other}"),
        };
        serde_json::from_str(raw).unwrap()
    }

    #[test]
    fn response_code_accepts_number_and_string() {
        assert_eq!(response_code(&json!({ "code": 0 })), Some(0));
        assert_eq!(response_code(&json!({ "code": "0" })), Some(0));
        assert_eq!(response_code(&json!({ "code": 1001 })), Some(1001));
        assert_eq!(response_code(&json!({ "code": "1001" })), Some(1001));
        assert_eq!(response_code(&json!({ "code": " 3007 " })), Some(3007));
        assert_eq!(response_code(&json!({ "code": "abc" })), None);
        assert_eq!(response_code(&json!({})), None);
    }

    #[test]
    fn parse_plan_structured_grants_and_sort() {
        let v = fixture("preview_two_plans.json");
        let plans: Vec<ClaimPlan> = v
            .pointer("/data/plans")
            .and_then(|p| p.as_array())
            .unwrap()
            .iter()
            .filter_map(parse_plan)
            .collect();
        let mut sorted = plans;
        sorted.sort_by(|a, b| b.priority.cmp(&a.priority).then(a.plan_id.cmp(&b.plan_id)));
        assert_eq!(sorted[0].plan_id, "p-weekend");
        assert_eq!(sorted[0].priority, 10);
        let g = &sorted[0].grant_items[0];
        assert_eq!(g.name, "GLM-5.3");
        assert_eq!(g.units, 1500000.0);
        assert_eq!(g.period, "daily");
        // Китайские строки в Rust больше не формируются
        assert!(serde_json::to_string(&sorted[0])
            .unwrap()
            .find("每日")
            .is_none());
        assert!(serde_json::to_string(&sorted[0])
            .unwrap()
            .find("亿")
            .is_none());
    }

    #[test]
    fn parse_plan_survives_unknown_fields() {
        let v = fixture("preview_unknown_fields.json");
        let plan = v
            .pointer("/data/plans")
            .and_then(|p| p.as_array())
            .unwrap()
            .iter()
            .find_map(parse_plan)
            .expect("plan parsed");
        assert_eq!(plan.plan_id, "p-unknown");
    }

    #[test]
    fn marketing_delivery_finds_embedded_and_action_only_plans() {
        let delivery = json!({
            "banner": {
                "background": {
                    "args": {
                        "zcode_plan": {
                            "plan_id": "promo-full",
                            "name": "Full promo",
                            "description": "Today only",
                            "priority": 7,
                            "entitlements": [{
                                "meter": "model_usage",
                                "unit_type": "token",
                                "name": "GLM",
                                "quota": 12345,
                                "period": "daily"
                            }]
                        }
                    }
                },
                "buttons": [{
                    "text": { "format": "plaintext", "content": "Claim today bonus" },
                    "action": {
                        "type": "claim_zcode_plan",
                        "args": { "plan_id": "promo-action-only" }
                    }
                }]
            }
        });
        let mut plans = Vec::new();
        let mut ids = Vec::new();
        walk_marketing_delivery(&delivery, &mut plans, &mut ids);
        assert!(plans.iter().any(|plan| plan.plan_id == "promo-full"));
        assert!(ids
            .iter()
            .any(|(id, text)| id == "promo-action-only"
                && text.as_deref() == Some("Claim today bonus")));
    }

    #[test]
    fn merged_claim_plans_deduplicate_and_keep_preview_details() {
        let preview = ClaimPlan {
            plan_id: "same".into(),
            name: "Preview name".into(),
            description: "Preview description".into(),
            priority: 10,
            grant_items: vec![ClaimGrant {
                name: "GLM".into(),
                units: 10.0,
                period: "daily".into(),
            }],
        };
        let marketing = ClaimPlan {
            plan_id: "same".into(),
            name: "Marketing name".into(),
            description: "Marketing description".into(),
            priority: 0,
            grant_items: Vec::new(),
        };
        let merged = merge_claim_plans(vec![preview], vec![marketing]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].name, "Preview name");
        assert_eq!(merged[0].description, "Preview description");
        assert_eq!(merged[0].grant_items.len(), 1);
    }

    #[test]
    fn captcha_config_camel_snake_and_disabled() {
        let cfg = parse_captcha_config(&fixture("captcha_enabled_camel.json"));
        assert!(cfg.enabled);
        assert!(cfg.skip_model_request);
        assert!(!requires_request_verification(&cfg));
        assert_eq!(cfg.scene_id, "scene-123");
        let cfg = parse_captcha_config(&fixture("captcha_skip_snake.json"));
        assert!(cfg.skip_model_request);
        assert!(!requires_request_verification(&cfg));
        let cfg = parse_captcha_config(&fixture("captcha_disabled.json"));
        assert!(!cfg.enabled);
        assert!(!cfg.skip_model_request);
        assert!(!requires_request_verification(&cfg));

        let required = CaptchaConfig {
            enabled: true,
            region: "cn".into(),
            prefix: "prefix".into(),
            scene_id: "scene".into(),
            skip_model_request: false,
        };
        assert!(requires_request_verification(&required));
    }

    #[test]
    fn public_headers_drop_empty_bearer() {
        let headers = quota::zai_billing_headers("");
        let filtered = filter_public_headers(headers);
        assert!(
            !filtered
                .iter()
                .any(|(k, v)| k == "Authorization" && v.trim().eq_ignore_ascii_case("Bearer")),
            "пустой Authorization не должен отправляться"
        );
        let headers = quota::zai_billing_headers("token-abc");
        let filtered = filter_public_headers(headers);
        assert!(filtered
            .iter()
            .any(|(k, v)| k == "Authorization" && v == "Bearer token-abc"));
    }

    #[test]
    fn failure_message_maps_known_codes() {
        let body = json!({ "code": 1001, "msg": "server says no" });
        let msg = failure_message(1001, &body);
        assert!(!msg.is_empty());
        assert!(msg.contains("server says no"));
        let generic = failure_message(424242, &json!({}));
        assert!(!generic.is_empty());
    }

    #[test]
    fn claim_error_1005_parses_next_at() {
        let err = claim_error(1005, &fixture("claim_error_1005.json"));
        assert_eq!(err.code, 1005);
        assert_eq!(err.next_at, Some(1_700_000_000_000));
    }

    #[test]
    fn activation_cache_dedup_and_privacy() {
        let home = std::env::temp_dir().join(format!("zsw-act-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let today = "2030-01-02";
        let now = 1_893_456_000;
        assert_eq!(
            activation_due(&home, "user-a", "mid-1", "3.17.1", today, now),
            ActivationDue {
                app_launch: true,
                daily_active: true,
            }
        );
        mark_activation_sent(
            &home,
            "user-a",
            "mid-1",
            "3.17.1",
            today,
            now,
            ActivationEvent::DailyActive,
        );
        let due = activation_due(&home, "user-a", "mid-1", "3.17.1", today, now);
        assert!(due.app_launch);
        assert!(!due.daily_active);
        mark_activation_sent(
            &home,
            "user-a",
            "mid-1",
            "3.17.1",
            today,
            now,
            ActivationEvent::AppLaunch,
        );
        assert_eq!(
            activation_due(&home, "user-a", "mid-1", "3.17.1", today, now),
            ActivationDue {
                app_launch: false,
                daily_active: false,
            }
        );
        assert!(
            activation_due(
                &home,
                "user-a",
                "mid-1",
                "3.17.1",
                today,
                now + APP_LAUNCH_REFRESH_SECS
            )
            .app_launch
        );
        // Сдвиг часов назад не должен навсегда заморозить app_launch.
        assert!(activation_due(&home, "user-a", "mid-1", "3.17.1", today, now - 1).app_launch);
        // другой аккаунт/девайс/версия — другой ключ
        assert!(activation_due(&home, "user-b", "mid-1", "3.17.1", today, now).daily_active);
        assert!(activation_due(&home, "user-a", "mid-2", "3.17.1", today, now).daily_active);
        assert!(activation_due(&home, "user-a", "mid-1", "3.18.0", today, now).daily_active);
        // в файле нет сырого deviceMid и user_id
        let raw = std::fs::read_to_string(activation_cache_path(&home)).unwrap();
        assert!(!raw.contains("mid-1"));
        assert!(!raw.contains("user-a"));
        assert!(raw.contains("\"v\":3"));
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn activation_cache_v1_keeps_daily_but_releases_launch() {
        let home = std::env::temp_dir().join(format!("zsw-act-v1-{}", uuid::Uuid::new_v4()));
        let path = activation_cache_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let key = activation_cache_key("user-a", "mid-1", "3.17.1");
        std::fs::write(
            &path,
            serde_json::json!({ "v": 1, "entries": { key: "2030-01-02" } }).to_string(),
        )
        .unwrap();

        assert_eq!(
            activation_due(
                &home,
                "user-a",
                "mid-1",
                "3.17.1",
                "2030-01-02",
                1_893_456_000,
            ),
            ActivationDue {
                app_launch: true,
                daily_active: false,
            }
        );
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn activation_cache_v2_releases_unauthenticated_launch() {
        let home = std::env::temp_dir().join(format!("zsw-act-v2-{}", uuid::Uuid::new_v4()));
        let path = activation_cache_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let key = activation_cache_key("user-a", "mid-1", "3.17.2");
        std::fs::write(
            &path,
            serde_json::json!({
                "v": 2,
                "entries": {
                    key: { "daily_date": "2030-01-02", "launch_at": 1_893_456_000 }
                }
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(
            activation_due(
                &home,
                "user-a",
                "mid-1",
                "3.17.2",
                "2030-01-02",
                1_893_456_001,
            ),
            ActivationDue {
                app_launch: true,
                daily_active: false,
            }
        );
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn activation_cache_parallel_accounts_do_not_overwrite_each_other() {
        let home = std::sync::Arc::new(
            std::env::temp_dir().join(format!("zsw-act-race-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir_all(home.as_ref()).unwrap();
        let today = "2030-01-02";
        let now = 1_893_456_000;
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let home = home.clone();
                std::thread::spawn(move || {
                    let user = format!("user-{i}");
                    let mid = format!("mid-{i}");
                    mark_activation_sent(
                        home.as_ref(),
                        &user,
                        &mid,
                        "3.17.2",
                        today,
                        now,
                        ActivationEvent::AppLaunch,
                    );
                    mark_activation_sent(
                        home.as_ref(),
                        &user,
                        &mid,
                        "3.17.2",
                        today,
                        now,
                        ActivationEvent::DailyActive,
                    );
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        for i in 0..8 {
            let due = activation_due(
                home.as_ref(),
                &format!("user-{i}"),
                &format!("mid-{i}"),
                "3.17.2",
                today,
                now,
            );
            assert_eq!(
                due,
                ActivationDue {
                    app_launch: false,
                    daily_active: false,
                }
            );
        }
        std::fs::remove_dir_all(home.as_ref()).ok();
    }
}
