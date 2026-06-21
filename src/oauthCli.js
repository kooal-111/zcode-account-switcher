'use strict';
/**
 * ZCode CLI OAuth процесс входа (портирован из ZaiAuthFlow проекта zcode2api).
 *
 * Отличается от Web OAuth (chat.z.ai/api/oauth/authorize): CLI OAuth использует
 * специальный интерфейс zcode.z.ai для сторонних CLI-инструментов, возвращаемый JWT
 * имеет встроенные права запроса billing без необходимости «активации» в клиенте ZCode.
 *
 * Процесс:
 *   1. init()  → POST /oauth/cli/init  → получить { flow_id, authorize_url }
 *   2. Пользователь открывает authorize_url в [системном браузере]
 *   3. poll(flow_id) → опрос до status=ready, получить { token, zai.access_token, zai.refresh_token, user }
 *
 * Структура data, возвращаемая poll, полностью совпадает с oauthBrowser.exchangeToken(),
 * поэтому логика записи oauth.finishLogin() используется без изменений.
 *
 * poll_token: init и poll запросы включают Authorization: Bearer <poll_token>,
 * для идентификации одного сеанса входа (согласно эталонному проекту).
 */
const crypto = require('crypto');

const API_BASE = 'https://zcode.z.ai/api/v1';

class ZaiAuthFlow {
  constructor(apiBase) {
    this.apiBase = apiBase || API_BASE;
    // poll_token: идентификатор сеанса входа, используется в init и poll
    this.pollToken = crypto.randomBytes(32).toString('hex');
  }

  /**
   * Инициализация OAuth процесса.
   * @returns {Promise<{flowId:string, authorizeUrl:string}>}
   */
  async init() {
    const res = await fetch(this.apiBase + '/oauth/cli/init', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.pollToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'zai' }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('OAuth init HTTP ' + res.status + ': ' + (t || '').slice(0, 200));
    }
    const json = await res.json();
    const data = (json && json.data) || {};
    const flowId = data.flow_id;
    const authorizeUrl = data.authorize_url;
    if (!flowId || !authorizeUrl) {
      throw new Error('Неполные данные OAuth процесса');
    }
    return { flowId: flowId, authorizeUrl: authorizeUrl };
  }

  /**
   * Опрос состояния входа.
   * @param {string} flowId
   * @returns {Promise<{status:string, token?:string, zai?:object, user?:object}>}
   *   status: 'pending' | 'ready' | 'failed'
   *   При ready возвращаются token / zai.access_token / zai.refresh_token / user
   */
  async poll(flowId) {
    const res = await fetch(this.apiBase + '/oauth/cli/poll/' + flowId, {
      headers: { Authorization: 'Bearer ' + this.pollToken },
    });
    if (!res.ok) {
      throw new Error('OAuth poll HTTP ' + res.status);
    }
    const json = await res.json();
    return (json && json.data) || {};
  }
}

module.exports = { ZaiAuthFlow, API_BASE };
