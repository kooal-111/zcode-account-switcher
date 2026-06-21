'use strict';
/**
 * Ядро переключения: обнаружение процессов / резервное копирование / замена логина / откат
 *
 * Стратегия безопасности:
 *   1. Перед переключением ZCode должен быть закрыт (изменение credentials.json/config.json
 *      во время работы ненадёжно, клиент перезапишет файлы)
 *   2. Перед заменой текущие файлы бэкапятся в .last (для отката одной кнопкой)
 *   3. Атомная запись: сначала .tmp затем rename, избегая частично записанного состояния
 */
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const { CREDENTIALS_FILE, CONFIG_FILE, findZCodeExe } = require('./paths');

const BACKUP_DIR = path.join(__dirname, '..', '.last'); // Логин-состояние перед переключением (для отката)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Проверить, запущен ли ZCode
 */
function isZCodeRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq ZCode.exe" /NH /FO CSV', {
      encoding: 'utf8',
      windowsHide: true,
    });
    return /"ZCode\.exe"/i.test(out);
  } catch (_) {
    return false;
  }
}

/**
 * Закрыть ZCode (все процессы). Ждать не более waitMs.
 */
async function killZCode({ waitMs = 8000 } = {}) {
  if (!isZCodeRunning()) return true;
  try {
    execSync('taskkill /F /IM ZCode.exe', { encoding: 'utf8', windowsHide: true, stdio: 'ignore' });
  } catch (_) {
    // Продолжаем ждать даже если taskkill не удался
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isZCodeRunning()) return true;
    await sleep(400);
  }
  return !isZCodeRunning();
}

/**
 * Запустить ZCode
 */
function launchZCode() {
  const exe = findZCodeExe();
  if (!exe) throw new Error('ZCode.exe не найден, проверьте путь установки (ZCODE_INSTALL_DIR в paths.js)');
  // detached + отдельный stdio, чтобы не блокировать выход инструмента
  try {
    exec(`"${exe}"`, { windowsHide: false, detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch (e) {
    throw new Error('Не удалось запустить ZCode: ' + e.message);
  }
}

/** Прочитать логин-состояние (содержимое двух файлов) */
function readSnapshot() {
  return {
    credentials: fs.readFileSync(CREDENTIALS_FILE, 'utf8'),
    config: fs.readFileSync(CONFIG_FILE, 'utf8'),
  };
}

/** Атомная запись логин-состояния: сначала .tmp затем rename */
function writeSnapshot(snap) {
  atomicWrite(CREDENTIALS_FILE, snap.credentials);
  atomicWrite(CONFIG_FILE, snap.config);
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.zcas.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  // rename атомарный (на том же диске)
  fs.renameSync(tmp, filePath);
}

/**
 * Переключиться на указанный снимок аккаунта
 * @param {{credentials:string, config:string}} target
 * @param {{restart?:boolean, force?:boolean}} opts
 *   - restart: автоматически перезапустить ZCode после переключения (по умолчанию true)
 *   - force: принудительно завершить ZCode, даже если он запущен (по умолчанию true)
 */
async function switchTo(target, opts = {}) {
  const { restart = true, force = true } = opts;

  if (!target || !target.credentials || !target.config) {
    throw new Error('Снимок целевого аккаунта неполный');
  }

  const running = isZCodeRunning();
  if (running && !force) {
    throw new Error('ZCode запущен, сначала закройте его или используйте --force');
  }

  // 1. Закрыть ZCode
  if (running) {
    const ok = await killZCode();
    if (!ok) throw new Error('Таймаут закрытия ZCode, переключение отменено (во избежание повреждения)');
  }

  // 2. Резервное копирование текущего состояния в .last (для отката)
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUP_DIR, 'credentials.json'), fs.readFileSync(CREDENTIALS_FILE, 'utf8'), 'utf8');
    fs.writeFileSync(path.join(BACKUP_DIR, 'config.json'), fs.readFileSync(CONFIG_FILE, 'utf8'), 'utf8');
  } catch (e) {
    throw new Error('Ошибка бэкапа текущего состояния: ' + e.message);
  }

  // 3. Атомная замена
  try {
    writeSnapshot(target);
  } catch (e) {
    // Замена не удалась: попытка восстановления из .last
    try { restoreLast(); } catch (_) {}
    throw new Error('Ошибка записи состояния, выполнен автоматический откат: ' + e.message);
  }

  // 4. Перезапуск
  let launched = false;
  if (restart) {
    try { launchZCode(); launched = true; } catch (e) {
      console.warn('⚠ Не удалось запустить ZCode (состояние уже переключено): ' + e.message);
    }
  }

  return { restarted: launched, wasRunning: running };
}

/** Откат к .last (состояние перед переключением) */
async function rollback(opts = {}) {
  const { restart = true, force = true } = opts;
  if (!fs.existsSync(path.join(BACKUP_DIR, 'credentials.json'))) {
    throw new Error('Нет резервной копии для отката (.last не найден)');
  }
  if (isZCodeRunning() && !force) {
    throw new Error('ZCode запущен, сначала закройте его или используйте --force');
  }
  if (isZCodeRunning()) {
    const ok = await killZCode();
    if (!ok) throw new Error('Таймаут закрытия ZCode');
  }
  restoreLast();
  let launched = false;
  if (restart) { try { launchZCode(); launched = true; } catch (_) {} }
  return { restarted: launched };
}

function restoreLast() {
  const c = fs.readFileSync(path.join(BACKUP_DIR, 'credentials.json'), 'utf8');
  const g = fs.readFileSync(path.join(BACKUP_DIR, 'config.json'), 'utf8');
  atomicWrite(CREDENTIALS_FILE, c);
  atomicWrite(CONFIG_FILE, g);
}

/** Существует ли резервная копия .last для отката */
function hasLastBackup() {
  return fs.existsSync(path.join(BACKUP_DIR, 'credentials.json')) &&
         fs.existsSync(path.join(BACKUP_DIR, 'config.json'));
}

module.exports = {
  isZCodeRunning,
  killZCode,
  launchZCode,
  readSnapshot,
  writeSnapshot,
  switchTo,
  rollback,
  hasLastBackup,
  BACKUP_DIR,
};
