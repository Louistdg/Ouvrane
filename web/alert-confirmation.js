// Keep a newly created alert in the visible tab and give each recipient a clear response contract.
(() => {
  const modes = {none:'Information seule',confirm:'Confirmation demandée',reply:'Réponse demandée'};
  const current = id => reminders.find(item => item.id === id);
  const recipientIds = item => typeof alertRecipients === 'function' ? alertRecipients(item) : item.recipientIds || [];
  const modeField = item => `<label>Suivi demandé<select name="responseMode"><option value="none" ${!item?.responseMode || item.responseMode === 'none' ? 'selected' : ''}>Information seule</option><option value="confirm" ${item?.responseMode === 'confirm' ? 'selected' : ''}>Demander une confirmation</option><option value="reply" ${item?.responseMode === 'reply' ? 'selected' : ''}>Demander une réponse</option></select></label>`;
  function addMode(form, item) {
    if (form && !form.querySelector('[name="responseMode"]')) form.querySelector('.modal-actions')?.insertAdjacentHTML('beforebegin', modeField(item));
  }
  const oldReminderForm = reminderForm;
  reminderForm = function(id = '', ...rest) {
    oldReminderForm(id, ...rest);
    addMode(document.querySelector('#modal form'), current(id));
  };
  const oldWorkerAlertForm = workerAlertForm;
  workerAlertForm = function(...args) {
    oldWorkerAlertForm(...args);
    addMode(document.querySelector('#modal form'));
  };
  function finishSave(previousIds, form) {
    const item = [...reminders].reverse().find(row => !previousIds.has(row.id));
    if (!item) return;
    item.responseMode = form.get('responseMode') || 'none';
    item.createdAt = new Date().toISOString();
    if (typeof alertTab !== 'undefined') alertTab = effectiveTaskState(item);
    render();
    scheduleSave();
  }
  const oldSaveMultiReminder = saveMultiReminder;
  saveMultiReminder = function(event, id) {
    const form = new FormData(event.target), previousIds = new Set(reminders.map(item => item.id));
    const result = oldSaveMultiReminder(event, id);
    const item = id ? current(id) : null;
    if (item && !document.querySelector('#modal')?.open) {
      const nextMode = form.get('responseMode') || 'none';
      if ((item.responseMode || 'none') !== nextMode) item.recipientProgress = {};
      item.responseMode = nextMode;
      scheduleSave();
    }
    else finishSave(previousIds, form);
    return result;
  };
  const oldSaveWorkerAlert = saveWorkerAlert;
  saveWorkerAlert = function(event) {
    const form = new FormData(event.target), previousIds = new Set(reminders.map(item => item.id));
    const result = oldSaveWorkerAlert(event);
    finishSave(previousIds, form);
    return result;
  };
  function pending(item, personId) {
    const progress = item.recipientProgress?.[personId];
    return !progress || !['confirmed', 'replied'].includes(progress.state);
  }
  const oldShowReminder = showReminder;
  showReminder = function(id) {
    oldShowReminder(id);
    const item = current(id), root = document.querySelector('#modalbody .modal-inner');
    if (!item || !root) return;
    const mode = modes[item.responseMode || 'none'];
    const person = typeof sessionPerson === 'function' ? sessionPerson() : null;
    const canManage = typeof canFieldAction === 'function' && canFieldAction('manageAlerts');
    if (!canManage) root.querySelector('.modal-actions')?.remove();
    let controls = '';
    if (person && recipientIds(item).includes(person.id) && !canManage && pending(item, person.id)) {
      if (item.responseMode === 'confirm') controls = `<button class="btn primary" onclick="respondToAlert('${jsString(id)}','confirm')">Confirmer la lecture</button>`;
      if (item.responseMode === 'reply') controls = `<button class="btn primary" onclick="replyToAlertForm('${jsString(id)}')">Répondre</button>`;
    }
    const rows = recipientIds(item).map(pid => {
      const progress = item.recipientProgress?.[pid];
      const status = progress?.state === 'confirmed' ? 'Confirmé' : progress?.state === 'replied' ? 'Répondu' : 'En attente';
      return `<p><strong>${esc(getPerson(pid)?.name || 'Ancien membre')}</strong> · ${status}${progress?.reply ? `<br>${esc(progress.reply)}` : ''}</p>`;
    }).join('');
    root.insertAdjacentHTML('beforeend', `<section class="clock-history"><h3>${mode}</h3>${rows || '<p>Pour le responsable.</p>'}${controls}</section>`);
  };
  window.respondToAlert = async function(id, action, message = '') {
    const item = current(id), person = typeof sessionPerson === 'function' ? sessionPerson() : null;
    if (!item || !person || !recipientIds(item).includes(person.id) || !pending(item, person.id)) return;
    if (action === 'confirm' && item.responseMode !== 'confirm') return;
    if (action === 'reply' && (item.responseMode !== 'reply' || !String(message).trim())) return;
    let saved;
    try {
      saved = await serverJson('/api/alerts/respond',{method:'POST',body:JSON.stringify({id,action,reply:String(message).trim()})});
    } catch (error) {
      toast(error.message || 'Réponse impossible. Réessayez.');
      return;
    }
    const at = saved.progress.at;
    item.recipientProgress ||= {};
    item.recipientProgress[person.id] = saved.progress;
    item.history ||= [];
    item.history.push({action:action === 'confirm' ? 'Confirmation reçue' : 'Réponse reçue', by:person.name, at});
    storageRevision = saved.revision;
    savedSnapshot = workspaceSnapshot();
    closeModal(); render();
    toast(action === 'confirm' ? 'Confirmation enregistrée. Le responsable la verra dans Tâches & alertes.' : 'Réponse enregistrée. Le responsable la verra dans Tâches & alertes.');
  };
  window.replyToAlertForm = function(id) {
    const item = current(id), person = typeof sessionPerson === 'function' ? sessionPerson() : null;
    if (!item || !person || !recipientIds(item).includes(person.id) || item.responseMode !== 'reply') return;
    modal('Répondre à l’alerte', `<form onsubmit="event.preventDefault();respondToAlert('${jsString(id)}','reply',new FormData(event.target).get('reply'))"><p>${esc(item.title)}</p><label>Votre réponse<textarea name="reply" required maxlength="1000" rows="4"></textarea></label><div class="modal-actions"><button class="btn primary">Envoyer la réponse</button></div></form>`);
  };
  const oldActions = actions;
  actions = function(...args) {
    const content = oldActions(...args);
    const received = reminders.flatMap(item => Object.values(item.recipientProgress || {}).filter(progress => ['confirmed', 'replied'].includes(progress.state)).map(progress => ({item, progress}))).sort((a,b) => b.progress.at.localeCompare(a.progress.at));
    if (!received.length || !(typeof canFieldAction === 'function' && canFieldAction('manageAlerts'))) return content;
    const panel = `<section class="panel alert-replies"><div class="panel-head"><h2>Confirmations et réponses reçues <span class="count">${received.length}</span></h2></div>${received.slice(0,12).map(({item,progress}) => `<button class="task alert-row" onclick="showReminder('${jsString(item.id)}')"><span class="task-text"><strong>${esc(item.title)}</strong><small>${esc(progress.by)} · ${progress.state === 'confirmed' ? 'A confirmé' : 'A répondu'} · ${esc(progress.reply || '')}</small></span><span aria-hidden="true">↗</span></button>`).join('')}</section>`;
    return panel + content;
  };
})();
