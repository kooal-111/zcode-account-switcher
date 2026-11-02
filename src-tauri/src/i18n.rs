
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Zh,
    En,
    Ru,
}

impl Lang {
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Zh => "zh",
            Lang::En => "en",
            Lang::Ru => "ru",
        }
    }
    pub fn locale_tag(self) -> &'static str {
        match self {
            Lang::Zh => "zh-CN",
            Lang::En => "en",
            Lang::Ru => "ru-RU",
        }
    }
    pub fn parse(s: &str) -> Option<Lang> {
        match s.trim().to_ascii_lowercase().as_str() {
            "zh" | "zh-cn" | "zh_cn" | "zh-hans" => Some(Lang::Zh),
            "en" | "en-us" | "en-gb" | "en-us-posix" => Some(Lang::En),
            "ru" | "ru-ru" | "ru_ru" => Some(Lang::Ru),
            _ => None,
        }
    }
}

static LANG: RwLock<Lang> = RwLock::new(Lang::Zh);

fn lang_cell() -> std::sync::RwLockReadGuard<'static, Lang> {
    LANG.read().unwrap_or_else(|e| e.into_inner())
}

pub fn current() -> Lang {
    *lang_cell()
}

pub fn set(lang: Lang) {
    *LANG.write().unwrap_or_else(|e| e.into_inner()) = lang;
}

pub fn resolve(explicit: Option<&str>) -> Lang {
    if let Some(l) = explicit.and_then(Lang::parse) {
        return l;
    }
    if let Some(os) = sys_locale::get_locale() {
        let l = os.to_ascii_lowercase();
        if l.starts_with("zh") {
            return Lang::Zh;
        }
        if l.starts_with("ru") {
            return Lang::Ru;
        }
        return Lang::En;
    }
    Lang::Zh
}

pub fn init_from_settings(s: &crate::store::Settings) {
    set(resolve(s.language.as_deref()));
}

const ZH: &[(&str, &str)] = &[
    ("err.write", "写入失败：{e}"),
    ("err.write_file", "写入失败 {path}: {e}"),
    ("err.rename_fail", "落盘失败 {path}: {e}"),
    ("err.read", "无法读取 {path}: {e}"),
    ("err.bad_json", "{path} 不是有效的 JSON：{e}"),
    ("err.mkdir", "无法创建目录：{e}"),
    ("err.serialize", "序列化失败：{e}"),
    ("err.store.mk_accounts_dir", "无法创建账号库目录：{e}"),
    ("err.store.not_object", "credentials.json 内容不是对象"),
    ("err.store.list_fail", "读取账号库失败：{e}"),
    ("err.store.bad_id", "非法的账号 id"),
    ("err.store.no_account_id", "账号不存在：{id}"),
    ("err.store.corrupt", "账号存档损坏：{e}"),
    ("err.store.no_account", "账号不存在"),
    ("err.store.delete_fail", "删除失败：{e}"),
    ("err.name.empty", "名称不能为空"),
    ("err.name.too_long", "名称过长（最多 40 字符）"),
    ("err.name.taken", "名称「{name}」已被账号「{other}」占用"),
    ("err.live.no_creds_file", "当前没有 credentials.json，请先在 ZCode 里登录"),
    ("err.live.no_credentials", "当前文件里没有登录凭据（未登录）"),
    ("err.live.dup_saved", "当前登录已保存为「{name}」，无需重复保存"),
    ("err.live.no_file", "当前没有登录文件"),
    ("err.live.logged_out", "当前未登录"),
    ("err.live.same", "当前登录与「{name}」一致，请直接切换"),
    ("err.live.quota", "当前未登录，无法查询额度"),
    ("err.switch.running", "ZCode 正在运行，请先完全退出（含托盘），或使用强制切换（自动关闭并重启）"),
    ("err.switch.kill_timeout", "关闭 ZCode 超时，已取消切换（避免登录态损坏）"),
    ("err.write_config", "写入 config 失败：{e}"),
    ("err.hot.verify", "热切换校验失败：ZCode 并发回写冲突，已重试 3 次。建议改用重启式切换"),
    ("err.zcode.missing", "ZCode 不存在：{path}（在设置里修改路径）"),
    ("err.zcode.launch", "启动失败：{e}"),
    ("err.zcode.path_invalid", "ZCode 路径无效：{p}"),
    ("err.zcode.path_invalid_hint", "ZCode 路径无效：{p}（在设置里修改）"),
    ("err.zcode.kill_timeout", "关闭 ZCode 超时"),
    ("err.cipher.pw_empty", "密码不能为空（导出文件包含登录凭据，必须加密）"),
    ("err.cipher.key", "密钥错误：{e}"),
    ("err.cipher.encrypt", "加密失败：{e}"),
    ("err.cipher.no_kdf", "文件缺少 kdf 段（不是有效的加密导出）"),
    ("err.cipher.no_cipher", "文件缺少 cipher 段"),
    ("err.cipher.bad_salt", "salt 解码失败"),
    ("err.cipher.bad_nonce", "nonce 解码失败"),
    ("err.cipher.bad_tag", "tag 解码失败"),
    ("err.cipher.bad_data", "数据解码失败"),
    ("err.cipher.nonce_len", "nonce 长度异常"),
    ("err.cipher.wrong_pw", "密码错误或文件已损坏"),
    ("err.cipher.bad_plain", "解密后内容异常：{e}"),
    ("err.bundle.no_accounts", "捆绑包缺少 accounts 数组"),
    ("err.bundle.no_creds", "捆绑包条目缺少 credentials"),
    ("err.bundle.unrecognized", "无法识别的文件格式（仅支持本工具导出的加密捆绑包 .zsb）"),
    ("err.import.no_creds", "{fname}：无登录凭据"),
    ("err.import.wrap", "{fname}：{e}"),
    ("err.import.dup", "{fname}：已存在于账号库"),
    ("err.import.read", "{fname}：读取失败 {e}"),
    ("err.import.not_sealed", "{fname}：不是加密捆绑包（仅支持本工具导出的 .zsb）"),
    ("err.import.not_bundle", "{fname}：不是捆绑包格式（仅支持导出全部生成的 .zsb）"),
    ("err.import.json", "{fname}：JSON 解析失败 {e}"),
    ("err.import.not_sealed_plain", "不是加密捆绑包（仅支持本工具导出的 .zsb）"),
    ("err.import.not_bundle_plain", "不是捆绑包格式（仅支持导出全部生成的 .zsb）"),
    ("err.export.empty", "账号库为空，没有可导出的内容"),
    ("err.export.empty_short", "账号库为空"),
    ("tray.show", "显示主窗口"),
    ("tray.capture", "保存当前登录"),
    ("tray.launch", "启动 ZCode"),
    ("tray.kill", "关闭 ZCode"),
    ("tray.quit", "退出"),
    ("tray.unsaved", "未保存的登录"),
    ("tray.logged_out", "未登录"),
    ("title.login", "登录 ZCode 账号"),
    ("title.captcha", "安全验证"),
    ("title.settings", "Z·SWITCH 设置"),
    ("dialog.zsb", "ZSwitch 加密捆绑包（.zsb）"),
    ("dialog.exe", "ZCode 可执行文件"),
    ("err.main.missing", "主窗口不存在"),
    ("err.path.invalid", "路径无效：{e}"),
    ("err.path.conv", "路径错误：{e}"),
    ("err.oauth.unknown_provider", "未知登录提供方：{provider}"),
    ("err.proxy.invalid", "代理地址无效：{e}"),
    ("err.oauth.appdata", "无法定位应用数据目录：{e}"),
    ("err.oauth.bad_authorize_url", "authorize URL 非法：{e}"),
    ("err.oauth.window", "登录窗口创建失败：{e}"),
    ("err.proxy.need_url", "开启代理前请先填写代理地址（http:// 或 socks5://）"),
    ("err.oauth.state", "OAuth state 校验失败，请重新发起登录"),
    ("err.oauth.flow", "登录流程异常：{e}"),
    ("err.oauth.not_callback", "不是 OAuth 回调地址"),
    ("err.oauth.bad_cb", "回调参数格式错误"),
    ("err.oauth.no_code_state", "回调缺少 code 或 state"),
    ("err.oauth.init", "OAuth flow 初始化失败：{e}"),
    ("err.oauth.init_invalid", "OAuth flow 初始化响应无效"),
    ("err.oauth.init_invalid_msg", "OAuth flow 初始化失败：{msg}"),
    ("err.oauth.flow_failed", "OAuth flow 授权失败"),
    ("err.oauth.poll_invalid", "OAuth flow 查询响应无效"),
    ("err.oauth.poll_invalid_msg", "OAuth flow 查询失败：{msg}"),
    ("err.oauth.poll_terminal", "OAuth flow 已失效（HTTP {code}）"),
    ("err.oauth.zai_business", "z.ai 业务令牌换取失败，请重新登录"),
    ("err.oauth.expired", "OAuth 登录流程已过期，请重新发起"),
    ("err.oauth.exchange_req", "token 交换请求失败：{e}"),
    ("err.oauth.exchange", "token 交换失败（{code}）：{msg}"),
    ("err.oauth.no_token", "token 交换成功但响应缺少 token 字段"),
    ("err.proxy.empty", "代理地址不能为空"),
    ("err.proxy.scheme", "地址需以 http:// 或 socks5:// 开头（如 http://127.0.0.1:7890）"),
    ("err.proxy.no_auth", "代理不支持账号密码认证，请使用免认证的本地代理"),
    ("err.proxy.no_path", "代理地址不包含路径，只需 scheme://主机:端口"),
    ("err.proxy.need_port", "代理地址必须带端口（如 :7890）"),
    ("err.proxy.empty_host", "代理主机不能为空"),
    ("err.proxy.bad_host", "代理主机格式不正确"),
    ("err.proxy.port_nan", "端口“{port}”不是数字"),
    ("err.proxy.port_range", "端口 {port} 超出范围（1-65535）"),
    ("err.http.read", "读取响应失败：{e}"),
    ("err.token.biz401", "Token 已过期或无效（业务码 401）"),
    ("err.quota.rate_limited", "服务端限流，正在重试..."),
    ("err.quota.http429", "额度接口 HTTP 429"),
    ("err.token.http401", "Token 已过期或无效（HTTP {code}）"),
    ("err.quota.http", "额度接口 HTTP {code}: {msg}"),
    ("err.network", "网络请求失败：{e}"),
    ("err.quota.biz", "业务码 {code}: {msg}"),
    ("err.quota.bad_resp", "额度接口返回异常"),
    ("err.quota.fail", "额度查询失败"),
    ("err.quota.no_token", "未找到可用于查询额度的 ZCode token，请先登录或切换账号"),
    ("err.token.expired", "该账号 Token 已过期，请删除后重新登录"),
    ("probe.no_entitlement", "服务端该账号当前没有可用套餐/模型（可能试用已耗尽或被风控），ZCode 里模型列表会为空"),
    ("probe.auth_failed", "该账号 token 已被服务端拒绝，请在 ZCode 内重新登录此账号后再切换"),
    ("err.claim.no_jwt", "该账号缺少 zcodejwttoken 凭证，请先在 ZCode 客户端登录一次刷新"),
    ("err.claim.preview_req", "preview 请求失败"),
    ("err.claim.claim_req", "领取请求失败"),
    ("err.claim.no_captcha", "验证码参数为空，请重试"),
    ("err.claim.config_req", "配置请求失败：{e}"),
    ("err.claim.config_unavailable", "验证码配置不可用"),
    ("err.claim.gone", "该套餐已不可领取，请刷新"),
    ("err.claim.none_pending", "没有待领取的套餐"),
  ("err.claim.pending", "Уже идёт получение другого пакета — дождитесь завершения"),
  ("err.claim.mismatch", "Получение было отменено или заменено — начните заново"),
  ("err.claim.no_user_info", "В аккаунте нет данных входа — выполните повторный вход в Z Code"),
  ("err.task.join", "Фоновая задача завершилась ошибкой: {e}"),
    ("err.claim.activate_req", "激活上报失败：{e}"),
    ("claim.fail.1001", "套餐不存在"),
    ("claim.fail.1002", "活动已结束或套餐暂不可领取"),
    ("claim.fail.1003", "该套餐已经领取过"),
    ("claim.fail.1004", "不符合领取条件"),
    ("claim.fail.1005", "今日领取名额已用完"),
    ("claim.fail.3001", "领取参数错误，请刷新后重试"),
    ("claim.fail.3007", "验证码校验失败，请重试"),
    ("claim.fail.401", "请先登录后再领取"),
    ("claim.fail.generic", "领取失败"),
    ("claim.fail.with_server", "{base}（{server_msg}）"),
    ("cli.pw_hint", "缺少密码：用环境变量 ZSW_PASSWORD（推荐，不会出现在进程列表/命令历史）或 --password <密码>"),
    ("cli.missing_cmd", "缺少子命令：state|list|capture|rename|delete|update|switch|quota|claim-preview|kill|export|export-all|import|behavior|setpath|launch"),
    ("cli.usage.rename", "用法：rename --id <id> --name <名称>"),
    ("cli.usage.delete", "用法：delete --id <id>"),
    ("cli.usage.update", "用法：update --id <id>"),
    ("cli.usage.switch", "用法：switch --id <id> [--force] [--restart|--no-restart]"),
    ("cli.usage.export", "用法：export --id <id> --out <file.zsb>（密码：ZSW_PASSWORD 或 --password）"),
    ("cli.usage.export_all", "用法：export-all --out <file.zsb>（密码：ZSW_PASSWORD 或 --password）"),
    ("cli.usage.import", "用法：import --file <file.zsb>（密码：ZSW_PASSWORD 或 --password）"),
    ("cli.usage.setpath", "用法：setpath --path <ZCode.exe>"),
    ("cli.unknown_cmd", "未知子命令：{cmd}"),
    ("cli.read_fail", "读取失败：{e}"),
    ("cli.json_fail", "JSON 解析失败：{e}"),
    ("err.lang.unknown", "未知语言：{lang}（支持 zh / en / ru）"),
];

const EN: &[(&str, &str)] = &[
    ("err.write", "Write failed: {e}"),
    ("err.write_file", "Write failed {path}: {e}"),
    ("err.rename_fail", "Persist failed {path}: {e}"),
    ("err.read", "Cannot read {path}: {e}"),
    ("err.bad_json", "{path} is not valid JSON: {e}"),
    ("err.mkdir", "Cannot create directory: {e}"),
    ("err.serialize", "Serialization failed: {e}"),
    ("err.store.mk_accounts_dir", "Cannot create the account store directory: {e}"),
    ("err.store.not_object", "credentials.json is not an object"),
    ("err.store.list_fail", "Failed to read the account store: {e}"),
    ("err.store.bad_id", "Invalid account id"),
    ("err.store.no_account_id", "Account not found: {id}"),
    ("err.store.corrupt", "Account archive corrupted: {e}"),
    ("err.store.no_account", "Account not found"),
    ("err.store.delete_fail", "Delete failed: {e}"),
    ("err.name.empty", "Name cannot be empty"),
    ("err.name.too_long", "Name too long (max 40 characters)"),
    ("err.name.taken", "Name \"{name}\" is already used by account \"{other}\""),
    ("err.live.no_creds_file", "No credentials.json present — log in inside ZCode first"),
    ("err.live.no_credentials", "Current file has no login credentials (not logged in)"),
    ("err.live.dup_saved", "Current login is already saved as \"{name}\""),
    ("err.live.no_file", "No login file present"),
    ("err.live.logged_out", "Not logged in"),
    ("err.live.same", "Current login already matches \"{name}\" — just switch to it"),
    ("err.live.quota", "Not logged in — cannot query quota"),
    ("err.switch.running", "ZCode is running. Quit it fully (including the tray icon), or use Force switch (auto close & restart)"),
    ("err.switch.kill_timeout", "Timed out closing ZCode — switch cancelled to protect the login state"),
    ("err.write_config", "Failed to write config: {e}"),
    ("err.hot.verify", "Hot-switch verification failed: ZCode wrote back concurrently (3 retries). Prefer restart-style switching"),
    ("err.zcode.missing", "ZCode not found: {path} (change the path in Settings)"),
    ("err.zcode.launch", "Launch failed: {e}"),
    ("err.zcode.path_invalid", "Invalid ZCode path: {p}"),
    ("err.zcode.path_invalid_hint", "Invalid ZCode path: {p} (change it in Settings)"),
    ("err.zcode.kill_timeout", "Timed out closing ZCode"),
    ("err.cipher.pw_empty", "Password cannot be empty (exports contain login credentials and must be encrypted)"),
    ("err.cipher.key", "Key error: {e}"),
    ("err.cipher.encrypt", "Encryption failed: {e}"),
    ("err.cipher.no_kdf", "File is missing the kdf section (not a valid encrypted export)"),
    ("err.cipher.no_cipher", "File is missing the cipher section"),
    ("err.cipher.bad_salt", "salt decode failed"),
    ("err.cipher.bad_nonce", "nonce decode failed"),
    ("err.cipher.bad_tag", "tag decode failed"),
    ("err.cipher.bad_data", "data decode failed"),
    ("err.cipher.nonce_len", "abnormal nonce length"),
    ("err.cipher.wrong_pw", "Wrong password or corrupted file"),
    ("err.cipher.bad_plain", "Decrypted payload is invalid: {e}"),
    ("err.bundle.no_accounts", "Bundle is missing the accounts array"),
    ("err.bundle.no_creds", "Bundle entry is missing credentials"),
    ("err.bundle.unrecognized", "Unrecognized file format (only encrypted .zsb bundles exported by this tool are supported)"),
    ("err.import.no_creds", "{fname}: no login credentials"),
    ("err.import.wrap", "{fname}: {e}"),
    ("err.import.dup", "{fname}: already in the account store"),
    ("err.import.read", "{fname}: read failed {e}"),
    ("err.import.not_sealed", "{fname}: not an encrypted bundle (only .zsb exported by this tool)"),
    ("err.import.not_bundle", "{fname}: not a bundle (only .zsb generated by Export All)"),
    ("err.import.json", "{fname}: JSON parse failed {e}"),
    ("err.import.not_sealed_plain", "Not an encrypted bundle (only .zsb exported by this tool)"),
    ("err.import.not_bundle_plain", "Not a bundle (only .zsb generated by Export All)"),
    ("err.export.empty", "The account store is empty — nothing to export"),
    ("err.export.empty_short", "The account store is empty"),
    ("tray.show", "Show main window"),
    ("tray.capture", "Save current login"),
    ("tray.launch", "Launch ZCode"),
    ("tray.kill", "Quit ZCode"),
    ("tray.quit", "Exit"),
    ("tray.unsaved", "Unsaved login"),
    ("tray.logged_out", "Not logged in"),
    ("title.login", "Sign in to ZCode"),
    ("title.captcha", "Security verification"),
    ("title.settings", "Z·SWITCH Settings"),
    ("dialog.zsb", "ZSwitch encrypted bundle (.zsb)"),
    ("dialog.exe", "ZCode executable"),
    ("err.main.missing", "Main window not found"),
    ("err.path.invalid", "Invalid path: {e}"),
    ("err.path.conv", "Path error: {e}"),
    ("err.oauth.unknown_provider", "Unknown login provider: {provider}"),
    ("err.proxy.invalid", "Invalid proxy address: {e}"),
    ("err.oauth.appdata", "Cannot locate the app data directory: {e}"),
    ("err.oauth.bad_authorize_url", "Invalid authorize URL: {e}"),
    ("err.oauth.window", "Failed to create the login window: {e}"),
    ("err.proxy.need_url", "Enter a proxy address (http:// or socks5://) before enabling the proxy"),
    ("err.oauth.state", "OAuth state check failed — start the login again"),
    ("err.oauth.flow", "Login flow error: {e}"),
    ("err.oauth.not_callback", "Not an OAuth callback URL"),
    ("err.oauth.bad_cb", "Malformed callback parameters"),
    ("err.oauth.no_code_state", "Callback is missing code or state"),
    ("err.oauth.init", "OAuth flow init failed: {e}"),
    ("err.oauth.init_invalid", "Invalid OAuth flow init response"),
    ("err.oauth.init_invalid_msg", "OAuth flow init failed: {msg}"),
    ("err.oauth.flow_failed", "OAuth flow authorization failed"),
    ("err.oauth.poll_invalid", "Invalid OAuth flow poll response"),
    ("err.oauth.poll_invalid_msg", "OAuth flow poll failed: {msg}"),
    ("err.oauth.poll_terminal", "OAuth flow invalidated (HTTP {code})"),
    ("err.oauth.zai_business", "Failed to resolve the z.ai business token — log in again"),
    ("err.oauth.expired", "The OAuth login flow expired — start it again"),
    ("err.oauth.exchange_req", "Token exchange request failed: {e}"),
    ("err.oauth.exchange", "Token exchange failed ({code}): {msg}"),
    ("err.oauth.no_token", "Token exchange succeeded but the response has no token field"),
    ("err.proxy.empty", "Proxy address cannot be empty"),
    ("err.proxy.scheme", "Address must start with http:// or socks5:// (e.g. http://127.0.0.1:7890)"),
    ("err.proxy.no_auth", "Proxies with username/password auth are not supported — use a local proxy without auth"),
    ("err.proxy.no_path", "Proxy address takes no path, only scheme://host:port"),
    ("err.proxy.need_port", "Proxy address must include a port (e.g. :7890)"),
    ("err.proxy.empty_host", "Proxy host cannot be empty"),
    ("err.proxy.bad_host", "Malformed proxy host"),
    ("err.proxy.port_nan", "Port \"{port}\" is not a number"),
    ("err.proxy.port_range", "Port {port} out of range (1-65535)"),
    ("err.http.read", "Failed to read response: {e}"),
    ("err.token.biz401", "Token expired or invalid (business code 401)"),
    ("err.quota.rate_limited", "Server rate limit, retrying..."),
    ("err.quota.http429", "Quota API HTTP 429"),
    ("err.token.http401", "Token expired or invalid (HTTP {code})"),
    ("err.quota.http", "Quota API HTTP {code}: {msg}"),
    ("err.network", "Network request failed: {e}"),
    ("err.quota.biz", "Business code {code}: {msg}"),
    ("err.quota.bad_resp", "Quota API returned an unexpected response"),
    ("err.quota.fail", "Quota query failed"),
    ("err.quota.no_token", "No usable ZCode token found — log in or switch accounts first"),
    ("err.token.expired", "This account's token has expired — delete it and log in again"),
    ("probe.no_entitlement", "The server reports no usable plan/models for this account (trial exhausted or risk-controlled) — the model list in ZCode will be empty"),
    ("probe.auth_failed", "This account's token was rejected by the server — re-login this account in ZCode, then switch again"),
    ("err.claim.no_jwt", "This account has no zcodejwttoken credential — log in once in the ZCode client to refresh it"),
    ("err.claim.preview_req", "Preview request failed"),
    ("err.claim.claim_req", "Claim request failed"),
    ("err.claim.no_captcha", "Captcha parameter is empty — retry"),
    ("err.claim.config_req", "Config request failed: {e}"),
    ("err.claim.config_unavailable", "Captcha config unavailable"),
    ("err.claim.gone", "This plan is no longer claimable — refresh the list"),
    ("err.claim.none_pending", "No pending plan to claim"),
  ("err.claim.pending", "A claim is already in progress — wait for it to finish"),
  ("err.claim.mismatch", "The claim was canceled or replaced — start again"),
  ("err.claim.no_user_info", "This account has no login info — re-login in Z Code"),
  ("err.task.join", "Background task failed: {e}"),
    ("err.claim.activate_req", "Activation report failed: {e}"),
    ("claim.fail.1001", "Plan does not exist"),
    ("claim.fail.1002", "The event has ended or the plan is not claimable yet"),
    ("claim.fail.1003", "This plan has already been claimed"),
    ("claim.fail.1004", "Not eligible for this plan"),
    ("claim.fail.1005", "Today's claim quota is used up"),
    ("claim.fail.3001", "Claim parameter error — refresh and retry"),
    ("claim.fail.3007", "Captcha verification failed — retry"),
    ("claim.fail.401", "Log in before claiming"),
    ("claim.fail.generic", "Claim failed"),
    ("claim.fail.with_server", "{base} ({server_msg})"),
    ("cli.pw_hint", "Missing password: set the ZSW_PASSWORD env var (recommended — never appears in process lists or shell history) or pass --password <password>"),
    ("cli.missing_cmd", "Missing subcommand: state|list|capture|rename|delete|update|switch|quota|claim-preview|kill|export|export-all|import|behavior|setpath|launch"),
    ("cli.usage.rename", "Usage: rename --id <id> --name <name>"),
    ("cli.usage.delete", "Usage: delete --id <id>"),
    ("cli.usage.update", "Usage: update --id <id>"),
    ("cli.usage.switch", "Usage: switch --id <id> [--force] [--restart|--no-restart]"),
    ("cli.usage.export", "Usage: export --id <id> --out <file.zsb> (password: ZSW_PASSWORD or --password)"),
    ("cli.usage.export_all", "Usage: export-all --out <file.zsb> (password: ZSW_PASSWORD or --password)"),
    ("cli.usage.import", "Usage: import --file <file.zsb> (password: ZSW_PASSWORD or --password)"),
    ("cli.usage.setpath", "Usage: setpath --path <ZCode.exe>"),
    ("cli.unknown_cmd", "Unknown subcommand: {cmd}"),
    ("cli.read_fail", "Read failed: {e}"),
    ("cli.json_fail", "JSON parse failed: {e}"),
    ("err.lang.unknown", "Unknown language: {lang} (supported: zh / en / ru)"),
];

const RU: &[(&str, &str)] = &[
    ("err.write", "Ошибка записи: {e}"),
    ("err.write_file", "Ошибка записи {path}: {e}"),
    ("err.rename_fail", "Не удалось сохранить на диск {path}: {e}"),
    ("err.read", "Не удалось прочитать {path}: {e}"),
    ("err.bad_json", "{path} — недопустимый JSON: {e}"),
    ("err.mkdir", "Не удалось создать каталог: {e}"),
    ("err.serialize", "Ошибка сериализации: {e}"),
    ("err.store.mk_accounts_dir", "Не удалось создать каталог библиотеки аккаунтов: {e}"),
    ("err.store.not_object", "Содержимое credentials.json не является объектом"),
    ("err.store.list_fail", "Не удалось прочитать библиотеку аккаунтов: {e}"),
    ("err.store.bad_id", "Недопустимый id аккаунта"),
    ("err.store.no_account_id", "Аккаунт не найден: {id}"),
    ("err.store.corrupt", "Архив аккаунта повреждён: {e}"),
    ("err.store.no_account", "Аккаунт не найден"),
    ("err.store.delete_fail", "Не удалось удалить: {e}"),
    ("err.name.empty", "Имя не может быть пустым"),
    ("err.name.too_long", "Имя слишком длинное (максимум 40 символов)"),
    ("err.name.taken", "Имя «{name}» уже занято аккаунтом «{other}»"),
    ("err.live.no_creds_file", "Файл credentials.json отсутствует — сначала выполните вход в ZCode"),
    ("err.live.no_credentials", "В текущем файле нет учётных данных (вход не выполнен)"),
    ("err.live.dup_saved", "Текущий вход уже сохранён как «{name}»"),
    ("err.live.no_file", "Файл входа отсутствует"),
    ("err.live.logged_out", "Вход не выполнен"),
    ("err.live.same", "Текущий вход совпадает с «{name}» — просто переключитесь на него"),
    ("err.live.quota", "Вход не выполнен — квоту запросить нельзя"),
    ("err.switch.running", "ZCode запущен. Полностью закройте его (включая значок в трее) или используйте принудительное переключение (автозакрытие и перезапуск)"),
    ("err.switch.kill_timeout", "Не удалось закрыть ZCode за отведённое время — переключение отменено, чтобы не повредить состояние входа"),
    ("err.write_config", "Не удалось записать config: {e}"),
    ("err.hot.verify", "Проверка горячего переключения не пройдена: ZCode параллельно перезаписал файл (3 попытки). Лучше использовать переключение с перезапуском"),
    ("err.zcode.missing", "ZCode не найден: {path} (измените путь в настройках)"),
    ("err.zcode.launch", "Не удалось запустить: {e}"),
    ("err.zcode.path_invalid", "Недопустимый путь к ZCode: {p}"),
    ("err.zcode.path_invalid_hint", "Недопустимый путь к ZCode: {p} (измените его в настройках)"),
    ("err.zcode.kill_timeout", "Не удалось закрыть ZCode за отведённое время"),
    ("err.cipher.pw_empty", "Пароль не может быть пустым (экспорт содержит учётные данные для входа и должен быть зашифрован)"),
    ("err.cipher.key", "Ошибка ключа: {e}"),
    ("err.cipher.encrypt", "Ошибка шифрования: {e}"),
    ("err.cipher.no_kdf", "В файле нет секции kdf (это не зашифрованный экспорт)"),
    ("err.cipher.no_cipher", "В файле нет секции cipher"),
    ("err.cipher.bad_salt", "не удалось декодировать salt"),
    ("err.cipher.bad_nonce", "не удалось декодировать nonce"),
    ("err.cipher.bad_tag", "не удалось декодировать tag"),
    ("err.cipher.bad_data", "не удалось декодировать данные"),
    ("err.cipher.nonce_len", "некорректная длина nonce"),
    ("err.cipher.wrong_pw", "Неверный пароль или файл повреждён"),
    ("err.cipher.bad_plain", "Расшифрованные данные некорректны: {e}"),
    ("err.bundle.no_accounts", "В связке отсутствует массив accounts"),
    ("err.bundle.no_creds", "В записи связки отсутствуют credentials"),
    ("err.bundle.unrecognized", "Неизвестный формат файла (поддерживаются только зашифрованные связки .zsb, созданные этим инструментом)"),
    ("err.import.no_creds", "{fname}: нет учётных данных"),
    ("err.import.wrap", "{fname}: {e}"),
    ("err.import.dup", "{fname}: уже есть в библиотеке аккаунтов"),
    ("err.import.read", "{fname}: ошибка чтения {e}"),
    ("err.import.not_sealed", "{fname}: это не зашифрованная связка (поддерживаются только .zsb, созданные этим инструментом)"),
    ("err.import.not_bundle", "{fname}: это не формат связки (только .zsb из «Экспортировать все»)"),
    ("err.import.json", "{fname}: ошибка разбора JSON {e}"),
    ("err.import.not_sealed_plain", "Это не зашифрованная связка (поддерживаются только .zsb, созданные этим инструментом)"),
    ("err.import.not_bundle_plain", "Это не формат связки (только .zsb из «Экспортировать все»)"),
    ("err.export.empty", "Библиотека аккаунтов пуста — экспортировать нечего"),
    ("err.export.empty_short", "Библиотека аккаунтов пуста"),
    ("tray.show", "Показать главное окно"),
    ("tray.capture", "Сохранить текущий вход"),
    ("tray.launch", "Запустить ZCode"),
    ("tray.kill", "Закрыть ZCode"),
    ("tray.quit", "Выход"),
    ("tray.unsaved", "Несохранённый вход"),
    ("tray.logged_out", "Вход не выполнен"),
    ("title.login", "Вход в аккаунт ZCode"),
    ("title.captcha", "Проверка безопасности"),
    ("title.settings", "Настройки Z·SWITCH"),
    ("dialog.zsb", "Зашифрованная связка ZSwitch (.zsb)"),
    ("dialog.exe", "Исполняемый файл ZCode"),
    ("err.main.missing", "Главное окно не найдено"),
    ("err.path.invalid", "Недопустимый путь: {e}"),
    ("err.path.conv", "Ошибка пути: {e}"),
    ("err.oauth.unknown_provider", "Неизвестный поставщик входа: {provider}"),
    ("err.proxy.invalid", "Недопустимый адрес прокси: {e}"),
    ("err.oauth.appdata", "Не удалось найти каталог данных приложения: {e}"),
    ("err.oauth.bad_authorize_url", "Недопустимый authorize URL: {e}"),
    ("err.oauth.window", "Не удалось создать окно входа: {e}"),
    ("err.proxy.need_url", "Перед включением прокси укажите его адрес (http:// или socks5://)"),
    ("err.oauth.state", "Проверка OAuth state не пройдена — запустите вход заново"),
    ("err.oauth.flow", "Ошибка процесса входа: {e}"),
    ("err.oauth.not_callback", "Это не адрес OAuth-обратного вызова"),
    ("err.oauth.bad_cb", "Некорректные параметры обратного вызова"),
    ("err.oauth.no_code_state", "В обратном вызове отсутствуют code или state"),
    ("err.oauth.init", "Ошибка инициализации OAuth-процесса: {e}"),
    ("err.oauth.init_invalid", "Недопустимый ответ инициализации OAuth-процесса"),
    ("err.oauth.init_invalid_msg", "Ошибка инициализации OAuth-процесса: {msg}"),
    ("err.oauth.flow_failed", "Авторизация OAuth-процесса не удалась"),
    ("err.oauth.poll_invalid", "Недопустимый ответ опроса OAuth-процесса"),
    ("err.oauth.poll_invalid_msg", "Ошибка опроса OAuth-процесса: {msg}"),
    ("err.oauth.poll_terminal", "OAuth-процесс отозван (HTTP {code})"),
    ("err.oauth.zai_business", "Не удалось получить бизнес-токен z.ai — выполните вход заново"),
    ("err.oauth.expired", "Срок действия OAuth-входа истёк — запустите его заново"),
    ("err.oauth.exchange_req", "Ошибка запроса обмена токена: {e}"),
    ("err.oauth.exchange", "Ошибка обмена токена ({code}): {msg}"),
    ("err.oauth.no_token", "Обмен токена прошёл успешно, но в ответе нет поля token"),
    ("err.proxy.empty", "Адрес прокси не может быть пустым"),
    ("err.proxy.scheme", "Адрес должен начинаться с http:// или socks5:// (например http://127.0.0.1:7890)"),
    ("err.proxy.no_auth", "Прокси с авторизацией по логину/паролю не поддерживаются — используйте локальный прокси без авторизации"),
    ("err.proxy.no_path", "Адрес прокси не должен содержать путь, только scheme://хост:порт"),
    ("err.proxy.need_port", "Адрес прокси должен содержать порт (например :7890)"),
    ("err.proxy.empty_host", "Хост прокси не может быть пустым"),
    ("err.proxy.bad_host", "Некорректный хост прокси"),
    ("err.proxy.port_nan", "Порт «{port}» — не число"),
    ("err.proxy.port_range", "Порт {port} вне диапазона (1–65535)"),
    ("err.http.read", "Не удалось прочитать ответ: {e}"),
    ("err.token.biz401", "Токен истёк или недействителен (бизнес-код 401)"),
    ("err.quota.rate_limited", "Ограничение частоты на сервере, повторяем..."),
    ("err.quota.http429", "API квот вернул HTTP 429"),
    ("err.token.http401", "Токен истёк или недействителен (HTTP {code})"),
    ("err.quota.http", "API квот вернул HTTP {code}: {msg}"),
    ("err.network", "Сетевой запрос не удался: {e}"),
    ("err.quota.biz", "Бизнес-код {code}: {msg}"),
    ("err.quota.bad_resp", "API квот вернул неожиданный ответ"),
    ("err.quota.fail", "Не удалось запросить квоту"),
    ("err.quota.no_token", "Не найден пригодный токен ZCode — сначала выполните вход или переключите аккаунт"),
    ("err.token.expired", "Токен этого аккаунта истёк — удалите его и выполните вход заново"),
    ("probe.no_entitlement", "Сервер сообщает, что для этого аккаунта сейчас нет доступных пакетов/моделей (пробный период исчерпан или сработали ограничения) — список моделей в ZCode будет пуст"),
    ("probe.auth_failed", "Токен этого аккаунта отклонён сервером — выполните повторный вход в этот аккаунт в ZCode, затем переключитесь снова"),
    ("err.claim.no_jwt", "У аккаунта нет учётных данных zcodejwttoken — один раз войдите в клиенте ZCode, чтобы обновить их"),
    ("err.claim.preview_req", "Не удалось выполнить preview-запрос"),
    ("err.claim.claim_req", "Не удалось выполнить запрос получения"),
    ("err.claim.no_captcha", "Параметр капчи пуст — повторите попытку"),
    ("err.claim.config_req", "Не удалось запросить конфигурацию: {e}"),
    ("err.claim.config_unavailable", "Конфигурация капчи недоступна"),
    ("err.claim.gone", "Этот пакет больше нельзя получить — обновите список"),
    ("err.claim.none_pending", "Нет пакетов, ожидающих получения"),
  ("err.claim.pending", "Уже идёт получение другого пакета — дождитесь завершения"),
  ("err.claim.mismatch", "Получение было отменено или заменено — начните заново"),
  ("err.claim.no_user_info", "В снимке аккаунта нет данных входа — выполните повторный вход в Z Code"),
  ("err.task.join", "Фоновая задача завершилась с ошибкой: {e}"),
    ("err.claim.activate_req", "Не удалось отправить отчёт об активации: {e}"),
    ("claim.fail.1001", "Пакет не существует"),
    ("claim.fail.1002", "Акция завершена или пакет пока недоступен"),
    ("claim.fail.1003", "Этот пакет уже получен"),
    ("claim.fail.1004", "Не соответствует условиям получения"),
    ("claim.fail.1005", "Дневной лимит получения исчерпан"),
    ("claim.fail.3001", "Ошибка параметров получения — обновите и повторите"),
    ("claim.fail.3007", "Проверка капчи не пройдена — повторите попытку"),
    ("claim.fail.401", "Сначала выполните вход"),
    ("claim.fail.generic", "Не удалось получить пакет"),
    ("claim.fail.with_server", "{base} ({server_msg})"),
    ("cli.pw_hint", "Не указан пароль: задайте переменную окружения ZSW_PASSWORD (рекомендуется — не попадает в список процессов и историю команд) или передайте --password <пароль>"),
    ("cli.missing_cmd", "Отсутствует подкоманда: state|list|capture|rename|delete|update|switch|quota|claim-preview|kill|export|export-all|import|behavior|setpath|launch"),
    ("cli.usage.rename", "Использование: rename --id <id> --name <имя>"),
    ("cli.usage.delete", "Использование: delete --id <id>"),
    ("cli.usage.update", "Использование: update --id <id>"),
    ("cli.usage.switch", "Использование: switch --id <id> [--force] [--restart|--no-restart]"),
    ("cli.usage.export", "Использование: export --id <id> --out <file.zsb> (пароль: ZSW_PASSWORD или --password)"),
    ("cli.usage.export_all", "Использование: export-all --out <file.zsb> (пароль: ZSW_PASSWORD или --password)"),
    ("cli.usage.import", "Использование: import --file <file.zsb> (пароль: ZSW_PASSWORD или --password)"),
    ("cli.usage.setpath", "Использование: setpath --path <ZCode.exe>"),
    ("cli.unknown_cmd", "Неизвестная подкоманда: {cmd}"),
    ("cli.read_fail", "Не удалось прочитать: {e}"),
    ("cli.json_fail", "Ошибка разбора JSON: {e}"),
    ("err.lang.unknown", "Неизвестный язык: {lang} (поддерживается: zh / en / ru)"),
];

fn table_for(lang: Lang) -> &'static [(&'static str, &'static str)] {
    match lang {
        Lang::Zh => ZH,
        Lang::En => EN,
        Lang::Ru => RU,
    }
}

fn lookup(table: &'static [(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

pub fn tr_lang(lang: Lang, key: &str) -> String {
    match lookup(table_for(lang), key).or_else(|| lookup(ZH, key)) {
        Some(s) => s.to_string(),
        None => {
            eprintln!("[i18n] missing key: {key}");
            key.to_string()
        }
    }
}

pub fn tr(key: &str) -> String {
    tr_lang(current(), key)
}

pub fn trf(key: &str, args: &[(&str, &str)]) -> String {
    let mut s = tr(key);
    for (k, v) in args {
        s = s.replace(&format!("{{{k}}}"), v);
    }
    s
}

pub fn coded(code: &str, key: &str, args: &[(&str, &str)]) -> String {
    format!("{code}:{}", trf(key, args))
}

pub fn code_of(err: &str) -> Option<&str> {
    let (code, _) = err.split_once(':')?;
    (!code.is_empty()
        && !code.contains(' ')
        && code.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
        .then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_keys_parity_3way() {
        let mut sets: Vec<Vec<&str>> = Vec::new();
        for (name, table) in [("ZH", ZH), ("EN", EN), ("RU", RU)] {
            let mut keys: Vec<&str> = table.iter().map(|(k, _)| *k).collect();
            let n = keys.len();
            keys.sort_unstable();
            keys.dedup();
            assert_eq!(n, keys.len(), "{name}: duplicate keys");
            sets.push(keys);
        }
        assert!(sets.windows(2).all(|w| w[0] == w[1]), "zh/en/ru key sets differ");
    }

    #[test]
    fn ru_probe_and_lang_keys_exist() {
        for k in ["probe.no_entitlement", "probe.auth_failed"] {
            let s = tr_lang(Lang::Ru, k);
            assert!(!s.is_empty() && s != k, "missing RU key {k}");
        }
        assert!(tr_lang(Lang::Ru, "err.lang.unknown").contains("ru"));
    }

    #[test]
    fn trf_substitutes_placeholders() {
        assert_eq!(tr_lang(Lang::Zh, "err.zcode.path_invalid"), "ZCode 路径无效：{p}");
        let s = tr_lang(Lang::En, "err.zcode.path_invalid").replace("{p}", "X");
        assert_eq!(s, "Invalid ZCode path: X");
    }

    #[test]
    fn lang_parse_includes_ru() {
        assert_eq!(Lang::parse("ru"), Some(Lang::Ru));
        assert_eq!(Lang::parse(" ru-RU "), Some(Lang::Ru));
        assert_eq!(Lang::parse("ru_RU"), Some(Lang::Ru));
        assert_eq!(Lang::parse("fr"), None);
        assert_eq!(Lang::Ru.as_str(), "ru");
        assert_eq!(Lang::Ru.locale_tag(), "ru-RU");
    }
}
