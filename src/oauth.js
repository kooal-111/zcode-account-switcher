'use strict';
/**
 * Запись OAuth-учётных данных ZCode + снимки аккаунтов
 *
 * Процесс (CLI OAuth + системный браузер):
 *   1. oauthCli.ZaiAuthFlow.poll() после входа пользователя получает {token, zaiAccessToken, refreshToken, user}
 *      (token — zcode JWT от CLI OAuth, имеет встроенные права запроса billing)
 *   2. finishLogin(tokenSet) → writeOAuthCredentials зашифрованная запись на диск
 *   3. manager.capture() создаёт снимок аккаунта
 *
 * Этот модуль не отвечает за генерацию URL входа / сетевой обмен token
 * (это делается в oauthCli.js).
 * Здесь только: безопасная запись набора token в файлы логина ZCode + утилиты.
 */
const fs = require('fs');
const path = require('path');
const { CREDENTIALS_FILE, CONFIG_FILE } = require('./paths');
const { encrypt } = require('./zcodeCrypto');
const { extractFingerprint } = require('./fingerprint');
const manager = require('./manager');

// ===== Конфигурация Z.ai provider (поля для записи на диск) =====
// Совпадает с oauthBrowser.OAUTH; вход bigmodel убран (новый процесс — только zai)
const PROVIDER = {
  id: 'zai',
  providerIds: ['builtin:zai-start-plan', 'builtin:zai-coding-plan', 'builtin:zai'],
};

/**
 * Записать набор token в файлы логина ZCode, затем создать снимок аккаунта.
 *
 * @param {object} opts
 * @param {object} opts.tokenSet - результат oauthBrowser.exchangeToken()
 * @param {string} opts.tokenSet.token - zcode JWT (обязательно)
 * @param {string} [opts.tokenSet.zaiAccessToken] - zai oauth access_token
 * @param {string} [opts.tokenSet.refreshToken] - zai refresh_token
 * @param {object} [opts.tokenSet.user] - информация о пользователе (email/name/avatar...)
 * @param {string} [opts.label] - пользовательское имя аккаунта (если пусто — используется email)
 * @param {string} [opts.note='']
 * @param {boolean} [opts.overwrite=true]
 */
async function finishLogin({ tokenSet, label, note = '', overwrite = true } = {}) {
  if (!tokenSet || !tokenSet.token) throw new Error('Отсутствует token (zcode JWT)');

  const userInfo = normalizeUserInfo(tokenSet.user || {});

  // Сохраняем текущее состояние (снимок в память перед записью), восстанавливаем после capture
  // — чтобы добавление нового аккаунта не влияло на текущий активный аккаунт
  const prevCredentials = fs.existsSync(CREDENTIALS_FILE) ? fs.readFileSync(CREDENTIALS_FILE, 'utf8') : null;
  const prevConfig = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : null;

  // Записываем token нового аккаунта (capture нужен доступ к актуальным файлам в v2)
  writeOAuthCredentials(tokenSet, userInfo);

  const captured = manager.capture({ label, note, overwrite });

  // Восстанавливаем предыдущее состояние: записываем обратно содержимое из v2 до capture
  // Таким образом и клиент ZCode, и интерфейс инструмента видят тот же «текущий аккаунт»
  if (prevCredentials !== null) fs.writeFileSync(CREDENTIALS_FILE, prevCredentials, 'utf8');
  if (prevConfig !== null) fs.writeFileSync(CONFIG_FILE, prevConfig, 'utf8');

  return {
    userInfo,
    fingerprint: extractFingerprint(),
    account: captured.meta,
    created: captured.created,
    skipped: captured.skipped,
  };
}

/**
 * Зашифрованная запись набора token в credentials.json + config.json.
 *
 * Поля записи (соответствуют реальной структуре клиента ZCode):
 *   credentials.json:
 *     oauth:active_provider          = enc(zai)
 *     oauth:zai:access_token         = enc(zaiAccessToken)
 *     oauth:zai:refresh_token        = enc(refreshToken)
 *     oauth:zai:user_info            = enc(user JSON)
 *     zcodejwttoken                  = enc(token)            ← JWT для вызова API
 *   config.json:
 *     provider[builtin:zai-*].options.apiKey = token(открытый JWT, содержит user_id)
 */
function writeOAuthCredentials(tokenSet, userInfo = {}) {
  backupCurrentLoginState('oauth');

  const credentials = readJsonIfExists(CREDENTIALS_FILE, {});
  const config = readJsonIfExists(CONFIG_FILE, {});

  const zcodeJwtToken = tokenSet.token;          // JWT для API
  const accessToken = tokenSet.zaiAccessToken;    // zai oauth access_token
  const refreshToken = tokenSet.refreshToken;

  credentials['oauth:active_provider'] = encrypt(PROVIDER.id);
  if (accessToken) credentials[`oauth:${PROVIDER.id}:access_token`] = encrypt(accessToken);
  if (refreshToken) credentials[`oauth:${PROVIDER.id}:refresh_token`] = encrypt(refreshToken);
  if (zcodeJwtToken) credentials.zcodejwttoken = encrypt(zcodeJwtToken);
  credentials[`oauth:${PROVIDER.id}:user_info`] = encrypt(JSON.stringify(userInfo || {}));

  if (!config.provider || typeof config.provider !== 'object') config.provider = {};
  if (zcodeJwtToken) updateConfigProviders(config, PROVIDER, zcodeJwtToken);

  atomicWriteJson(CREDENTIALS_FILE, credentials);
  atomicWriteJson(CONFIG_FILE, config);

  return { credentialsFile: CREDENTIALS_FILE, configFile: CONFIG_FILE };
}

/**
 * Записать apiKey(JWT) zai в слоты provider в config.json и отключить другие provider.
 */
function updateConfigProviders(config, provider, apiKey) {
  for (const id of provider.providerIds) {
    if (!config.provider[id] || typeof config.provider[id] !== 'object') {
      config.provider[id] = { enabled: true, options: {} };
    }
    if (!config.provider[id].options || typeof config.provider[id].options !== 'object') {
      config.provider[id].options = {};
    }
    config.provider[id].enabled = true;
    config.provider[id].options.apiKey = apiKey;
  }
}

// ===== Утилиты =====

/** Нормализация объекта user из oauthBrowser в стандартный userInfo */
function normalizeUserInfo(user) {
  const u = user || {};
  return {
    email: u.email || u.mail || '',
    name: u.name || u.username || u.nickName || u.displayName || '',
    avatar: u.avatar || u.avatarUrl || u.picture || '',
    user_id: u.user_id || u.userId || u.id || u.customerNumber || u.sub || '',
  };
}

function backupCurrentLoginState(reason = 'backup') {
  const dir = path.join(__dirname, '..', '.last', reason + '-' + timestamp());
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(CREDENTIALS_FILE)) fs.copyFileSync(CREDENTIALS_FILE, path.join(dir, 'credentials.json'));
  if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, path.join(dir, 'config.json'));
  return dir;
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error('Ошибка чтения JSON ' + filePath + ': ' + e.message);
  }
}

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.zcas.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

module.exports = {
  PROVIDER,
  finishLogin,
  writeOAuthCredentials,
  updateConfigProviders,
  normalizeUserInfo,
};
