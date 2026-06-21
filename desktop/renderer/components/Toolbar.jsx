import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Панель инструментов над списком аккаунтов: поиск + группы фильтров + счётчик результатов
 *
 * props:
 *   search         string          текущий поисковый запрос
 *   onSearch       (v)=>void
 *   filters        {scope, health, quota}   каждый 'all' | ...
 *   onFilter       (key, value)=>void
 *   total          number          общее число аккаунтов до фильтрации
 *   shown          number          число аккаунтов после фильтрации
 *   onClearFilters ()=>void        очистить поиск + все фильтры
 */
export default function Toolbar({
  search,
  onSearch,
  filters = {},
  onFilter,
  total,
  shown,
  onClearFilters,
}) {
  const inputRef = useRef(null);

  // Когда поле ввода не в фокусе, «/» быстро перемещает фокус в поиск (необязательное ускорение)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasFilters =
    !!search ||
    (filters.health && filters.health !== 'all') ||
    (filters.quota && filters.quota !== 'all');

  return (
    <section className="toolbar" aria-label="Поиск и фильтры">
      <div className="toolbar-top">
        <div className="search-box">
          <Search size={15} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Поиск по названию / email / провайдеру"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Поиск аккаунтов"
          />
          {search ? (
            <button
              className="search-clear"
              onClick={() => onSearch('')}
              title="Очистить поиск"
              aria-label="Очистить поиск"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div className="results-count" aria-live="polite">
          {hasFilters ? `Найдено ${shown} из ${total} аккаунтов` : `Всего аккаунтов: ${total}`}
        </div>
      </div>

      <div className="toolbar-filters">
        <FilterGroup
          label="Здоровье"
          value={filters.health || 'all'}
          onChange={(v) => onFilter('health', v)}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'healthy', label: 'Здоров' },
            { value: 'warning', label: 'Внимание' },
            { value: 'error', label: 'Ошибка' },
          ]}
        />
        <FilterGroup
          label="Квота"
          value={filters.quota || 'all'}
          onChange={(v) => onFilter('quota', v)}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'available', label: 'Доступна' },
            { value: 'unavailable', label: 'Недоступна' },
          ]}
        />
        {hasFilters ? (
          <button className="filter-clear" onClick={onClearFilters} aria-label="Очистить поиск и фильтры">
            <X size={13} />
            Сбросить фильтры
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FilterGroup({ label, value, onChange, options }) {
  return (
    <div className="filter-group" role="group" aria-label={label}>
      <span className="filter-label">{label}</span>
      <div className="segmented">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`segment ${value === opt.value ? 'active' : ''}`}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
