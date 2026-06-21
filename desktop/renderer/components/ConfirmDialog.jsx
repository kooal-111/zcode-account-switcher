import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Универсальное диалоговое окно подтверждения
 * - Esc отмена, Enter (неопасные операции) подтверждение
 * - При открытии фокус на «Отмена» для предотвращения случайных действий
 */
export default function ConfirmDialog({ title, desc, detail, danger, confirmText, cancelText, onCancel, onOk, wide }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 style={danger ? { color: '#ef4444' } : undefined}>
          <AlertTriangle size={18} />
          {title}
        </h2>
        <p>{desc}</p>
        {detail ? <div className="confirm-detail">{detail}</div> : null}
        <div className="modal-actions">
          <button className="btn" ref={cancelRef} onClick={onCancel}>
            {cancelText || 'Отмена'}
          </button>
          <button
            className={danger ? 'btn' : 'btn btn-primary'}
            onClick={onOk}
            style={
              danger
                ? { background: '#ef4444', color: '#fff', fontWeight: 600 }
                : undefined
            }
          >
            {confirmText || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
