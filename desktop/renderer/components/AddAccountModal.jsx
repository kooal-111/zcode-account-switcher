import React, { useEffect, useRef, useState } from 'react';
import { Loader2, UserPlus, CheckCircle2, LogIn, ShieldCheck } from 'lucide-react';

/**
 * Окно добавления аккаунта (CLI OAuth + системный браузер)
 */
export default function AddAccountModal({ onClose, onDone, showToast }) {
  // phase: opening | waiting | exchanging | saved | error
  const [phase, setPhase] = useState('opening');
  const [progressMsg, setProgressMsg] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const unsubFlowRef = useRef(null);

  const cleanup = () => {
    if (unsubFlowRef.current) { unsubFlowRef.current(); unsubFlowRef.current = null; }
  };
  useEffect(() => {
    return () => {
      cleanup();
      try { window.api.oauthCancel(); } catch (_) {}
    };
  }, []);

  useEffect(() => {
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setError('');
    setBusy(true);
    setPhase('opening');
    setProgressMsg('Открываю системный браузер...');

    unsubFlowRef.current = window.api.onFlowEvent((event) => handleFlowEvent(event));

    const r = await window.api.oauthStart({});
    if (!r.ok) {
      if (unsubFlowRef.current) { unsubFlowRef.current(); unsubFlowRef.current = null; }
      fail(r.error);
      return;
    }
  };

  const handleFlowEvent = (event) => {
    switch (event.type) {
      case 'browser-open':
        setPhase('opening');
        setProgressMsg(event.message || 'Открываю системный браузер');
        break;
      case 'waiting-login':
        setPhase('waiting');
        setProgressMsg(event.message || 'Ожидание входа');
        break;
      case 'exchanging':
        setPhase('exchanging');
        setProgressMsg(event.message || 'Сохраняю аккаунт...');
        if (event.email) setEmail(event.email);
        break;
      case 'saved':
        setPhase('saved');
        setBusy(false);
        cleanup();
        if (event.email) setEmail(event.email);
        if (event.skipped) {
          showToast('info', 'Этот аккаунт уже добавлен (' + (event.account?.label || 'существует') + ')');
        } else {
          showToast('success', `Аккаунт добавлен: ${event.account?.label || event.email || 'новый аккаунт'}`);
        }
        setTimeout(() => onDone(event.account?.id), 800);
        break;
      case 'error':
        setBusy(false);
        cleanup();
        setError(event.message || 'Ошибка в процессе');
        setPhase('error');
        break;
      default:
        break;
    }
  };

  const fail = (msg) => {
    setError(msg || 'Не удалось выполнить');
    setBusy(false);
    setPhase('error');
  };

  const retry = () => {
    cleanup();
    setError('');
    start();
  };

  const handleClose = () => {
    if (phase === 'exchanging' || phase === 'saved') return;
    cleanup();
    window.api.oauthCancel();
    onClose();
  };

  const phaseLabel = {
    opening: 'Открытие страницы входа',
    waiting: 'Ожидание входа',
    exchanging: 'Сохранение',
    saved: 'Готово',
    error: 'Ошибка',
  }[phase] || '';

  return (
    <div className="modal-overlay" onClick={phase === 'exchanging' || phase === 'saved' ? undefined : handleClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>
          <UserPlus size={18} />
          Добавить аккаунт
          {phaseLabel && <span className="phase-tag">{phaseLabel}</span>}
        </h2>

        {phase === 'opening' && (
          <div className="oauth-panel">
            <div className="install-box">
              <Loader2 size={28} className="spin" />
              <strong>{progressMsg || 'Подготовка...'}</strong>
              <span className="progress-hint">Сейчас откроется системный браузер для входа</span>
            </div>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="oauth-panel">
            <div className="waiting-box">
              <LogIn size={34} />
              <strong>Войдите в окне системного браузера</strong>
              <span>Инструмент сам отследит вход и завершит добавление</span>
              <span className="progress-hint">Поддерживается вход по логину/паролю или телефону (после входа ничего делать не нужно)</span>
              <Loader2 size={20} className="spin" />
            </div>
          </div>
        )}

        {phase === 'exchanging' && (
          <div className="oauth-panel">
            <div className="install-box">
              <ShieldCheck size={28} color="#22c55e" />
              <strong>Вход выполнен, сохраняю аккаунт...</strong>
              <Loader2 size={20} className="spin" />
              <span className="progress-hint">Всё автоматически, подождите немного</span>
            </div>
          </div>
        )}

        {phase === 'saved' && (
          <div className="oauth-panel">
            <div className="logged-in-box">
              <CheckCircle2 size={32} color="#22c55e" />
              <strong>Аккаунт успешно добавлен</strong>
              {email && <span className="login-email">{email}</span>}
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="oauth-panel">
            <div className="oauth-error">
              <strong>Ошибка:</strong>{error}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={handleClose} disabled={busy}>
            {phase === 'saved' || phase === 'error' ? 'Закрыть' : 'Отмена'}
          </button>
          {phase === 'error' && (
            <button className="btn btn-primary" onClick={retry} disabled={busy}>
              Повторить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
