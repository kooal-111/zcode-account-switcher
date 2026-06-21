'use strict';
/**
 * preload - безопасный мост
 *
 * Через contextBridge экспонирует ограниченный объект window.api в процесс рендеринга.
 * Процесс рендеринга может вызывать только перечисленные методы, без прямого доступа к Node / файловой системе.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  status: () => ipcRenderer.invoke('account:status'),
  list: () => ipcRenderer.invoke('account:list'),
  capture: (opts) => ipcRenderer.invoke('account:capture', opts),
  use: (id) => ipcRenderer.invoke('account:use', id),
  remove: (id) => ipcRenderer.invoke('account:delete', id),
  rename: (id, label) => ipcRenderer.invoke('account:rename', id, label),
  exportAccounts: (ids) => ipcRenderer.invoke('account:export', ids),
  importAccounts: () => ipcRenderer.invoke('account:import'),
  // OAuth добавление аккаунта (CLI OAuth + системный браузер)
  oauthStart: (opts) => ipcRenderer.invoke('account:oauth-start', opts),
  oauthCancel: () => ipcRenderer.invoke('account:oauth-cancel'),
  // Подписка на события процесса (возвращает функцию отписки)
  // cb получает event: {type: 'browser-open'|'waiting-login'|'exchanging'|'saved'|'error', ...}
  onFlowEvent: (cb) => {
    const handler = (_e, event) => cb(event);
    ipcRenderer.on('oauth:flow-event', handler);
    return () => ipcRenderer.removeListener('oauth:flow-event', handler);
  },
  quota: () => ipcRenderer.invoke('account:quota'),
  accountQuota: (id) => ipcRenderer.invoke('account:quota-one', id),
  accountQuotas: (ids) => ipcRenderer.invoke('account:quota-many', ids),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  rollback: () => ipcRenderer.invoke('account:rollback'),
});
