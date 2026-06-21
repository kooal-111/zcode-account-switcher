'use strict';
/**
 * Извлечение отпечатка аккаунта
 *
 * Подход:
 *   - В config.json apiKey включённого provider — это открытый JWT (base64),
 *     payload содержит user_id — самый стабильный уникальный идентификатор аккаунта.
 *   - В credentials.json user_info/access_token зашифрованы enc:v1,
 *     подтверждена возможность дешифрования ключом, привязанным к машине,
 *     используется для отображения email/аватара/имени пользователя.
 *
 * Структура отпечатка:
 *   { userId, shortId, provider, label, email, name, avatar, capturedAt }
 */
const fs = require('fs');
const { CREDENTIALS_FILE, CONFIG_FILE } = require('./paths');
const { decrypt, decryptJson, isEncrypted } = require('./zcodeCrypto');

/**
 * Парсинг JWT payload (без проверки подписи, только чтение payload)
 * @param {string} jwt
 * @returns {object|null}
 */
function decodeJwt(jwt) {
  if (!jwt || typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    let p = parts[1];
    // base64url -> base64
    p = p.replace(/-/g, '+').replace(/_/g, '/');
    // Дополнить padding
    while (p.length % 4) p += '=';
    const json = Buffer.from(p, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

function readCredentialProfile() {
  try {
    const rawCred = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const activeProviderRaw = rawCred['oauth:active_provider'];
    let activeProvider = 'zai';
    try {
      activeProvider = isEncrypted(activeProviderRaw) ? decrypt(activeProviderRaw) : activeProviderRaw || 'zai';
    } catch (_) {}

    const userInfoKey = `oauth:${activeProvider}:user_info`;
    const userInfo = rawCred[userInfoKey] ? decryptJson(rawCred[userInfoKey]) : null;
    const accessToken = rawCred[`oauth:${activeProvider}:access_token`];
    let accessPayload = null;
    try {
      accessPayload = decodeJwt(isEncrypted(accessToken) ? decrypt(accessToken) : accessToken);
    } catch (_) {}

    return {
      activeProvider,
      email: userInfo && userInfo.email,
      name: userInfo && (userInfo.name || userInfo.username || userInfo.displayName),
      avatar: userInfo && userInfo.avatar,
      credentialUserId: userInfo && userInfo.user_id,
      customerId: accessPayload && accessPayload.customer_id,
      accessUserId: accessPayload && (accessPayload.user_id || accessPayload.sub),
      userKey: accessPayload && accessPayload.user_key,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Извлечь отпечаток аккаунта из текущих config.json + credentials.json
 * @returns {{userId:string, shortId:string, provider:string, label:string} | null}
 */
function extractFingerprint() {
  const profile = readCredentialProfile();

  // 1. Найти включённый provider с apiKey в config.json
  try {
    const rawCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const providers = rawCfg.provider || {};
    // Приоритет enabled=true; затем любой с apiKey
    const candidates = [];
    for (const [id, p] of Object.entries(providers)) {
      const apiKey = p && p.options && p.options.apiKey;
      if (!apiKey || typeof apiKey !== 'string') continue;
      if (apiKey.startsWith('enc:') || apiKey.length < 30) continue; // Зашифрованные или не похожие на JWT — пропускаем
      candidates.push({ id, provider: p, apiKey });
    }
    // enabled — приоритет
    candidates.sort((a, b) => (b.provider.enabled ? 1 : 0) - (a.provider.enabled ? 1 : 0));

    for (const c of candidates) {
      const payload = decodeJwt(c.apiKey);
      if (payload && (payload.user_id || payload.sub)) {
        const uid = payload.user_id || payload.sub;
        const shortId = String(uid).slice(0, 8);
        const email = profile && profile.email;
        // Ключ дедупликации по email: есть email — хэш email, нет — fallback shortId
        const emailShortId = email ? ('em-' + simpleHash(email.toLowerCase()).slice(0, 10)) : shortId;
        return {
          userId: uid,
          shortId,
          emailShortId,
          provider: c.id,
          label: (profile && (profile.email || profile.name)) || 'аккаунт-' + shortId,
          email: email,
          name: profile && profile.name,
          avatar: profile && profile.avatar,
          customerId: profile && profile.customerId,
          userKey: profile && profile.userKey,
          source: profile && profile.email ? 'config.jwt+credentials.user_info' : 'config.jwt',
        };
      }
    }
  } catch (_) {}

  // 2. Fallback: если из зашифрованных полей credentials.json ничего не получилось,
  //    генерируем слабый отпечаток (только для дедупликации)
  try {
    const rawCred = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const ap = rawCred['oauth:active_provider'] || '';
    const hash = simpleHash(ap);
    const shortId = hash.slice(0, 8);
    const email = profile && profile.email;
    const emailShortId = email ? ('em-' + simpleHash(email.toLowerCase()).slice(0, 10)) : shortId;
    return {
      userId: (profile && (profile.credentialUserId || profile.accessUserId)) || 'enc-' + hash,
      shortId,
      emailShortId,
      provider: (profile && profile.activeProvider) || '(encrypted)',
      label: (profile && (profile.email || profile.name)) || 'аккаунт-' + shortId,
      email: profile && profile.email,
      name: profile && profile.name,
      avatar: profile && profile.avatar,
      customerId: profile && profile.customerId,
      userKey: profile && profile.userKey,
      source: profile && profile.email ? 'credentials.user_info' : 'credentials.fallback',
    };
  } catch (_) {}

  return null;
}

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

module.exports = { decodeJwt, readCredentialProfile, extractFingerprint };
