import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  RefreshCw,
  Undo2,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  SearchX,
  Upload,
  Download,
} from 'lucide-react';
import AccountCard from './components/AccountCard.jsx';
import StatusBar from './components/StatusBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import CaptureModal from './components/CaptureModal.jsx';
import AddAccountModal from './components/AddAccountModal.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';

export default function App() {
  const [status, setStatus] = useState(null); // {current, zcodeRunning, hasLastBackup}
  const [accounts, setAccounts] = useState([]);
  const accountsRef = useRef(accounts); // чтобы refreshQuota и др. читали свежий список аккаунтов без пересоздания
  accountsRef.current = accounts;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // глобальная занятость (идёт переключение/откат, все кнопки заблокированы)
  const [quota, setQuota] = useState(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [accountQuotas, setAccountQuotas] = useState({});
  const accountQuotasRef = useRef(accountQuotas);
  accountQuotasRef.current = accountQuotas;
  const [toast, setToast] = useState(null); // {type, msg}
  const [captureOpen, setCaptureOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // {title, desc, onOk}
  const [renamingId, setRenamingId] = useState(null); // id аккаунта в режиме переименования
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ health: 'all', quota: 'all' });
  const [selectedAccountIds, setSelectedAccountIds] = useState({});

  const showToast = useCallback((type, msg) => setToast({ type, msg }), []);

  // Обновить все данные
  const refreshAccountQuotas = useCallback(async (list) => {
    const ids = (Array.isArray(list) ? list : []).map((x) => x.id).filter(Boolean);
    if (ids.length === 0) {
      setAccountQuotas({});
      return;
    }

    setAccountQuotas((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = { ...(prev[id] || {}), loading: true, ok: false, error: null };
      });
      return next;
    });

    const r = await window.api.accountQuotas(ids);
    if (!r.ok) {
      setAccountQuotas((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = { loading: false, ok: false, error: r.error || 'Не удалось запросить квоты' };
        });
        return next;
      });
      return;
    }

    setAccountQuotas((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const item = r.data[id];
        next[id] = item && item.ok
          ? { loading: false, ok: true, data: item.data, error: null }
          : { loading: false, ok: false, error: (item && item.error) || 'Квота недоступна' };
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const s = await window.api.status();
    const l = await window.api.list();
    if (s.ok) setStatus(s.data);
    if (l.ok) {
      setAccounts(l.data);
      await refreshAccountQuotas(l.data);
    }
  }, [refreshAccountQuotas]);

  // Лёгкое обновление: только status + список аккаунтов, без обновления квот
  // (используется после переключения, чтобы не тянуть все квоты целиком)
  const refreshListOnly = useCallback(async () => {
    const s = await window.api.status();
    const l = await window.api.list();
    if (s.ok) setStatus(s.data);
    if (l.ok) setAccounts(l.data);
  }, []);

  // Обновить квоту только одного аккаунта: меняет состояние только этого id, не трогая остальные карточки
  const refreshOneAccountQuota = useCallback(async (id) => {
    if (!id) return;
    setAccountQuotas((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), loading: true, ok: false, error: null },
    }));
    const r = await window.api.accountQuota(id);
    setAccountQuotas((prev) => ({
      ...prev,
      [id]:
        r && r.ok
          ? { loading: false, ok: true, data: r.data, error: null }
          : { loading: false, ok: false, error: (r && r.error) || 'Квота недоступна' },
    }));
  }, []);

  const refreshImportedQuotas = useCallback(async (ids) => {
    const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
    for (const id of uniqueIds) await refreshOneAccountQuota(id);
    [8000, 20000, 40000].forEach((delay) => {
      setTimeout(() => {
        const latest = accountsRef.current;
        const existingIds = new Set(latest.map((acc) => acc.id));
        uniqueIds.forEach((id) => {
          if (!existingIds.has(id)) return;
          const q = accountQuotasRef.current[id];
          if (!(q?.ok && q?.data?.items?.length)) refreshOneAccountQuota(id);
        });
      }, delay);
    });
  }, [refreshOneAccountQuota]);

  useEffect(() => {
    const validIds = new Set(accounts.map((acc) => acc.id));
    setSelectedAccountIds((prev) => {
      let changed = false;
      const next = {};
      for (const id of Object.keys(prev)) {
        if (validIds.has(id)) next[id] = true;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [accounts]);

  const selectedIds = useMemo(() => Object.keys(selectedAccountIds).filter((id) => selectedAccountIds[id]), [selectedAccountIds]);

  const handleExportAccounts = useCallback(async () => {
    setBusy(true);
    try {
      const ids = selectedIds.length ? selectedIds : undefined;
      const r = await window.api.exportAccounts(ids);
      if (!r.ok) { showToast('error', r.error || 'Не удалось экспортировать'); return; }
      if (r.data?.canceled) return;
      showToast('success', `Экспортировано аккаунтов: ${r.data?.count || 0}. Надёжно сохраните файл экспорта`);
      if (selectedIds.length) setSelectedAccountIds({});
    } finally {
      setBusy(false);
    }
  }, [selectedIds, showToast]);

  const handleImportAccounts = useCallback(async () => {
    setBusy(true);
    try {
      const r = await window.api.importAccounts();
      if (!r.ok) { showToast('error', r.error || 'Не удалось импортировать'); return; }
      if (r.data?.canceled) return;

      const imported = r.data?.imported || [];
      const skipped = r.data?.skipped || [];
      const s = await window.api.status();
      const l = await window.api.list();
      if (s.ok) setStatus(s.data);
      if (l.ok) setAccounts(l.data);

      const ids = imported.map((x) => x.id).filter(Boolean);
      const fileErrors = (r.data?.files || []).filter((x) => x.error).length;
      const fileText = r.data?.fileCount > 1 ? `, всего файлов: ${r.data.fileCount}` : '';
      const skippedText = skipped.length ? `, пропущено: ${skipped.length}` : '';
      const errorText = fileErrors ? `, файлов с ошибкой: ${fileErrors}` : '';
      if (ids.length) {
        showToast('success', `Импортировано аккаунтов: ${ids.length}${fileText}${skippedText}${errorText}. Обновляем квоты`);
        await refreshImportedQuotas(ids);
      } else {
        showToast(skipped.length || fileErrors ? 'info' : 'error', skipped.length || fileErrors ? `Новых аккаунтов не импортировано${fileText}${skippedText}${errorText}` : 'В импортируемом файле нет пригодных аккаунтов');
      }
    } finally {
      setBusy(false);
    }
  }, [refreshImportedQuotas, showToast]);

  const refreshQuota = useCallback(async () => {
    // Общая квота теперь — это сумма по всем аккаунтам, обновление = повторно запросить квоты всех аккаунтов
    setQuotaLoading(true);
    await refreshAccountQuotas(accountsRef.current);
    setQuotaLoading(false);
  }, [refreshAccountQuotas]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refresh();
      // refresh() уже получил квоты всех аккаунтов; после обновления accountQuotas aggregateQuota
      // автоматически их суммирует — отдельно обновлять не нужно
      setLoading(false);
    })();
  }, [refresh]);

  // toast автоматически исчезает
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // id снимка для текущего залогиненного аккаунта (для углового бейджа «текущий» на карточке)
  // Важно: id аккаунта предпочтительно — emailShortId (дедупликация по email),
  // поэтому и здесь сопоставляем через emailShortId с acc.id
  const currentAccountId = status?.current?.emailShortId || status?.current?.shortId || null;

  // Автообновление квоты текущего аккаунта: опрос каждые 60 с, чтобы у активного аккаунта
  // всегда была свежая квота (без ручного нажатия «обновить»)
  useEffect(() => {
    if (!currentAccountId || loading) return;
    const timer = setInterval(() => {
      refreshOneAccountQuota(currentAccountId);
    }, 60000);
    return () => clearInterval(timer);
  }, [currentAccountId, loading, refreshOneAccountQuota]);

  // Обзор общей квоты: суммирует квоты ВСЕХ аккаунтов из списка, группирует по имени модели,
  // пересчитывается при изменении accountQuotas
  const aggregateQuota = useMemo(() => {
    const byModel = {}; // { modelName: { remaining, total, percentUsedSum, count } }
    let hasAny = false;
    let latestRefresh = 0;
    for (const q of Object.values(accountQuotas)) {
      if (!q?.ok || !q?.data?.items) continue;
      hasAny = true;
      if (q.data.refreshedAt && q.data.refreshedAt > latestRefresh) latestRefresh = q.data.refreshedAt;
      for (const item of q.data.items) {
        const name = item.name || 'Неизвестная модель';
        if (!byModel[name]) byModel[name] = { remaining: 0, total: 0, pctSum: 0, pctCount: 0 };
        const slot = byModel[name];
        if (item.remaining != null) slot.remaining += item.remaining;
        if (item.total != null) slot.total += item.total;
        if (item.percentUsed != null) { slot.pctSum += item.percentUsed; slot.pctCount++; }
      }
    }
    if (!hasAny) return null;
    const items = Object.entries(byModel).map(([name, s]) => {
      const used = (s.total != null && s.remaining != null) ? Math.max(0, s.total - s.remaining) : null;
      const total = s.total || null;
      const percentUsed = (total && used != null) ? (used / total) * 100 : null;
      return { name, total, used, remaining: s.remaining || null, percentUsed };
    });
    const totalRemaining = items.reduce((a, b) => a + (b.remaining || 0), 0);
    return {
      isEmpty: items.length === 0,
      items,
      refreshedAt: latestRefresh || null,
      display: {
        remaining: new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(totalRemaining),
      },
    };
  }, [accountQuotas]);

  // Поиск + фильтры: применяются совместно, по умолчанию показывается всё
  const onFilterChange = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);
  const clearFilters = useCallback(() => {
    setSearch('');
    setFilters({ health: 'all', quota: 'all' });
  }, []);

  const filteredAccounts = (() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((acc) => {
      // Поиск: название / email / name / провайдер
      if (q) {
        const hay = [acc.label, acc.email, acc.name, acc.provider]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // Состояние здоровья
      if (filters.health !== 'all') {
        const h = acc.health?.status || 'unknown';
        if (h !== filters.health) return false;
      }
      // Состояние квоты: доступна / недоступна
      if (filters.quota !== 'all') {
        const ok = accountQuotas[acc.id]?.ok;
        if (filters.quota === 'available' && !ok) return false;
        if (filters.quota === 'unavailable' && ok) return false;
      }
      return true;
    });
  })();

  const visibleIds = filteredAccounts.map((acc) => acc.id);
  const selectedCount = selectedIds.length;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedAccountIds[id]);
  const toggleAccountSelected = useCallback((id, checked) => {
    setSelectedAccountIds((prev) => {
      const next = { ...prev };
      if (checked) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);
  const toggleVisibleSelected = useCallback(() => {
    setSelectedAccountIds((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) visibleIds.forEach((id) => delete next[id]);
      else visibleIds.forEach((id) => { next[id] = true; });
      return next;
    });
  }, [allVisibleSelected, visibleIds]);

  // Захват
  const handleCapture = async (label) => {
    setBusy(true);
    const r = await window.api.capture({ label, note: '' });
    setBusy(false);
    if (!r.ok) {
      showToast('error', 'Не удалось захватить: ' + r.error);
      return;
    }
    if (r.data.created) {
      showToast('success', `Аккаунт захвачен: ${r.data.meta.label}`);
      setCaptureOpen(false);
      await refresh();
    } else if (r.data.skipped) {
      showToast('info', r.data.message + ' (чтобы обновить — сначала удалите, затем снова захватите)');
    }
  };

  // Переключение
  const handleUse = async (acc) => {
    setConfirm({
      title: 'Переключить аккаунт',
      desc: `ZCode будет закрыт и перезапущен с аккаунтом «${acc.label}».`,
      wide: true,
      detail: (
        <div>
          <div className="confirm-grid">
            <div className="confirm-card">
              <span className="confirm-label">Текущий аккаунт</span>
              <strong className="confirm-email">{status?.current?.email || status?.current?.label || 'не распознан'}</strong>
              <small>{status?.current?.provider || '-'} · {status?.current?.shortId || '-'}</small>
            </div>
            <div className="confirm-card target">
              <span className="confirm-label">Целевой аккаунт</span>
              <strong className="confirm-email">{acc.email || acc.label}</strong>
              <small>{acc.provider} · {acc.id}</small>
            </div>
          </div>
          <div className="confirm-notes">
            <div>Состояние снимка: <strong>{acc.health?.summary || 'не проверялось'}</strong></div>
            <div>Обзор квоты: <strong>{accountQuotas[acc.id]?.ok ? `остаток ${accountQuotas[acc.id].data?.display?.remaining || '—'} / всего ${accountQuotas[acc.id].data?.display?.total || '—'}` : (accountQuotas[acc.id]?.error || 'недоступна')}</strong></div>
            <div>Будет выполнено: закрыть ZCode → резервная копия .last → записать вход → перезапустить ZCode</div>
          </div>
        </div>
      ),
      confirmText: 'Переключить и перезапустить',
      onOk: async () => {
        setConfirm(null);
        setBusy(true);
        showToast('info', 'Переключение, подождите (ZCode перезапустится автоматически)…');
        const r = await window.api.use(acc.id);
        setBusy(false);
        if (r.ok) {
          showToast('success', `Переключено на «${acc.label}»`);
          // Сразу после переключения ставим квоту целевого аккаунта в loading,
          // чтобы карточка в левом верхнем углу сразу показала «Загрузка квоты…», не дожидаясь таймера 60 с
          setAccountQuotas((prev) => ({
            ...prev,
            [acc.id]: { ...(prev[acc.id] || {}), loading: true, ok: false, error: null },
          }));
          // Обновляем только status+список, без обновления квот всех аккаунтов (остальные не меняются)
          await refreshListOnly();
          // Запрашиваем квоту только переключённого целевого аккаунта
          await refreshOneAccountQuota(acc.id);
        } else {
          showToast('error', 'Не удалось переключить: ' + r.error);
        }
      },
    });
  };

  // Удаление
  const handleDelete = async (acc) => {
    setConfirm({
      title: 'Удалить снимок аккаунта',
      desc: `Удалить «${acc.label}»? Снимок входа этого аккаунта будет стёр (на текущий вход ZCode не повлияет).`,
      danger: true,
      confirmText: 'Удалить',
      onOk: async () => {
        setConfirm(null);
        setBusy(true);
        const r = await window.api.remove(acc.id);
        setBusy(false);
        if (r.ok && r.data.removed) {
          showToast('success', 'Удалено');
          // Обновляем только status+список, без обновления квот всех аккаунтов (остальные не меняются)
          await refreshListOnly();
          // Чистим остаточную запись этого аккаунта в accountQuotas, чтобы не было грязных данных
          setAccountQuotas((prev) => {
            if (!prev[acc.id]) return prev;
            const next = { ...prev };
            delete next[acc.id];
            return next;
          });
        } else {
          showToast('error', 'Не удалось удалить');
        }
      },
    });
  };

  const handleDeleteSelected = async () => {
    const selectedAccounts = accounts.filter((acc) => selectedAccountIds[acc.id]);
    if (!selectedAccounts.length) return;
    setConfirm({
      title: 'Пакетное удаление снимков аккаунтов',
      desc: `Удалить выбранные аккаунты (${selectedAccounts.length})? Снимки входа этих аккаунтов будут стёрты (на текущий вход ZCode не повлияет).`,
      danger: true,
      confirmText: `Удалить аккаунтов: ${selectedAccounts.length}`,
      detail: (
        <div className="confirm-notes">
          {selectedAccounts.slice(0, 8).map((acc) => (
            <div key={acc.id}>Будет удалён: <strong>{acc.email || acc.label || acc.id}</strong></div>
          ))}
          {selectedAccounts.length > 8 && <div>Ещё аккаунтов: {selectedAccounts.length - 8}…</div>}
        </div>
      ),
      onOk: async () => {
        setConfirm(null);
        setBusy(true);
        let removed = 0;
        let failed = 0;
        for (const acc of selectedAccounts) {
          const r = await window.api.remove(acc.id);
          if (r.ok && r.data.removed) removed++;
          else failed++;
        }
        setBusy(false);
        setSelectedAccountIds({});
        await refreshListOnly();
        setAccountQuotas((prev) => {
          const next = { ...prev };
          selectedAccounts.forEach((acc) => delete next[acc.id]);
          return next;
        });
        showToast(failed ? 'info' : 'success', failed ? `Удалено аккаунтов: ${removed}, с ошибкой: ${failed}` : `Удалено аккаунтов: ${removed}`);
      },
    });
  };

  // Переименование (inline-редактирование)
  const handleRename = async (acc, newLabel) => {
    setRenamingId(null);
    if (!newLabel || newLabel === acc.label) return;
    setBusy(true);
    const r = await window.api.rename(acc.id, newLabel);
    setBusy(false);
    if (r.ok) {
      showToast('success', 'Переименовано');
      await refresh();
    } else {
      showToast('error', 'Не удалось переименовать: ' + r.error);
    }
  };

  // Откат
  const handleRollback = async () => {
    setConfirm({
      title: 'Откат к состоянию до переключения',
      desc: 'Вернётся вход, который был до последнего переключения (используется резервная копия .last), и ZCode будет перезапущен.',
      onOk: async () => {
        setConfirm(null);
        setBusy(true);
        showToast('info', 'Выполняется откат…');
        const r = await window.api.rollback();
        setBusy(false);
        if (r.ok) {
          showToast('success', 'Откат выполнен');
          await refresh();
        } else {
          showToast('error', 'Не удалось откатить: ' + r.error);
        }
      },
    });
  };

  return (
    <div className="app">
      {/* Верхняя панель */}
      <header className="topbar">
        <h1>
          <span className="logo-dot" />
          Переключатель аккаунтов ZCode
        </h1>
        <div className="topbar-actions">
          <button
            className="btn btn-ghost btn-icon"
            title="Обновить"
            aria-label="Обновить список аккаунтов и квоты"
            onClick={async () => { await refresh(); await refreshQuota(); }}
            disabled={busy}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button
            className="btn"
            onClick={handleImportAccounts}
            disabled={busy}
            title="Импорт из файла со снимками аккаунтов"
          >
            <Upload size={16} />
            Импорт аккаунтов
          </button>
          <button
            className="btn"
            onClick={handleExportAccounts}
            disabled={busy || accounts.length === 0}
            title={selectedCount ? `Экспортировать выбранные аккаунты (${selectedCount})` : 'Без выбора экспортируются все аккаунты. Файл содержит вход аккаунтов — храните его надёжно'}
          >
            <Download size={16} />
            {selectedCount ? `Экспорт выбранных: ${selectedCount}` : 'Экспорт аккаунтов'}
          </button>
          <button
            className="btn"
            onClick={() => setCaptureOpen(true)}
            disabled={busy}
          >
            Захватить текущий аккаунт
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setAddOpen(true)}
            disabled={busy}
          >
            <Plus size={16} />
            Добавить аккаунт
          </button>
        </div>
      </header>

      {/* Панель состояния */}
      <StatusBar status={status} loading={loading} quota={aggregateQuota} quotaLoading={quotaLoading} onRefreshQuota={refreshQuota} currentQuota={currentAccountId ? accountQuotas[currentAccountId] : null} />

      {/* Панель поиска + фильтров (только когда есть аккаунты) */}
      {!loading && accounts.length > 0 && (
        <Toolbar
          search={search}
          onSearch={setSearch}
          filters={filters}
          onFilter={onFilterChange}
          total={accounts.length}
          shown={filteredAccounts.length}
          onClearFilters={clearFilters}
        />
      )}

      {/* Полоса выбора для экспорта */}
      {!loading && accounts.length > 0 && (
        <div className="export-select-bar">
          <span>{selectedCount ? `Выбрано аккаунтов для экспорта: ${selectedCount}` : 'Отметьте аккаунты, чтобы экспортировать только их; без выбора экспортируются все'}</span>
          <div className="export-select-actions">
            <button className="btn btn-ghost btn-sm" onClick={toggleVisibleSelected} disabled={busy || visibleIds.length === 0}>
              {allVisibleSelected ? 'Снять выделение с видимых' : 'Выбрать все видимые'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedAccountIds({})} disabled={busy || selectedCount === 0}>
              Очистить выбор
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected} disabled={busy || selectedCount === 0}>
              Удалить выбранные
            </button>
          </div>
        </div>
      )}

      {/* Список аккаунтов */}
      <main className="account-list">
        {loading ? (
          <div className="empty">
            <RefreshCw size={40} className="empty-icon spin" />
            <p>Загрузка…</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="empty">
            <Users size={56} className="empty-icon" />
            <strong className="empty-title">Сохранённых аккаунтов пока нет</strong>
            <p>
              Добавьте ниже или сначала войдите в ZCode, а затем захватите текущий вход.
            </p>
            <div className="empty-actions">
              <button className="btn btn-primary empty-action" onClick={() => setAddOpen(true)} disabled={busy}>
                <Plus size={16} />
                Добавить аккаунт
              </button>
              <button className="btn empty-action" onClick={handleImportAccounts} disabled={busy}>
                <Upload size={16} />
                Импорт аккаунтов
              </button>
              <button className="btn empty-action" onClick={() => setCaptureOpen(true)} disabled={busy}>
                Захватить текущий аккаунт
              </button>
            </div>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="empty">
            <SearchX size={56} className="empty-icon" />
            <strong className="empty-title">Ничего не найдено</strong>
            <p>
              При текущем поиске или фильтрах результатов нет. Поменяйте запрос или сбросьте фильтры.
            </p>
            <button className="btn btn-primary btn-sm empty-action" onClick={clearFilters}>
              Сбросить фильтры
            </button>
          </div>
        ) : (
          filteredAccounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              quota={accountQuotas[acc.id]}
              isCurrent={acc.id === currentAccountId}
              busy={busy}
              renaming={renamingId === acc.id}
              selected={!!selectedAccountIds[acc.id]}
              onSelectedChange={(checked) => toggleAccountSelected(acc.id, checked)}
              onUse={() => handleUse(acc)}
              onDelete={() => handleDelete(acc)}
              onRenameStart={() => setRenamingId(acc.id)}
              onRenameCommit={(label) => handleRename(acc, label)}
              onRefreshQuota={refreshOneAccountQuota}
            />
          ))
        )}
      </main>

      {/* Нижняя панель */}
      <footer className="footer">
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleRollback}
          disabled={busy || !status?.hasLastBackup}
          aria-label="Откатить к входу, который был до последнего переключения"
          title={
            status?.hasLastBackup
              ? 'Откатить к входу, который был до последнего переключения'
              : 'Резервной копии для отката пока нет'
          }
        >
          <Undo2 size={14} />
          Откатить последнее переключение
        </button>
        <span className="footer-tip">
          <Info size={13} />
          Переключение само закрывает и перезапускает ZCode
        </span>
      </footer>

      {/* Диалоги */}
      {captureOpen && (
        <CaptureModal
          onClose={() => setCaptureOpen(false)}
          onConfirm={handleCapture}
          busy={busy}
          defaultName={status?.current ? 'Аккаунт-' + status.current.shortId : ''}
        />
      )}
      {addOpen && (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onDone={async (newAccountId) => {
            setAddOpen(false);
            // Обновляем только список аккаунтов + текущий статус, без обновления квот прежних аккаунтов
            const s = await window.api.status();
            const l = await window.api.list();
            if (s.ok) setStatus(s.data);
            if (l.ok) setAccounts(l.data);

            const accountsAfterAdd = l.ok && Array.isArray(l.data) ? l.data : [];
            const exists = accountsAfterAdd.some((acc) => acc.id === newAccountId);
            const latest = accountsAfterAdd[accountsAfterAdd.length - 1];
            const targetId = exists ? newAccountId : latest?.id;

            // Автообновление квоты нового аккаунта (используем реальный id из списка,
            // чтобы в асинхронном событии не ссылаться на устаревший id, не найденный в снимке)
            if (targetId) {
              // Сразу ставим loading, чтобы карточка не мигала «квота недоступна»
              setAccountQuotas((prev) => ({
                ...prev,
                [targetId]: { loading: true, ok: false, error: null },
              }));
              await refreshOneAccountQuota(targetId);
              // Биллинг на сервере для нового аккаунта может быть ещё не готов (часть квот инициализируется с задержкой):
              // прогрессируем 3 повтора (8 с / 20 с / 40 с), покрывая окно инициализации сервера
              [8000, 20000, 40000].forEach((delay) => {
                setTimeout(() => {
                  setAccountQuotas((prev) => {
                    if (prev[targetId]?.ok && prev[targetId]?.data?.items?.length) return prev; // если данные уже есть — не повторяем
                    refreshOneAccountQuota(targetId);
                    return prev;
                  });
                }, delay);
              });
            }
          }}
          showToast={showToast}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          desc={confirm.desc}
          detail={confirm.detail}
          danger={confirm.danger}
          confirmText={confirm.confirmText}
          wide={confirm.wide}
          onCancel={() => setConfirm(null)}
          onOk={confirm.onOk}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' && <CheckCircle2 size={16} color="#22c55e" />}
          {toast.type === 'error' && <XCircle size={16} color="#ef4444" />}
          {toast.type === 'info' && <AlertTriangle size={16} color="#f59e0b" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
