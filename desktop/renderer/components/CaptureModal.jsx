import React, { useState, useEffect, useRef } from 'react';
import { UserPlus, Loader2 } from 'lucide-react';

/**
 * Окно сохранения текущего аккаунта в снимок
 */
export default function CaptureModal({ onClose, onConfirm, busy, defaultName }) {
  const [name, setName] = useState(defaultName || '');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => onConfirm(name.trim() || defaultName);

  const handleKey = (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          <UserPlus size={18} />
          Сохранить текущий аккаунт
        </h2>
        <p>
          Сохраняет текущий вход ZCode в снимок — после этого можно переключаться на него в один клик без повторного входа.
        </p>
        <input
          ref={inputRef}
          className="modal-input"
          placeholder="Назовите аккаунт (например: основной)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
        />
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
