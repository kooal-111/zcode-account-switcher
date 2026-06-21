'use strict';
/**
 * Основной процесс Electron
 *
 * Обязанности:
 *   1. Создание окна приложения
 *   2. IPC-мост между процессом рендеринга ↔ проверенными серверными модулями (manager / switcher)
 *
 * Безопасность: contextIsolation=true + preload с ограниченным API, процесс рендеринга не имеет прямого доступа к Node.
 *
 * Примечание: если окно не появляется, проверьте, не установлен ли ELECTRON_RUN_AS_NODE=1
 *      (это превратит electron в чистый node). Стартовый скрипт автоматически очищает эту переменную.
 */
const fs = require('fs');
const path = require('path');

// ===== Глобальный перехват ошибок → запись в лог (для диагностики сбоев при запуске) =====
const LOG_FILE = path.join(__dirname, 'main.log');
function logErr(stage, e) {
  const line = `[${new Date().toISOString()}] ${stage}: ${e && e.stack ? e.stack : e}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (_) {}
}
process.on('uncaughtException', (e) => logErr('uncaughtException', e));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', e));

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');

// Переиспользование серверной логики из src/
const manager = require('../src/manager');
const switcher = require('../src/switcher');
const oauth = require('../src/oauth');
const quota = require('../src/quota');
const { ZaiAuthFlow } = require('../src/oauthCli');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL; // В режиме разработки сервер от vite
let mainWindow = null;

// Общий лог (информационный уровень, запись в main.log)
function logInfo(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch (_) {}
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || `zcode-accounts-${timestampName()}`;
}

function exportDefaultName(accounts) {
  const first = accounts && accounts[0] && accounts[0].meta ? accounts[0].meta : null;
  const base = safeFileName(first?.email || first?.label || first?.id);
  const suffix = accounts.length > 1 ? `-${accounts.length} аккаунтов` : '';
  return `${base}${suffix}.zcas.json`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 680,
    title: 'Переключатель аккаунтов ZCode',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload требует возможности require для работы с путями
    },
  });

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'));
  }

  // Перехват console и ошибок процесса рендеринга (для диагностики белого экрана / JS-ошибок)
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    const tag = ['LOG', 'WARN', 'ERROR'][level] || 'LOG';
    logInfo(`[renderer:${tag}] ${message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logErr('render-process-gone', new Error(JSON.stringify(details)));
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    logInfo(`[did-fail-load] ${code} ${desc}`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    logInfo('[did-finish-load] renderer loaded');
  });

  // Внешние ссылки открывать в системном браузере
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ===== IPC-обработчики (все в try/catch, возврат {ok, data?, error?}) =====

const wrap = async (fn, channel) => {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    logInfo(`[ipc:${channel || 'call'}] error: ${e && e.message ? e.message : e}`);
    return { ok: false, error: e.message || String(e) };
  }
};

// Отправка событий прогресса OAuth в процесс рендеринга (для AddAccountModal)
function sendFlowEvent(event) {
  logInfo('[oauth-flow] ' + event.type + (event.message ? ': ' + event.message : ''));
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth:flow-event', event);
    }
  } catch (_) {}
}

ipcMain.handle('account:status', async () =>
  wrap(() => {
    const cur = manager.current();
    const running = switcher.isZCodeRunning();
    const hasLast = switcher.hasLastBackup();
    return { current: cur, zcodeRunning: running, hasLastBackup: hasLast };
  }, 'status')
);

ipcMain.handle('account:list', async () => wrap(() => manager.list(), 'list'));

ipcMain.handle('account:capture', async (_evt, opts) =>
  wrap(() => manager.capture(opts || {}), 'capture')
);

ipcMain.handle('account:use', async (_evt, id) =>
  wrap(() => manager.use(id, { restart: true, force: true }), 'use')
);

ipcMain.handle('account:delete', async (_evt, id) =>
  wrap(() => ({ removed: manager.remove(id) }), 'delete')
);

ipcMain.handle('account:rename', async (_evt, id, label) =>
  wrap(() => manager.rename(id, label), 'rename')
);

ipcMain.handle('account:export', async (_evt, ids) =>
  wrap(async () => {
    const payload = manager.exportAccounts(ids);
    if (!payload.accounts.length) throw new Error('Нет аккаунтов для экспорта');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт снимков аккаунтов',
      defaultPath: exportDefaultName(payload.accounts),
      filters: [
        { name: 'JSON файлы', extensions: ['json'] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { canceled: false, path: result.filePath, count: payload.accounts.length };
  }, 'export')
);

ipcMain.handle('account:import', async () =>
  wrap(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Импорт снимков аккаунтов',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'JSON файлы', extensions: ['json'] },
      ],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) return { canceled: true };

    const imported = [];
    const skipped = [];
    const files = [];
    for (const filePath of result.filePaths) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const payload = JSON.parse(raw);
        const r = manager.importAccounts(payload, { overwrite: false });
        imported.push(...(r.imported || []));
        skipped.push(...(r.skipped || []));
        files.push({ path: filePath, imported: r.imported?.length || 0, skipped: r.skipped?.length || 0 });
      } catch (e) {
        const reason = e && e.message ? e.message : String(e);
        skipped.push({ file: filePath, reason });
        files.push({ path: filePath, error: reason });
      }
    }
    return {
      canceled: false,
      path: result.filePaths[0],
      paths: result.filePaths,
      fileCount: result.filePaths.length,
      files,
      imported,
      skipped,
      count: imported.length,
    };
  }, 'import')
);

// ===== OAuth добавление аккаунта (CLI OAuth + системный браузер) =====
// Процесс: init получить ссылку авторизации → openExternal открыть системный браузер → фоновый poll
//   → при ready → finishLogin запись на диск + снимок.
// Фронтенд вызывает oauth-start один раз, прогресс отображается через oauth:flow-event.

// Текущий процесс входа + таймер опроса (модульного уровня, сохраняются между запросами)
let _loginFlow = null;   // { flow: ZaiAuthFlow, flowId: string }
let _pollTimer = null;   // setInterval handle

function stopOauthPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

ipcMain.handle('account:oauth-start', async (_evt, opts) => {
  const { label, note } = opts || {};
  try {
    // 1. Инициализация OAuth, получение ссылки авторизации
    const flow = new ZaiAuthFlow();
    const { flowId, authorizeUrl } = await flow.init();
    _loginFlow = { flow, flowId };

    // 2. Открытие системного браузера (пользователь входит в своём браузере — лучше для anti-fraud)
    sendFlowEvent({ type: 'browser-open', message: 'Открываю системный браузер, выполните вход в аккаунт Z.ai' });
    await shell.openExternal(authorizeUrl);
    sendFlowEvent({ type: 'waiting-login', message: 'Ожидание входа в браузере (поддерживается email/пароль и телефон)' });

    // 3. Фоновый опрос завершения входа (каждые 2с, согласно эталонному проекту)
    stopOauthPolling();
    _pollTimer = setInterval(async () => {
      const current = _loginFlow;
      if (!current) return;
      try {
        const data = await current.flow.poll(current.flowId);

        if (data.status === 'failed') {
          stopOauthPolling();
          _loginFlow = null;
          sendFlowEvent({ type: 'error', message: 'Вход не выполнен или отменён' });
          return;
        }

        if (data.status === 'ready') {
          stopOauthPolling();
          _loginFlow = null;

          // Формирование tokenSet для oauth.finishLogin():
          //   { token, zaiAccessToken, refreshToken, user }
          // Результат poll CLI OAuth полностью совпадает, логика записи переиспользуется.
          const tokenSet = {
            token: data.token,
            zaiAccessToken: (data.zai && data.zai.access_token) || undefined,
            refreshToken: (data.zai && data.zai.refresh_token) || undefined,
            user: data.user || {},
          };

          try {
            sendFlowEvent({ type: 'exchanging', message: 'Вход выполнен, сохранение аккаунта…' });
            const result = oauth.finishLogin({ tokenSet, label, note: note || '', overwrite: true });
            sendFlowEvent({
              type: 'saved',
              account: result.account,
              email: (result.userInfo && result.userInfo.email) || '',
              skipped: result.skipped,
            });
          } catch (e) {
            sendFlowEvent({ type: 'error', message: 'Ошибка сохранения аккаунта: ' + (e.message || e) });
          }
        }
        // Остальные состояния (pending) — продолжаем опрос
      } catch (e) {
        // Сетевой сбой при единичном запросе не прерывает процесс, повтор на следующей итерации
        logInfo('[oauth-start] poll error: ' + (e && e.message));
      }
    }, 2000);

    return { ok: true, authorizeUrl };
  } catch (e) {
    logInfo('[oauth-start] error: ' + (e && e.message));
    sendFlowEvent({ type: 'error', message: 'Ошибка запуска входа: ' + (e.message || e) });
    return { ok: false, error: e.message || String(e) };
  }
});

// Отмена процесса входа (остановка опроса; браузер закрывается пользователем)
ipcMain.handle('account:oauth-cancel', async () =>
  wrap(() => {
    stopOauthPolling();
    _loginFlow = null;
    return { stopped: true };
  }, 'oauth-cancel')
);

ipcMain.handle('shell:open-external', async (_evt, url) =>
  wrap(() => shell.openExternal(url), 'open-external')
);

ipcMain.handle('account:quota', async () =>
  wrap(() => quota.getQuotaOverview(), 'quota')
);

ipcMain.handle('account:quota-one', async (_evt, id) =>
  wrap(() => quota.getAccountQuota(id), 'quota-one')
);

ipcMain.handle('account:quota-many', async (_evt, ids) =>
  wrap(async () => {
    const list = Array.isArray(ids) ? ids : [];
    const out = {};
    for (const id of list) {
      try {
        out[id] = { ok: true, data: await quota.getAccountQuota(id) };
      } catch (e) {
        out[id] = { ok: false, error: e.message || String(e) };
      }
    }
    return out;
  }, 'quota-many')
);

ipcMain.handle('account:rollback', async () =>
  wrap(() => switcher.rollback({ restart: true, force: true }), 'rollback')
);

// ===== Жизненный цикл =====
app.whenReady().then(() => {
  logInfo(`main start (electron ${process.versions.electron}, chrome ${process.versions.chrome})`);
  logInfo('backend modules loaded: manager, switcher');
  createWindow();
});

app.on('window-all-closed', () => {
  // Перед выходом остановить опрос OAuth (браузер закрывается пользователем)
  stopOauthPolling();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopOauthPolling();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
