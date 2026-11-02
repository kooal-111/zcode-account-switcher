use crate::quota;
use crate::zcrypto;
use chrono::Local;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const BILLING_PREVIEW_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/preview";
pub const BILLING_CLAIM_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/claim";
pub const CLIENT_CONFIGS_URL: &str = "https://zcode.z.ai/api/v1/client/configs";

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
pub const ACTIVATION_EVENTS: [&str; 2] = ["app_launch", "app_daily_active"];
const ACTIVATION_TIMEOUT_SECS: u64 = 10;

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

pub fn report_activation_events(
    user_id: &str,
    device_mid: &str,
    screen_resolution: Option<String>,
) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(ACTIVATION_TIMEOUT_SECS))
        .build();
    for element in ACTIVATION_EVENTS {
        let body = activation_event_body(
            element,
            &uuid::Uuid::new_v4().to_string(),
            user_id,
            device_mid,
            screen_resolution.clone(),
        );
        let resp = agent
            .post(EVENT_REPORT_URL)
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|e| {
                crate::i18n::trf("err.claim.activate_req", &[("e", http_err("", e).trim())])
            })?
            .into_string()
            .map_err(|e| crate::i18n::trf("err.claim.activate_req", &[("e", &e.to_string())]))?;
        let v: Value = serde_json::from_str(&resp).unwrap_or(Value::String(resp));
        let code = response_code(&v).unwrap_or(-1);
        if code != 0 {
            return Err(failure_message(code, &v));
        }
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
// Значение = локальная дата последней успешной отправки ("YYYY-MM-DD").

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

fn load_activation_cache(home: &Path) -> HashMap<String, String> {
    let raw = std::fs::read_to_string(activation_cache_path(home)).unwrap_or_default();
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.get("entries").and_then(|e| e.as_object()).cloned())
        .map(|obj| {
            obj.into_iter()
                .filter_map(|(k, v)| v.as_str().map(|d| (k, d.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn save_activation_cache(home: &Path, entries: HashMap<String, String>, today: &str) {
    // Оставляем только записи за сегодня — файл не растёт.
    let kept: HashMap<String, String> = entries.into_iter().filter(|(_, d)| d == today).collect();
    let body = serde_json::json!({ "v": 1, "entries": kept });
    let path = activation_cache_path(home);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_string(&body).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

pub(crate) fn activation_sent_today(
    home: &Path,
    user_id: &str,
    device_mid: &str,
    app_version: &str,
    today: &str,
) -> bool {
    let key = activation_cache_key(user_id, device_mid, app_version);
    load_activation_cache(home)
        .get(&key)
        .map(|d| d == today)
        .unwrap_or(false)
}

pub(crate) fn mark_activation_sent(
    home: &Path,
    user_id: &str,
    device_mid: &str,
    app_version: &str,
    today: &str,
) {
    let key = activation_cache_key(user_id, device_mid, app_version);
    let mut entries = load_activation_cache(home);
    entries.insert(key, today.to_string());
    save_activation_cache(home, entries, today);
}

pub(crate) fn activation_today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
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
        assert!(!activation_sent_today(
            &home, "user-a", "mid-1", "3.17.1", today
        ));
        mark_activation_sent(&home, "user-a", "mid-1", "3.17.1", today);
        assert!(activation_sent_today(
            &home, "user-a", "mid-1", "3.17.1", today
        ));
        // другой аккаунт/девайс/версия — другой ключ
        assert!(!activation_sent_today(
            &home, "user-b", "mid-1", "3.17.1", today
        ));
        assert!(!activation_sent_today(
            &home, "user-a", "mid-2", "3.17.1", today
        ));
        assert!(!activation_sent_today(
            &home, "user-a", "mid-1", "3.18.0", today
        ));
        // в файле нет сырого deviceMid и user_id
        let raw = std::fs::read_to_string(activation_cache_path(&home)).unwrap();
        assert!(!raw.contains("mid-1"));
        assert!(!raw.contains("user-a"));
        std::fs::remove_dir_all(&home).ok();
    }
}
