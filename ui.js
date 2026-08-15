/*
 * ui.js — renderizado y wiring de la interfaz (usa window.Core para toda la
 * lógica de dominio).
 *
 * Persistencia: si la app se sirve desde server.js (node server.js), el
 * estado se guarda en /api/state — un único data.json en el servidor que
 * TODOS los que abren el link comparten (no una copia por navegador). Si no
 * hay servidor disponible (por ejemplo, se abrió index.html directo con
 * doble clic), cae automáticamente a localStorage como modo standalone.
 */
(function () {
  'use strict';
  const STORAGE_KEY = 'hogar-colonia-calendario-v1';

  let state = null;
  let usingServer = true;
  let editingStudentId = null;
  let editingWeekStart = null;
  let editingWeekDraft = null;

  function defaultState() {
    return {
      students: JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS)),
      lockedWeeks: [],
      pendingProposal: null,
      settings: {},
    };
  }

  function normalizeState(parsed) {
    return {
      students: Array.isArray(parsed.students) ? parsed.students : defaultState().students,
      lockedWeeks: Array.isArray(parsed.lockedWeeks) ? parsed.lockedWeeks : [],
      pendingProposal: parsed.pendingProposal || null,
      settings: parsed.settings || {},
    };
  }

  function loadStateFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : null;
    } catch (e) {
      console.error('No se pudo leer el respaldo local.', e);
      return null;
    }
  }

  // undefined = no hay servidor disponible (modo standalone); null = hay
  // servidor pero todavía no guardó nada; objeto = estado real del servidor.
  async function loadStateFromServer() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      return data ? normalizeState(data) : null;
    } catch (e) {
      return undefined;
    }
  }

  async function initState() {
    const fromServer = await loadStateFromServer();
    if (fromServer === undefined) {
      usingServer = false;
      state = loadStateFromLocalStorage() || defaultState();
    } else {
      usingServer = true;
      state = fromServer || defaultState();
    }
    updateConnStatus();
  }

  function saveState() {
    if (usingServer) {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch((e) => {
        console.error('No se pudo guardar en el servidor; se guarda localmente como respaldo.', e);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e2) { /* noop */ }
        showToast('No se pudo guardar en el servidor. Revisá que server.js siga corriendo.');
      });
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
    }
  }

  function updateConnStatus() {
    const el = document.getElementById('conn-status');
    if (!el) return;
    if (usingServer) {
      el.textContent = 'Compartido (servidor local)';
      el.className = 'conn-status online';
    } else {
      el.textContent = 'Solo este navegador (sin servidor)';
      el.className = 'conn-status offline';
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function slugify(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'estudiante';
  }
  function uniqueId(base) {
    let id = base;
    let n = 2;
    while (state.students.some((s) => s.id === id)) { id = `${base}-${n}`; n++; }
    return id;
  }

  // -----------------------------------------------------------------
  // Render compartido: grilla Día × Áreas (usada en la propuesta y en
  // las semanas guardadas — misma forma de datos en ambos casos)
  // -----------------------------------------------------------------
  function renderWeekGridTable(weekLike) {
    const header = `<tr><th>Día</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}</tr>`;
    const rows = weekLike.days.map((day) => {
      const cellByArea = {};
      day.assignments.forEach((a) => {
        const existing = cellByArea[a.area];
        cellByArea[a.area] = existing ? `${existing}, ${escapeHtml(a.name)}` : escapeHtml(a.name);
      });
      const dateObj = Core.fromISO(day.date);
      const cells = Core.AREAS.map((ar) => `<td>${cellByArea[ar.id] || '<span class="muted">—</span>'}</td>`).join('');
      return `<tr class="dow-${day.dow}"><td><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table>${header}${rows}</table></div>`;
  }

  function renderAudit(audit) {
    if (!audit.warnings.length) {
      return '<div class="alert ok">✓ Sin conflictos ni alertas detectadas para esta semana.</div>';
    }
    return audit.warnings.map((w) => `<div class="alert ${w.severity}">${escapeHtml(w.message)}</div>`).join('');
  }

  function renderEditableDays(proposal, studentsById) {
    return proposal.days.map((day) => {
      const dateObj = Core.fromISO(day.date);
      const head = `<div class="day-block-head"><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</div>`;
      if (!day.assignments.length) {
        return `<div class="day-block">${head}<p class="muted">Sin estudiantes activos con este día fijo.</p></div>`;
      }
      const rows = day.assignments.map((a) => {
        const student = studentsById[a.studentId];
        const elig = student ? Core.eligibleAreas(student) : Core.AREAS;
        const options = elig.map((ar) => `<option value="${ar.id}" ${ar.id === a.area ? 'selected' : ''}>${escapeHtml(ar.label)}</option>`).join('');
        return `<div class="assign-row"><span class="name">${escapeHtml(a.name)}</span><select data-action="set-area" data-date="${day.date}" data-student="${a.studentId}">${options}</select></div>`;
      }).join('');
      return `<div class="day-block">${head}${rows}</div>`;
    }).join('');
  }

  // -----------------------------------------------------------------
  // Tab: Generar
  // -----------------------------------------------------------------
  function renderGenerar() {
    const el = document.getElementById('tab-generar');
    if (state.pendingProposal) {
      const proposal = state.pendingProposal;
      const audit = Core.auditWeek(state.students, state.lockedWeeks, proposal);
      const label = `Semana ${proposal.weekIndex} de ${Core.MONTH_NAMES_ES[proposal.month - 1]} ${proposal.year} (${Core.formatDateEs(Core.fromISO(proposal.startDate))} – ${Core.formatDateEs(Core.fromISO(proposal.endDate))})`;
      const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));
      el.innerHTML = `
        <div class="card">
          <h2>Propuesta: ${escapeHtml(label)}</h2>
          <p class="muted">Editá el área de cada estudiante si hace falta. La IA nunca aplica esto por su cuenta: queda a la espera de que lo apruebes.</p>
          <div class="audit-list">${renderAudit(audit)}</div>
        </div>
        <div class="card">
          <h3>Asignaciones por día (editable)</h3>
          ${renderEditableDays(proposal, studentsById)}
        </div>
        <div class="card">
          <h3>Vista previa</h3>
          ${renderWeekGridTable(proposal)}
          <div class="btn-row">
            <button class="btn secondary" data-action="regenerate">Regenerar propuesta automática</button>
            <button class="btn" data-action="approve">Aprobar y bloquear semana</button>
            <button class="btn danger" data-action="discard">Descartar propuesta</button>
          </div>
        </div>
      `;
      return;
    }

    const weekInfo = Core.getNextPendingWeekInfo(state);
    if (!weekInfo) {
      el.innerHTML = '<div class="empty-state">No se pudo calcular la próxima semana.</div>';
      return;
    }
    const label = Core.formatWeekLabel(weekInfo);
    const isPartial = weekInfo.days.length < 7;
    const startPicker = state.lockedWeeks.length === 0 ? `
      <div class="form-row">
        <div class="form-field">
          <label>Mes de inicio del calendario</label>
          <input type="month" id="start-month-input" value="${state.settings.startDate ? state.settings.startDate.slice(0, 7) : Core.toISO(new Date()).slice(0, 7)}">
        </div>
      </div>
      <p class="muted">El calendario de ese mes siempre arranca el día 1. Una vez que se bloquea la primera semana, los meses siguientes se calculan solos.</p>
    ` : '';
    el.innerHTML = `
      <div class="card">
        <h2>Próxima semana pendiente</h2>
        ${startPicker}
        <p>${escapeHtml(label)}${isPartial ? ' <span class="badge">semana parcial</span>' : ''}</p>
        <div class="btn-row"><button class="btn" data-action="propose">Proponer semana</button></div>
      </div>
    `;
  }

  function handleProposeClick() {
    const weekInfo = Core.getNextPendingWeekInfo(state);
    if (!weekInfo) return;
    state.pendingProposal = Core.generateWeekProposal(state.students, state.lockedWeeks, weekInfo);
    saveState();
    renderGenerar();
  }

  function handleRegenerateClick() {
    const p = state.pendingProposal;
    if (!p) return;
    const weekInfo = {
      index: p.weekIndex,
      year: p.year,
      month: p.month,
      start: Core.fromISO(p.startDate),
      end: Core.fromISO(p.endDate),
      days: p.days.map((d) => Core.fromISO(d.date)),
    };
    state.pendingProposal = Core.generateWeekProposal(state.students, state.lockedWeeks, weekInfo);
    saveState();
    renderGenerar();
    showToast('Propuesta regenerada automáticamente.');
  }

  function handleDiscardClick() {
    if (!confirm('¿Descartar esta propuesta? No se guarda nada.')) return;
    state.pendingProposal = null;
    saveState();
    renderGenerar();
  }

  function handleApproveClick() {
    const proposal = state.pendingProposal;
    if (!proposal) return;
    const audit = Core.auditWeek(state.students, state.lockedWeeks, proposal);
    if (audit.warnings.length) {
      const ok = confirm(`Hay ${audit.warnings.length} alerta(s) activa(s) para esta semana. ¿Confirmás bloquearla de todas formas?`);
      if (!ok) return;
    }
    state.lockedWeeks.push({
      year: proposal.year,
      month: proposal.month,
      weekIndex: proposal.weekIndex,
      startDate: proposal.startDate,
      endDate: proposal.endDate,
      days: proposal.days.map((d) => ({
        date: d.date,
        dow: d.dow,
        assignments: d.assignments.map((a) => ({ studentId: a.studentId, name: a.name, area: a.area })),
      })),
      approvedAt: new Date().toISOString(),
    });
    state.pendingProposal = null;
    saveState();
    renderAll();
    showToast('Semana bloqueada. No se podrá reescribir salvo pedido explícito.');
  }

  function handleStartMonthChange(input) {
    const val = input.value; // YYYY-MM
    if (!val) return;
    state.settings.startDate = `${val}-01`;
    saveState();
    renderGenerar();
  }

  function handleSetArea(select) {
    const { date, student } = select.dataset;
    const area = select.value;
    const day = state.pendingProposal.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === student);
    if (a) a.area = area;
    saveState();
    renderGenerar();
  }

  // -----------------------------------------------------------------
  // Tab: Estudiantes
  // -----------------------------------------------------------------
  function renderEstudiantes() {
    const el = document.getElementById('tab-estudiantes');
    const sortedAssignments = Core.allAssignmentsSorted(state.lockedWeeks);
    const sortedStudents = [...state.students].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const maxPoints = Math.max(1, ...state.students.map((s) => Core.totalPointsForStudent(sortedAssignments, s.id)));

    const dayOptions = Core.DOW_NAMES_ES.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('');

    const rows = sortedStudents.map((s) => {
      const points = Core.totalPointsForStudent(sortedAssignments, s.id);
      const pct = Math.round((points / maxPoints) * 100);
      const editing = editingStudentId === s.id;
      const kitchenLabel = s.kitchenGroup === 'k2' ? 'Cocina 2' : 'Cocina';
      const mainHtml = editing ? `
          <input type="text" id="edit-name-input" value="${escapeHtml(s.name)}">
          <div class="form-row" style="margin-top:8px;">
            <div class="form-field"><label>Día fijo</label><select id="edit-day-input">${Core.DOW_NAMES_ES.map((d, i) => `<option value="${i + 1}" ${i + 1 === s.fixedDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
            <div class="form-field"><label>Grupo de cocina</label><select id="edit-kitchen-input"><option value="k1" ${s.kitchenGroup === 'k1' ? 'selected' : ''}>Cocina</option><option value="k2" ${s.kitchenGroup === 'k2' ? 'selected' : ''}>Cocina 2</option></select></div>
          </div>
        ` : `
          <span class="student-name">${escapeHtml(s.name)}</span>
          <div class="student-meta">${Core.DOW_NAMES_ES[s.fixedDay - 1]} · Grupo: ${kitchenLabel} · ${s.active ? 'Activo' : 'Inactivo'} · ${points} pts acumulados</div>
          <div class="load-bar-track"><div class="load-bar-fill" style="width:${pct}%"></div></div>
        `;
      const actions = editing ? `
          <button class="btn small" data-action="save-rename" data-id="${s.id}">Guardar</button>
          <button class="btn small secondary" data-action="cancel-rename" data-id="${s.id}">Cancelar</button>
        ` : `
          <button class="btn small secondary" data-action="rename" data-id="${s.id}">Editar</button>
          <button class="btn small secondary" data-action="toggle-active" data-id="${s.id}">${s.active ? 'Desactivar' : 'Activar'}</button>
          <button class="btn small danger" data-action="delete" data-id="${s.id}">Eliminar</button>
        `;
      return `<div class="student-row ${s.active ? '' : 'inactive'}" data-id="${s.id}">
        <div class="student-main">${mainHtml}</div>
        <div class="student-actions">${actions}</div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <h2>Nuevo estudiante</h2>
        <div class="form-row">
          <div class="form-field"><label>Nombre</label><input type="text" id="new-student-name" placeholder="Nombre y apellido"></div>
          <div class="form-field"><label>Día fijo</label><select id="new-student-day">${dayOptions}</select></div>
          <div class="form-field"><label>Grupo de cocina</label><select id="new-student-kitchen"><option value="k1">Cocina</option><option value="k2">Cocina 2</option></select></div>
          <button class="btn" data-action="add-student">Agregar</button>
        </div>
      </div>
      <div class="card">
        <h2>Estudiantes (orden alfabético)</h2>
        <div class="student-list">${rows || '<p class="empty-state">No hay estudiantes cargados.</p>'}</div>
      </div>
    `;
  }

  function handleAddStudent() {
    const nameInput = document.getElementById('new-student-name');
    const daySelect = document.getElementById('new-student-day');
    const kitchenSelect = document.getElementById('new-student-kitchen');
    const name = nameInput.value.trim();
    if (!name) { showToast('Ingresá un nombre.'); return; }
    const id = uniqueId(slugify(name));
    state.students.push({
      id,
      name,
      fixedDay: Number(daySelect.value),
      kitchenGroup: kitchenSelect.value,
      active: true,
    });
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast(`${name} agregado/a.`);
  }

  function handleRenameStart(id) { editingStudentId = id; renderEstudiantes(); }
  function handleRenameCancel() { editingStudentId = null; renderEstudiantes(); }
  function handleRenameSave(id) {
    const nameInput = document.getElementById('edit-name-input');
    const dayInput = document.getElementById('edit-day-input');
    const kitchenInput = document.getElementById('edit-kitchen-input');
    const name = nameInput.value.trim();
    if (!name) { showToast('El nombre no puede quedar vacío.'); return; }
    const student = state.students.find((s) => s.id === id);
    if (student) {
      student.name = name;
      student.fixedDay = Number(dayInput.value);
      student.kitchenGroup = kitchenInput.value;
    }
    editingStudentId = null;
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast('Estudiante actualizado.');
  }
  function handleToggleActive(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    student.active = !student.active;
    saveState();
    renderEstudiantes();
    renderGenerar();
  }
  function handleDeleteStudent(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    if (!confirm(`¿Eliminar definitivamente a ${student.name}? Su historial en semanas ya bloqueadas se conserva, pero dejará de aparecer en el calendario.`)) return;
    state.students = state.students.filter((s) => s.id !== id);
    if (editingStudentId === id) editingStudentId = null;
    saveState();
    renderEstudiantes();
    renderGenerar();
  }

  // -----------------------------------------------------------------
  // Tab: Semanas guardadas
  // -----------------------------------------------------------------
  function renderSemanas() {
    const el = document.getElementById('tab-semanas');
    const sortedAssignments = Core.allAssignmentsSorted(state.lockedWeeks);

    const nameById = {};
    state.lockedWeeks.forEach((w) => w.days.forEach((d) => d.assignments.forEach((a) => { nameById[a.studentId] = a.name; })));
    state.students.forEach((s) => { nameById[s.id] = s.name; });
    const ids = Object.keys(nameById).sort((a, b) => nameById[a].localeCompare(nameById[b], 'es'));

    let equityHtml = '';
    if (ids.length) {
      const equityRows = ids.map((id) => {
        const counts = Core.countsForStudent(sortedAssignments, id);
        const total = Core.totalPointsForStudent(sortedAssignments, id);
        const cells = Core.AREAS.map((ar) => `<td>${counts[ar.id]}</td>`).join('');
        return `<tr><td>${escapeHtml(nameById[id])}</td>${cells}<td><strong>${total}</strong></td></tr>`;
      }).join('');
      equityHtml = `
        <div class="card equity-summary">
          <h2>Equidad acumulada</h2>
          <p class="muted">Veces por área y puntaje total, acumulado desde el inicio del uso de la herramienta. Nunca se reinicia entre meses.</p>
          <div class="table-wrap"><table>
            <tr><th>Estudiante</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}<th>Puntos</th></tr>
            ${equityRows}
          </table></div>
        </div>
      `;
    }

    if (!state.lockedWeeks.length) {
      el.innerHTML = `${equityHtml}<div class="empty-state">Todavía no hay semanas bloqueadas.</div>`;
      return;
    }

    const weeksDesc = [...state.lockedWeeks].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));
    const weekCards = weeksDesc.map((w) => {
      const label = `Semana ${w.weekIndex} de ${Core.MONTH_NAMES_ES[w.month - 1]} ${w.year}`;
      const dates = `${Core.formatDateEs(Core.fromISO(w.startDate))} – ${Core.formatDateEs(Core.fromISO(w.endDate))}`;
      if (editingWeekStart === w.startDate) {
        const historyExcludingThis = state.lockedWeeks.filter((x) => x.startDate !== w.startDate);
        const audit = Core.auditWeek(state.students, historyExcludingThis, editingWeekDraft);
        return `<div class="week-card card">
          <div class="week-card-head"><h3>Editando: ${escapeHtml(label)}</h3><span class="muted">${dates}</span></div>
          <div class="alert warning">Estás editando una semana ya bloqueada — es una excepción manual explícita. Se guarda apenas confirmes.</div>
          <div class="audit-list">${renderAudit(audit)}</div>
          ${renderEditableDays(editingWeekDraft, studentsById)}
          <div class="btn-row">
            <button class="btn" data-action="save-edit-week">Guardar cambios</button>
            <button class="btn secondary" data-action="cancel-edit-week">Cancelar</button>
          </div>
        </div>`;
      }
      return `<div class="week-card card">
        <div class="week-card-head">
          <h3>${escapeHtml(label)}</h3>
          <span class="muted">${dates}</span>
          <button class="btn small secondary" data-action="edit-week" data-start="${w.startDate}">Editar</button>
          <button class="btn small secondary" data-action="print-week" data-start="${w.startDate}">PDF</button>
        </div>
        ${renderWeekGridTable(w)}
      </div>`;
    }).join('');

    el.innerHTML = equityHtml + weekCards;
  }

  function handleEditWeekStart(startDate) {
    const week = state.lockedWeeks.find((w) => w.startDate === startDate);
    if (!week) return;
    if (!confirm('Vas a editar una semana ya bloqueada. Es una excepción manual explícita: los cambios se guardan de inmediato y afectan la equidad acumulada y las próximas semanas que generes a partir de ahora. ¿Continuar?')) return;
    editingWeekStart = startDate;
    editingWeekDraft = JSON.parse(JSON.stringify(week));
    renderSemanas();
  }
  function handleEditWeekCancel() {
    editingWeekStart = null;
    editingWeekDraft = null;
    renderSemanas();
  }
  function handleEditWeekSetArea(date, studentId, area) {
    const day = editingWeekDraft.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === studentId);
    if (a) a.area = area;
    renderSemanas();
  }
  function handleEditWeekSave() {
    const idx = state.lockedWeeks.findIndex((w) => w.startDate === editingWeekStart);
    if (idx === -1) return;
    state.lockedWeeks[idx] = editingWeekDraft;
    editingWeekStart = null;
    editingWeekDraft = null;
    saveState();
    renderAll();
    showToast('Semana bloqueada actualizada.');
  }

  // -----------------------------------------------------------------
  // Exportar a PDF (impresión del navegador, sin dependencias): arma una
  // vista limpia en #print-area y dispara window.print(); el usuario elige
  // "Guardar como PDF" en el diálogo de impresión.
  // -----------------------------------------------------------------
  function renderPrintableWeek(w) {
    const label = `Semana ${w.weekIndex} de ${Core.MONTH_NAMES_ES[w.month - 1]} ${w.year}`;
    const dates = `${Core.formatDateEs(Core.fromISO(w.startDate))} – ${Core.formatDateEs(Core.fromISO(w.endDate))}`;
    return `
      <h1>Hogar Colonia — Calendario de limpieza</h1>
      <h2>${escapeHtml(label)} (${dates})</h2>
      ${renderWeekGridTable(w)}
      <p class="print-footer">Generado ${new Date().toLocaleDateString('es-AR')}</p>
    `;
  }

  function handlePrintWeek(startDate) {
    const week = state.lockedWeeks.find((w) => w.startDate === startDate);
    if (!week) return;
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = renderPrintableWeek(week);
    window.print();
  }

  // -----------------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------------
  function renderAll() {
    renderGenerar();
    renderEstudiantes();
    renderSemanas();
  }

  function initTabs() {
    document.getElementById('tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  }

  function initGenerarEvents() {
    const el = document.getElementById('tab-generar');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'propose') handleProposeClick();
      else if (action === 'regenerate') handleRegenerateClick();
      else if (action === 'discard') handleDiscardClick();
      else if (action === 'approve') handleApproveClick();
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'start-month-input') handleStartMonthChange(e.target);
      else if (e.target.matches('select[data-action="set-area"]')) handleSetArea(e.target);
    });
  }

  function initEstudiantesEvents() {
    const el = document.getElementById('tab-estudiantes');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'add-student') handleAddStudent();
      else if (action === 'rename') handleRenameStart(id);
      else if (action === 'save-rename') handleRenameSave(id);
      else if (action === 'cancel-rename') handleRenameCancel();
      else if (action === 'toggle-active') handleToggleActive(id);
      else if (action === 'delete') handleDeleteStudent(id);
    });
  }

  function initSemanasEvents() {
    const el = document.getElementById('tab-semanas');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'print-week') handlePrintWeek(btn.dataset.start);
      else if (action === 'edit-week') handleEditWeekStart(btn.dataset.start);
      else if (action === 'save-edit-week') handleEditWeekSave();
      else if (action === 'cancel-edit-week') handleEditWeekCancel();
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('select[data-action="set-area"]')) {
        handleEditWeekSetArea(e.target.dataset.date, e.target.dataset.student, e.target.value);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initGenerarEvents();
    initEstudiantesEvents();
    initSemanasEvents();
    await initState();
    renderAll();
  });
})();
