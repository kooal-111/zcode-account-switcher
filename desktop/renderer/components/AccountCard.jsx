import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Trash2, Pencil, Check } from 'lucide-react';

function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function healthText(health) {
  if (!health) return 'Не проверено';
  if (health.status === 'healthy') return 'OK';
  if (health.status === 'warning') return 'Внимание';
  return 'Ошибка';
}

/**
 * Технические warning/error-сообщения из бэкенда (accountHealth.js)
 * преобразуются в понятные для пользователя подсказки
 * (логика бэкенда не меняется — только отображение на фронтенде).
 *
 * ВНИМАНИЕ: ключи match оставлены на китайском, так как именно их
 * отдаёт бэкенд. После перевода src/accountHealth.js на русский
 * ключи здесь нужно будет обновить синхронно.
 */
function humanizeSummary(summary) {
  if (!summary) return '';
  const s = String(summary);
  if (s.includes('не удалось дешифровать в текущей среде')) {
    return 'Аккаунт сохранён на другой машине — на этой не читаются его данные, но переключение работает';
  }
  if (s.includes('после дешифрования не валидный JSON')) {
    return 'Данные профиля повреждены, но переключение работает';
  }
  if (s.includes('user_info не найден')) {
    return 'Данные профиля неполные, но переключение работает';
  }
  if (s.includes('Неполная структура credentials')) {
    return 'Структура файлов входа нарушена — рекомендуем сохранить этот аккаунт заново';
  }
  return s;
}

/**
 * Разбирает provider (например builtin:zai-coding-plan) в {label, tier} —
 * информацию для цветного бейджа.
 * Реальные платные уровни всего четыре: Start Plan / Lite / Pro / Max.
 * Поле provider кодирует тип тарифа (например бесплатный тариф zai-coding-plan,
 * либо zai-start-plan), но не сам платный уровень напрямую.
 * Если определить конкретный уровень нельзя — возвращаем null
 * (бейдж не показываем, чтобы не ошибиться).
 */
function planBadge(provider) {
  const raw = String(provider || '').toLowerCase().replace(/^builtin:/, '');
  // Сопоставление по ключевым словам, Max важнее Pro (чтобы pro не «съел» max)
  if (raw.includes('max')) return { label: 'Max', tier: 'max' };
  if (raw.includes('pro')) return { label: 'Pro', tier: 'pro' };
  if (raw.includes('lite')) return { label: 'Lite', tier: 'lite' };
  if (raw.includes('start-plan') || raw.includes('start')) return { label: 'Start Plan', tier: 'start' };
  // Конкретный платный уровень неизвестен (например бесплатный тариф zai-coding-plan) → бейджа нет
  return null;
}

/**
 * Карточка одного аккаунта
 */
export default function AccountCard({
  account,
  quota,
  isCurrent,
  busy,
  renaming,
  selected,
  onSelectedChange,
  onUse,
  onDelete,
  onRenameStart,
  onRenameCommit,
  onRefreshQuota,
}) {
  const [editName, setEditName] = useState(account.label);
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming) {
      setEditName(account.label);
      // Фокус и выделение текста
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [renaming, account.label]);

  const handleKey = (e) => {
    if (e.key === 'Enter') onRenameCommit(editName.trim());
    if (e.key === 'Escape') onRenameCommit(account.label); // отмена
  };

  return (
    <div className={`account-card ${isCurrent ? 'current' : ''} ${selected ? 'export-selected' : ''}`}>
      <label className="account-export-check" title="Отметить для экспорта этого аккаунта">
        <input
          type="checkbox"
          checked={!!selected}
          onChange={(e) => onSelectedChange?.(e.target.checked)}
          disabled={busy}
          aria-label={'Выбрать для экспорта ' + account.label}
        />
        <span />
      </label>
      <div className="account-avatar">
        {account.avatar ? <img src={account.avatar} alt="" /> : <span>{(account.email || account.label || '?').slice(0, 1).toUpperCase()}</span>}
      </div>
      <div className="account-info">
        <div className="account-name-row">
          {renaming ? (
            <input
              ref={inputRef}
              className="modal-input"
              style={{ height: 32, marginBottom: 0, width: 220, fontSize: 14 }}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKey}
              onBlur={() => onRenameCommit(editName.trim())}
            />
          ) : (
            <span className="account-name">{account.label}</span>
          )}
          {isCurrent && (
            <span className="account-badge">
              <Check size={11} />
              Текущий
            </span>
          )}
          <span className={`health-badge ${account.health?.status || 'unknown'}`} title={account.health?.summary || 'Ещё не проверено'}>
            {healthText(account.health)}
          </span>
          {(() => {
            // Приоритет у planTier из billing/current в реальном времени (точный, как в клиенте ZCode),
            // откат к статической оценке по provider (срабатывает только для start-plan)
            const badge = quota?.ok && quota.data ? quota.data.planTier : null;
            const fallback = badge ? null : planBadge(account.provider);
            const final = badge || fallback;
            if (!final) return null;
            return (
              <span className={`plan-badge plan-${final.tier}`} title={account.provider}>{final.label}</span>
            );
          })()}
        </div>
        <div className="account-meta">
          <span>Сохранён {fmtDate(account.capturedAt)}</span>
          {account.sizeKb ? <span>{account.sizeKb} КБ</span> : null}
        </div>
        {account.health?.status && account.health.status !== 'healthy' && (
          <div className="account-summary">{humanizeSummary(account.health.summary)}</div>
        )}
      </div>

      {/* Блок квоты: всё в одну строку — заголовок | обновить | [модель черта число]×N
          (время обновления убрано в hover-подсказку, чтобы не накладывалось на числа) */}
      <div className="account-quota-block" title={quota?.ok && quota.data && !quota.data.isEmpty ? `Квота обновлена ${fmtDate(quota.data.refreshedAt)}` : 'Квота'}>
        <span className="account-quota-title">Квота</span>
        {onRefreshQuota && (
          <button
            className="btn btn-ghost btn-icon account-quota-refresh"
            title="Обновить квоту этого аккаунта"
            aria-label={'Обновить квоту ' + account.label}
            onClick={() => onRefreshQuota(account.id)}
            disabled={busy || quota?.loading}
          >
            <RefreshCw size={13} className={quota?.loading ? 'spin' : ''} />
          </button>
        )}
        {quota?.loading ? (
          <span className="account-quota-state">Обновление…</span>
        ) : quota?.ok && quota.data ? (
          quota.data.isEmpty || !quota.data.items || quota.data.items.length === 0 ? (
            <span className="account-quota-state hint">Нет данных о квоте</span>
          ) : (
            <div className="quota-items">
              {quota.data.items.map((item, idx) => {
                const remainingPct = item.percentUsed == null ? null : Math.max(0, Math.min(100, 100 - item.percentUsed));
                const tense = remainingPct != null && remainingPct < 20 ? 'tense' : '';
                return (
                  <div className={`quota-item ${tense}`} key={idx} title={`${item.name}: осталось ${fmtNumber(item.remaining)} / всего ${fmtNumber(item.total)}`}>
                    <span className="quota-item-name" title={item.name}>{item.name}</span>
                    <div
                      className="account-quota-bar remaining"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPct == null ? undefined : Math.round(remainingPct)}
                      aria-label={`${item.name}, остаток квоты ${remainingPct == null ? 'неизвестно' : remainingPct.toFixed(0) + '%'}`}
                    >
                      <span style={{ width: `${remainingPct == null ? 0 : remainingPct}%` }} />
                    </div>
                    <span className="quota-item-stats-inline" title={`Осталось ${fmtNumber(item.remaining)} / всего ${fmtNumber(item.total)}`}>
                      <span className="qi-remain">{fmtNumber(item.remaining)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )
        ) : quota && quota.ok === false ? (
          <span className="account-quota-state hint" title={quota.error || 'Не удалось получить квоту'}>{quota.error || 'Не удалось получить квоту'}</span>
        ) : (
          <span className="account-quota-state hint">Нажмите «обновить» для квоты</span>
        )}
      </div>

      <div className="account-actions">
        <button
          className="btn btn-ghost btn-icon"
          title="Переименовать"
          aria-label={'Переименовать ' + account.label}
          onClick={onRenameStart}
          disabled={busy || renaming}
        >
          <Pencil size={15} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          title="Удалить"
          aria-label={'Удалить ' + account.label}
          onClick={onDelete}
          disabled={busy}
          style={{ color: '#ef4444' }}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={onUse}
          disabled={busy || isCurrent}
          title={isCurrent ? 'Уже является текущим аккаунтом' : 'Переключиться на этот аккаунт'}
        >
          {busy ? (
            <RefreshCw size={14} className="spin" />
          ) : isCurrent ? (
            <Check size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          {isCurrent ? 'Текущий' : busy ? 'Переключение…' : 'Переключить'}
        </button>
      </div>
    </div>
  );
}
