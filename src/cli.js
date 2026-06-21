#!/usr/bin/env node
'use strict';
/**
 * CLI для бесшовного переключения аккаунтов ZCode
 *
 * (Консоль Windows по умолчанию использует GBK, вывод UTF-8 из Node будет искажён.
 *  Здесь при запуске процесса stdout/stderr переключаются на UTF-8 для корректного отображения.) */
try {
  if (process.stdout.isTTY && typeof process.stdout.handle?.setEncoding === 'function') {
    process.stdout.handle.setEncoding('utf8');
  }
} catch (_) {}
// Принудительное декодирование/запись в UTF-8
try { process.stdout.setDefaultEncoding('utf8'); } catch (_) {}
try { process.stderr.setDefaultEncoding('utf8'); } catch (_) {}

/**
 * CLI для бесшовного переключения аккаунтов ZCode
 *
 * Использование:
 *   node src/cli.js status                          Просмотр текущего аккаунта + списка сохранённых
 *   node src/cli.js capture [--name название] [--note примечание]   Сохранить текущее состояние ZCode как снимок
 *   node src/cli.js list                            Список всех сохранённых аккаунтов
 *   node src/cli.js use <id|номер> [--no-restart] [--force]   Переключиться на аккаунт (по умолчанию автоперезапуск ZCode)
 *   node src/cli.js delete <id|номер>                Удалить снимок аккаунта
 *   node src/cli.js rename <id|номер> <новое_имя>    Переименовать аккаунт
 *   node src/cli.js rollback                        Откат к состоянию перед переключением
 *
 * Примечание: <id|номер> можно указать как короткий ID аккаунта (напр. a86931xx), либо номер из list (1,2,3...)
 */
const manager = require('./manager');
const switcher = require('./switcher');
const quota = require('./quota');
const { findZCodeExe, CREDENTIALS_FILE, CONFIG_FILE } = require('./paths');

function parseArgs(argv) {
  const out = { _: [], flags: {}, kv: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.kv[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Поддерживает как номер, так и id */
function resolveId(input) {
  if (!input) throw new Error('Укажите id или номер аккаунта');
  const list = manager.list();
  if (list.length === 0) throw new Error('Нет сохранённых аккаунтов');
  // Только цифры → номер
  if (/^\d+$/.test(input)) {
    const idx = parseInt(input, 10);
    if (idx < 1 || idx > list.length) throw new Error(`Номер вне диапазона (1~${list.length})`);
    return list[idx - 1].id;
  }
  // Иначе как id (поддержка совпадения по префиксу)
  const exact = list.find((x) => x.id === input);
  if (exact) return exact.id;
  const pref = list.filter((x) => x.id.startsWith(input));
  if (pref.length === 1) return pref[0].id;
  if (pref.length > 1) throw new Error('Префикс id совпадает с несколькими аккаунтами, введите более полный id');
  throw new Error('Аккаунт не найден: ' + input);
}

function printTable(list) {
  if (list.length === 0) {
    console.log('  (Нет сохранённых аккаунтов, используйте `capture` для добавления)');
    return;
  }
  console.log('');
  console.log('  №    id          Название             Provider                 Время снимка       Размер');
  console.log('  ----  ----------  -------------------  -----------------------  ------------------  ----');
  list.forEach((a, i) => {
    const no = String(i + 1).padStart(4);
    const id = (a.id || '').padEnd(10).slice(0, 10);
    const label = (a.label || '').padEnd(19).slice(0, 19);
    const prov = (a.provider || '').padEnd(23).slice(0, 23);
    const dt = fmtDate(a.capturedAt).padEnd(18);
    const sz = (a.sizeKb || 0) + 'KB';
    console.log(`  ${no}  ${id}  ${label}  ${prov}  ${dt}  ${sz}`);
  });
  console.log('');
}

function fmtQuota(value) {
  if (value == null) return 'неизвестно';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function printQuota(q) {
  console.log('=== Квота ZCode ===');
  console.log('Всего:   ' + fmtQuota(q.total));
  console.log('Исп.:    ' + fmtQuota(q.used));
  console.log('Остаток: ' + fmtQuota(q.remaining));
  console.log('Прогрес: ' + (q.percentUsed == null ? 'неизвестно' : q.percentUsed.toFixed(1) + '%'));
  if (q.refreshedAt) console.log('Обновлено: ' + fmtDate(q.refreshedAt));
  if (q.items && q.items.length) {
    console.log('');
    console.log('▶ По тарифам:');
    q.items.forEach((item) => {
      console.log(`  - ${item.name}: остаток ${fmtQuota(item.remaining)} / всего ${fmtQuota(item.total)} (${item.unit || 'quota'})`);
    });
  }
}

const cmd = (process.argv[2] || 'status').toLowerCase();
const args = parseArgs(process.argv.slice(3));

async function main() {
  switch (cmd) {
    case 'status': {
      const cur = manager.current();
      console.log('=== Переключатель аккаунтов ZCode ===');
      console.log('Клиент ZCode: ' + (findZCodeExe() || 'не найден'));
      console.log('Статус:       ' + (switcher.isZCodeRunning() ? '✅ Запущен' : '⛔ Не запущен'));
      console.log('Каталог логина: ' + require('path').dirname(CREDENTIALS_FILE));
      if (cur) {
        console.log('');
        console.log('▶ Текущий аккаунт:');
        console.log('  ID отпечатка:  ' + cur.shortId + (cur.userId ? '  (user_id=' + cur.userId + ')' : ''));
        console.log('  Источник:     ' + cur.source);
        console.log('  Provider:     ' + cur.provider);
      } else {
        console.log('\n⚠ Не удалось определить текущий аккаунт (возможно, не выполнен вход или логин зашифрован)');
      }
      console.log('');
      console.log('▶ Сохранённые снимки:');
      printTable(manager.list());
      return;
    }

    case 'list': {
      printTable(manager.list());
      return;
    }

    case 'quota': {
      const q = await quota.getQuotaOverview();
      printQuota(q);
      return;
    }

    case 'capture': {
      const r = manager.capture({
        label: args.kv.name,
        note: args.kv.note || '',
        overwrite: !!args.flags.overwrite,
      });
      if (r.created) {
        console.log('✅ Аккаунт захвачен: ' + r.meta.label + '  (id=' + r.meta.id + ')');
      } else if (r.skipped) {
        console.log('ℹ ' + r.message + '. Для перезаписи добавьте --overwrite.');
      }
      return;
    }

    case 'use': {
      const id = resolveId(args._[0]);
      const meta = JSON.parse(require('fs').readFileSync(manager.metaPath(id), 'utf8'));
      console.log('🔄 Переключение на: ' + meta.label + '  (id=' + id + ')');
      const opts = {
        restart: !args.flags['no-restart'],
        force: args.flags.force !== false, // по умолчанию force
      };
      const r = await manager.use(id, opts);
      console.log('✅ Состояние логина переключено.');
      if (r.restarted) console.log('🚀 ZCode перезапущен, логин уже активен.');
      else console.log('ℹ ZCode не перезапущен (--no-restart или ошибка запуска). Запустите вручную.');
      return;
    }

    case 'delete':
    case 'remove': {
      const id = resolveId(args._[0]);
      const ok = manager.remove(id);
      console.log(ok ? '🗑 Аккаунт удалён: ' + id : '⚠ Аккаунт не найден: ' + id);
      return;
    }

    case 'rename': {
      const id = resolveId(args._[0]);
      const newName = args._[1];
      if (!newName) throw new Error('Укажите новое имя');
      const m = manager.rename(id, newName);
      console.log('✏ Переименовано: ' + m.label);
      return;
    }

    case 'rollback': {
      const r = await switcher.rollback({
        restart: !args.flags['no-restart'],
        force: args.flags.force !== false,
      });
      console.log('↩ Откат к состоянию перед переключением выполнен.');
      if (r.restarted) console.log('🚀 ZCode перезапущен.');
      return;
    }

    case 'kill': {
      const running = switcher.isZCodeRunning();
      if (!running) { console.log('ZCode не запущен.'); return; }
      console.log('Закрытие ZCode...');
      const ok = await switcher.killZCode();
      console.log(ok ? '✅ Закрыт.' : '⚠ Таймаут закрытия.');
      return;
    }

    case 'launch': {
      try { switcher.launchZCode(); console.log('🚀 ZCode запущен.'); }
      catch (e) { console.error('❌ ' + e.message); process.exit(1); }
      return;
    }

    default:
      console.log('Утилита переключения аккаунтов ZCode\n');
      console.log('Использование:');
      console.log('  status                          Просмотр текущего аккаунта + список');
      console.log('  capture [--name название]        Сохранить текущее состояние как снимок');
      console.log('  list                            Список всех аккаунтов');
      console.log('  quota                           Проверка квоты текущего аккаунта');
      console.log('  use <id|номер> [--no-restart]    Переключить аккаунт (автоперезапуск ZCode)');
      console.log('  delete <id|номер>                Удалить аккаунт');
      console.log('  rename <id|номер> <новое_имя>     Переименовать');
      console.log('  rollback                        Откат к состоянию перед переключением');
      console.log('  kill / launch                   Закрыть / запустить ZCode вручную');
  }
}

main().catch((e) => {
  console.error('❌ ' + e.message);
  process.exit(1);
});
