import React from 'react';
import { RefreshCw } from 'lucide-react';

function formatNumber(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

/**
 * Сверху обзор состояния: текущий аккаунт + статус работы ZCode + общая квота
 */
export default function StatusBar({ status, loading, quota, quotaLoading, onRefreshQuota, currentQuota }) {
  const cur = status?.current;
  const running = status?.zcodeRunning;

  // Сводка по квоте текущего аккаунта: сумма остатков по всем моделям + общий % остатка
  const curQ = currentQuota?.ok && currentQuota?.data;
  const curItems = curQ?.items || [];
  const curSumRemaining = curItems.reduce((a, b) => a + (b.remaining || 0), 0);
  const curSumTotal = curItems.reduce((a, b) => a + (b.total || 0), 0);
  const curSumUsed = curItems.reduce((a, b) => a + (b.used || 0), 0);
  // Общий % остатка (полная квота → полная полоса)
  const curRemainingPct = curSumTotal > 0 ? Math.max(0, Math.min(100, (1 - curSumUsed / curSumTotal) * 100)) : null;

  return (
    <section className="overview-grid" aria-label="Обзор текущего состояния">
      <div className="overview-card identity-card">
        <div className="identity-head">
          <div className="identity-avatar">
            {cur?.avatar ? <img src={cur.avatar} alt="" /> : <span>{(cur?.email || cur?.label || '?').slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="identity-copy">
            <span className="eyebrow">Текущий аккаунт</span>
            {loading ? (
              <strong>Чтение…</strong>
            ) : cur ? (
              <strong>{cur.email || cur.label || cur.name}</strong>
            ) : (
              <strong className="warn-text">Не распознан (возможно, вход не выполнен)</strong>
            )}
          </div>
        </div>
        {cur && !loading && (
          currentQuota?.loading ? (
            <div className="quota-empty">Загрузка квоты…</div>
          ) : curItems.length > 0 ? (
            <div className="overview-quota-items">
              {curItems.map((item, idx) => {
                const remainingPct = item.percentUsed == null
                  ? 100
                  : Math.max(0, Math.min(100, 100 - item.percentUsed));
                return (
                  <div className="overview-quota-item" key={idx} title={`${item.name}: остаток ${formatNumber(item.remaining)} / всего ${formatNumber(item.total)}`}>
                    <div className="overview-quota-item-head">
                      <span className="overview-quota-item-name">{item.name}</span>
                      <span className="overview-quota-item-pct">{item.percentUsed == null ? '—' : 'остаток ' + remainingPct.toFixed(0) + '%'}</span>
                    </div>
                    <div
                      className="quota-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(remainingPct)}
                      aria-label={`${item.name}, остаток квоты ${remainingPct.toFixed(0)}%`}
                    >
                      <span style={{ width: `${remainingPct}%` }} />
                    </div>
                    <div className="overview-quota-item-stats">
                      <span>остаток {formatNumber(item.remaining)}</span>
                      <span>всего {formatNumber(item.total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : currentQuota?.error ? (
            <div className="quota-empty">Квота недоступна</div>
          ) : (
            <div className="quota-empty">Пока нет данных о квоте</div>
          )
        )}
      </div>

      <div className="overview-card quota-card">
        <div className="quota-head">
          <div>
            <span className="eyebrow">Обзор общей квоты</span>
            <strong>{quota?.isEmpty ? 'Нет данных о биллинге' : (quota?.display?.remaining || '—') + ' доступно'}</strong>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onRefreshQuota} disabled={quotaLoading} title="Обновить квоту" aria-label="Обновить квоту">
            <RefreshCw size={15} className={quotaLoading ? 'spin' : ''} />
          </button>
        </div>
        {quota?.isEmpty || !quota?.items?.length ? (
          <div className="quota-empty">Нет данных о биллинге</div>
        ) : (
          <div className="overview-quota-items">
            {quota.items.map((item, idx) => {
              // Семантика полосы: доля остатка квоты (полная → полоса полная, до 0 → пустая)
              // Если percentUsed равен null (нельзя вычислить), при наличии данных показываем полной
              const remainingPct = item.percentUsed == null
                ? 100
                : Math.max(0, Math.min(100, 100 - item.percentUsed));
              return (
                <div className="overview-quota-item" key={idx}>
                  <div className="overview-quota-item-head">
                    <span className="overview-quota-item-name">{item.name}</span>
                    <span className="overview-quota-item-pct">{item.percentUsed == null ? '—' : 'остаток ' + remainingPct.toFixed(0) + '%'}</span>
                  </div>
                  <div
                    className="quota-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(remainingPct)}
                    aria-label={`${item.name}, остаток квоты ${remainingPct.toFixed(0)}%`}
                  >
                    <span style={{ width: `${remainingPct}%` }} />
                  </div>
                  <div className="overview-quota-item-stats">
                    <span>остаток {formatNumber(item.remaining)}</span>
                    <span>всего {formatNumber(item.total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="overview-card runtime-card">
        <span className="eyebrow">Состояние работы</span>
        <strong>
          <span className={`status-dot ${running ? 'on' : 'off'}`} />
          ZCode {running ? 'работает' : 'не запущен'}
        </strong>
        <div className="runtime-foot">
          <div className="foot-row">
            <span className="foot-label">Резервная копия для отката</span>
            <span>{status?.hasLastBackup ? 'есть' : 'нет'}</span>
          </div>
          <div className="foot-row">
            <span className="foot-label">Текущий аккаунт</span>
            <span className="foot-email" title={status?.current?.email || status?.current?.label}>
              {status?.current ? (status.current.email || status.current.label || '-') : '-'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
