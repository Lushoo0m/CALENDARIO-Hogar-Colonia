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
  let expandedStudentId = null;
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

  // Misma grilla Día × Área que renderWeekGridTable, pero cada celda ocupada
  // trae un <select> para cambiar el área de ese estudiante ahí mismo — sin
  // una lista aparte de dropdowns arriba. Cambiar el valor mueve la celda a
  // la columna nueva al re-renderizar (edición "en tiempo real").
  // `target` distingue a qué handler debe ir el cambio cuando puede haber
  // DOS grillas editables a la vez en pantalla (la propuesta actual y la
  // semana anterior en edición): 'proposal' → handleSetArea, 'draft' →
  // handleEditWeekSetArea.
  function renderEditableWeekGridTable(proposal, studentsById, target) {
    const header = `<tr><th>Día</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}</tr>`;
    const rows = proposal.days.map((day) => {
      const byArea = {};
      day.assignments.forEach((a) => { byArea[a.area] = a; });
      const dateObj = Core.fromISO(day.date);
      const cells = Core.AREAS.map((ar) => {
        const a = byArea[ar.id];
        if (!a) return '<td><span class="muted">—</span></td>';
        const student = studentsById[a.studentId];
        const elig = student ? Core.eligibleAreas(student) : Core.AREAS;
        const options = elig.map((opt) => `<option value="${opt.id}" ${opt.id === a.area ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('');
        return `<td class="cell-edit">
          <div class="cell-student">${escapeHtml(a.name)}</div>
          <select class="cell-area-select" data-action="set-area" data-target="${target}" data-date="${day.date}" data-student="${a.studentId}">${options}</select>
        </td>`;
      }).join('');
      return `<tr class="dow-${day.dow}"><td><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table>${header}${rows}</table></div>`;
  }

  // -----------------------------------------------------------------
  // Tab: Generar
  // -----------------------------------------------------------------
  function renderGenerar() {
    const el = document.getElementById('tab-generar');
    if (state.pendingProposal) {
      const proposal = state.pendingProposal;
      const audit = Core.auditWeek(state.students, historyForAudit(), proposal);
      const label = `Semana ${proposal.weekIndex} de ${Core.MONTH_NAMES_ES[proposal.month - 1]} ${proposal.year} (${Core.formatDateEs(Core.fromISO(proposal.startDate))} – ${Core.formatDateEs(Core.fromISO(proposal.endDate))})`;
      const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));
      const previousWeek = [...state.lockedWeeks].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
      const previousLabel = previousWeek ? `Semana ${previousWeek.weekIndex} de ${Core.MONTH_NAMES_ES[previousWeek.month - 1]} ${previousWeek.year} (${Core.formatDateEs(Core.fromISO(previousWeek.startDate))} – ${Core.formatDateEs(Core.fromISO(previousWeek.endDate))})` : '';
      const editingPrevious = previousWeek && editingWeekStart === previousWeek.startDate;

      let previousBlock = '';
      if (previousWeek) {
        const toggle = `
          <label class="switch" title="${editingPrevious ? 'Tocá para volver a bloquear' : 'Tocá para editar'}">
            <input type="checkbox" data-action="toggle-previous-lock" data-start="${previousWeek.startDate}" ${editingPrevious ? 'checked' : ''}>
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">${editingPrevious ? 'Editando' : 'Bloqueada'}</span>
          </label>`;
        if (editingPrevious) {
          const ownHistory = state.lockedWeeks.filter((w) => w.startDate !== previousWeek.startDate);
          const ownAudit = Core.auditWeek(state.students, ownHistory, editingWeekDraft);
          previousBlock = `
            <div class="card">
              <div class="week-card-head"><h3>Semana anterior <span class="muted">— editando en simultáneo</span></h3>${toggle}</div>
              <p class="muted">${escapeHtml(previousLabel)}</p>
              <div class="alert warning">Estás editando la semana anterior mientras revisás la propuesta actual. Los cambios se guardan al volver a bloquear (switch), y ahí la propuesta de arriba se recalcula sola con el historial ya corregido.</div>
              <div class="audit-list">${renderAudit(ownAudit)}</div>
              ${renderEditableWeekGridTable(editingWeekDraft, studentsById, 'draft')}
              <div class="btn-row">
                <button class="btn" data-action="confirm-previous-week">Confirmar y bloquear de nuevo</button>
                <button class="btn secondary" data-action="cancel-edit-week">Cancelar sin guardar</button>
              </div>
            </div>`;
        } else {
          previousBlock = `
            <div class="card">
              <div class="week-card-head">
                <h3>Semana anterior <span class="muted">(referencia — confirmá que nadie repite área)</span></h3>
                ${toggle}
                <button class="btn small danger" data-action="delete-previous-week" data-start="${previousWeek.startDate}">Eliminar esta semana</button>
              </div>
              <p class="muted">${escapeHtml(previousLabel)}</p>
              ${renderWeekGridTable(previousWeek)}
            </div>`;
        }
      }

      el.innerHTML = `
        <div class="card">
          <h2>Propuesta: ${escapeHtml(label)}</h2>
          <p class="muted">Editá el área de cada estudiante directo en la grilla. La IA nunca aplica esto por su cuenta: queda a la espera de que lo apruebes.</p>
          <div class="audit-list">${renderAudit(audit)}</div>
        </div>
        <div class="card">
          <h3>Vista previa (editable)</h3>
          ${renderEditableWeekGridTable(proposal, studentsById, 'proposal')}
          <div class="btn-row">
            <button class="btn secondary" data-action="regenerate">Regenerar propuesta automática</button>
            <button class="btn" data-action="approve">Aprobar y bloquear semana</button>
            <button class="btn danger" data-action="discard">Descartar propuesta</button>
          </div>
        </div>
        ${previousBlock}
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
  const TIER_LABELS = { high: 'Carga alta', mid: 'Carga media', low: 'Carga baja' };
  function kitchenGroupLabel(s) { return s.kitchenGroup === 'k2' ? 'COCINA II' : 'COCINA'; }
  function sexSymbol(sex) { return sex === 'M' ? '♂' : sex === 'F' ? '♀' : ''; }

  function renderEstudiantes() {
    const el = document.getElementById('tab-estudiantes');
    const sortedAssignments = Core.allAssignmentsSorted(state.lockedWeeks);
    const activeStudents = state.students.filter((s) => s.active);
    const tierOf = Core.computeDisplayTiers(activeStudents, sortedAssignments);
    // Orden puro por carga (descendente) — sin desempate alfabético ni por
    // grupo de cocina. Array.sort es estable, así que los empates en puntos
    // simplemente mantienen el orden que ya tenían, no uno alfabético.
    const sortedStudents = [...state.students].sort((a, b) => {
      const pb = Core.totalPointsForStudent(sortedAssignments, b.id);
      const pa = Core.totalPointsForStudent(sortedAssignments, a.id);
      return pb - pa;
    });
    const maxPoints = Math.max(1, ...state.students.map((s) => Core.totalPointsForStudent(sortedAssignments, s.id)));

    const dayOptions = Core.DOW_NAMES_ES.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('');

    const rows = sortedStudents.map((s) => {
      const points = Core.totalPointsForStudent(sortedAssignments, s.id);
      const editing = editingStudentId === s.id;
      const expanded = expandedStudentId === s.id;
      const tier = tierOf[s.id];
      const tierBadge = !s.active
        ? '<span class="tier-badge inactive">Inactivo</span>'
        : tier ? `<span class="tier-badge tier-${tier}">${TIER_LABELS[tier]}</span>` : '';

      if (editing) {
        const mainHtml = `
          <div class="form-row">
            <div class="form-field"><label>Nombre corto (calendario)</label><input type="text" id="edit-name-input" value="${escapeHtml(s.name)}"></div>
            <div class="form-field"><label>Nombre completo</label><input type="text" id="edit-fullname-input" value="${escapeHtml(s.fullName || s.name)}"></div>
          </div>
          <div class="form-row" style="margin-top:8px;">
            <div class="form-field"><label>Sexo</label><select id="edit-sex-input"><option value="M" ${s.sex === 'M' ? 'selected' : ''}>Varón</option><option value="F" ${s.sex === 'F' ? 'selected' : ''}>Mujer</option></select></div>
            <div class="form-field"><label>Día fijo</label><select id="edit-day-input">${Core.DOW_NAMES_ES.map((d, i) => `<option value="${i + 1}" ${i + 1 === s.fixedDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
            <div class="form-field"><label>Grupo de cocina</label><select id="edit-kitchen-input"><option value="k1" ${s.kitchenGroup === 'k1' ? 'selected' : ''}>Cocina</option><option value="k2" ${s.kitchenGroup === 'k2' ? 'selected' : ''}>Cocina II</option></select></div>
          </div>
        `;
        const actions = `
          <button class="btn small" data-action="save-rename" data-id="${s.id}">Guardar</button>
          <button class="btn small secondary" data-action="cancel-rename" data-id="${s.id}">Cancelar</button>
        `;
        return `<div class="student-row ${s.active ? '' : 'inactive'}" data-id="${s.id}">
          <div class="student-main">${mainHtml}</div>
          <div class="student-actions">${actions}</div>
        </div>`;
      }

      const detailHtml = expanded ? `
          <div class="student-detail">
            <div class="detail-fullname">${escapeHtml(s.fullName || s.name)} <span class="sex-symbol">${sexSymbol(s.sex)}</span></div>
            <div class="detail-tags">
              <span class="day-pill dow-${s.fixedDay}">${Core.DOW_NAMES_ES[s.fixedDay - 1]}</span>
              <span class="kitchen-tag">${kitchenGroupLabel(s)}</span>
              <span class="points-badge tier-${tier || 'low'}">${points} pts</span>
            </div>
          </div>
        ` : '';
      const actions = `
          <button class="btn small secondary" data-action="rename" data-id="${s.id}">Editar</button>
          <button class="btn small danger" data-action="delete" data-id="${s.id}">Quitar beca</button>
        `;
      return `<div class="student-row ${s.active ? '' : 'inactive'}" data-id="${s.id}">
        <div class="student-main">
          <button class="student-name-toggle" data-action="toggle-detail" data-id="${s.id}">
            <span class="student-name">${escapeHtml(s.name)}</span>${tierBadge}
          </button>
          ${detailHtml}
        </div>
        <div class="student-actions">${actions}</div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <h2>Nuevo estudiante</h2>
        <div class="form-row">
          <div class="form-field"><label>Nombre corto (calendario)</label><input type="text" id="new-student-name" placeholder="Ej. Lorenzo C."></div>
          <div class="form-field"><label>Nombre completo</label><input type="text" id="new-student-fullname" placeholder="Nombre y apellido"></div>
          <div class="form-field"><label>Sexo</label><select id="new-student-sex"><option value="M">Varón</option><option value="F">Mujer</option></select></div>
          <div class="form-field"><label>Día fijo</label><select id="new-student-day">${dayOptions}</select></div>
          <div class="form-field"><label>Grupo de cocina</label><select id="new-student-kitchen"><option value="k1">Cocina</option><option value="k2">Cocina II</option></select></div>
          <button class="btn" data-action="add-student">Agregar</button>
        </div>
      </div>
      <div class="card">
        <h2>Estudiantes (mayor carga primero)</h2>
        <p class="muted">Tocá un nombre para ver el detalle completo (nombre completo, sexo, día, grupo, puntos).</p>
        <div class="student-list">${rows || '<p class="empty-state">No hay estudiantes cargados.</p>'}</div>
      </div>
    `;
  }

  function handleAddStudent() {
    const nameInput = document.getElementById('new-student-name');
    const fullNameInput = document.getElementById('new-student-fullname');
    const sexSelect = document.getElementById('new-student-sex');
    const daySelect = document.getElementById('new-student-day');
    const kitchenSelect = document.getElementById('new-student-kitchen');
    const name = nameInput.value.trim();
    if (!name) { showToast('Ingresá un nombre.'); return; }
    const id = uniqueId(slugify(name));
    state.students.push({
      id,
      name,
      fullName: fullNameInput.value.trim() || name,
      sex: sexSelect.value,
      fixedDay: Number(daySelect.value),
      kitchenGroup: kitchenSelect.value,
      active: true,
    });
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast(`${name} agregado/a.`);
  }

  function handleToggleDetail(id) { expandedStudentId = expandedStudentId === id ? null : id; renderEstudiantes(); }
  function handleRenameStart(id) { editingStudentId = id; renderEstudiantes(); }
  function handleRenameCancel() { editingStudentId = null; renderEstudiantes(); }
  function handleRenameSave(id) {
    const nameInput = document.getElementById('edit-name-input');
    const fullNameInput = document.getElementById('edit-fullname-input');
    const sexInput = document.getElementById('edit-sex-input');
    const dayInput = document.getElementById('edit-day-input');
    const kitchenInput = document.getElementById('edit-kitchen-input');
    const name = nameInput.value.trim();
    if (!name) { showToast('El nombre no puede quedar vacío.'); return; }
    const student = state.students.find((s) => s.id === id);
    if (student) {
      student.name = name;
      student.fullName = fullNameInput.value.trim() || name;
      student.sex = sexInput.value;
      student.fixedDay = Number(dayInput.value);
      student.kitchenGroup = kitchenInput.value;
    }
    editingStudentId = null;
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast('Estudiante actualizado.');
  }
  function handleDeleteStudent(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    if (!confirm(`¿Quitar la beca a ${student.name}? Esta acción no se puede deshacer. Su historial en semanas ya bloqueadas se conserva, pero dejará de aparecer en el calendario.`)) return;
    state.students = state.students.filter((s) => s.id !== id);
    if (editingStudentId === id) editingStudentId = null;
    saveState();
    renderEstudiantes();
    renderGenerar();
  }

  // -----------------------------------------------------------------
  // Tab: Calendarios anteriores
  // -----------------------------------------------------------------
  // Un mes se considera "completo" cuando llega hasta su última semana sin
  // huecos entre medio — permite un arranque truncado (p.ej. un mes cuyo
  // historial importado empieza recién en la semana 2) pero exige que no
  // falte nada desde ahí hasta el final del mes.
  function isMonthComplete(lockedWeeks, year, month) {
    const weeks = Core.monthWeeks(year, month);
    const lockedStarts = new Set(lockedWeeks.filter((w) => w.year === year && w.month === month).map((w) => w.startDate));
    if (!lockedStarts.size) return false;
    if (!lockedStarts.has(Core.toISO(weeks[weeks.length - 1].start))) return false;
    const firstLockedIdx = weeks.findIndex((w) => lockedStarts.has(Core.toISO(w.start)));
    return weeks.slice(firstLockedIdx).every((w) => lockedStarts.has(Core.toISO(w.start)));
  }

  function weeksOfMonthKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return state.lockedWeeks.filter((w) => w.year === y && w.month === m).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  }

  function renderSemanas() {
    const el = document.getElementById('tab-semanas');
    const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));

    if (!state.lockedWeeks.length) {
      el.innerHTML = '<div class="empty-state">Todavía no hay calendarios anteriores.</div>';
      return;
    }

    const monthKeys = [...new Set(state.lockedWeeks.map((w) => `${w.year}-${Core.pad2(w.month)}`))];
    const completeMonths = monthKeys
      .filter((key) => { const [y, m] = key.split('-').map(Number); return isMonthComplete(state.lockedWeeks, y, m); })
      .sort().reverse();

    if (!completeMonths.length) {
      el.innerHTML = '<div class="empty-state">Todavía no hay ningún mes completo — los calendarios en curso se ven en la pestaña Generar. Un mes aparece acá recién cuando está bloqueado hasta el último día.</div>';
      return;
    }

    const monthCards = completeMonths.map((key) => {
      const [, m] = key.split('-').map(Number);
      const weeksOfMonth = weeksOfMonthKey(key);
      const y = weeksOfMonth[0].year;
      const label = `${Core.MONTH_NAMES_ES[m - 1]} ${y}`;

      const editingWeek = weeksOfMonth.find((w) => w.startDate === editingWeekStart);
      if (editingWeek) {
        const historyExcludingThis = state.lockedWeeks.filter((x) => x.startDate !== editingWeek.startDate);
        const audit = Core.auditWeek(state.students, historyExcludingThis, editingWeekDraft);
        const weekLabel = `Semana ${editingWeek.weekIndex}`;
        return `<div class="week-card card">
          <div class="week-card-head"><h3>${escapeHtml(label)} — editando ${escapeHtml(weekLabel)}</h3></div>
          <div class="alert warning">Estás editando una semana ya bloqueada — es una excepción manual explícita. Se guarda apenas confirmes.</div>
          <div class="audit-list">${renderAudit(audit)}</div>
          ${renderEditableWeekGridTable(editingWeekDraft, studentsById, 'draft')}
          <div class="btn-row">
            <button class="btn" data-action="save-edit-week">Guardar cambios</button>
            <button class="btn secondary" data-action="cancel-edit-week">Cancelar</button>
          </div>
        </div>`;
      }

      const mergedDays = weeksOfMonth.flatMap((w) => w.days);
      const dateRange = `${Core.formatDateEs(Core.fromISO(weeksOfMonth[0].startDate))} – ${Core.formatDateEs(Core.fromISO(weeksOfMonth[weeksOfMonth.length - 1].endDate))}`;
      const weekControls = weeksOfMonth.map((w) => `
        <span class="week-mini">
          Semana ${w.weekIndex}
          <button class="btn small secondary" data-action="edit-week" data-start="${w.startDate}">Editar</button>
          <button class="btn small danger" data-action="unlock-week" data-start="${w.startDate}">Desbloquear</button>
        </span>
      `).join('');

      return `<div class="week-card card">
        <div class="week-card-head">
          <h3>${escapeHtml(label)}</h3>
          <span class="muted">${dateRange}</span>
          <button class="btn small secondary" data-action="print-month" data-month-key="${key}">PDF del mes</button>
        </div>
        ${renderWeekGridTable({ days: mergedDays })}
        <div class="week-mini-list">${weekControls}</div>
      </div>`;
    }).join('');

    el.innerHTML = monthCards;
  }

  function handleUnlockWeek(startDate) {
    const week = state.lockedWeeks.find((w) => w.startDate === startDate);
    if (!week) return;
    const latest = [...state.lockedWeeks].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
    const message = latest.startDate === startDate
      ? '¿Desbloquear esta semana? Vuelve a quedar pendiente en la pestaña Generar y la podés proponer de nuevo.'
      : '¿Desbloquear esta semana? OJO: no es la última semana bloqueada — las semanas posteriores ya aprobadas no se recalculan solas y van a seguir basadas en el historial que tenían. Revisalas manualmente si hace falta.';
    if (!confirm(message)) return;
    state.lockedWeeks = state.lockedWeeks.filter((w) => w.startDate !== startDate);
    if (editingWeekStart === startDate) { editingWeekStart = null; editingWeekDraft = null; }
    saveState();
    renderAll();
    showToast('Semana desbloqueada.');
  }

  // El switch de "semana anterior" en Generar y el botón "Editar" en
  // Calendarios anteriores comparten este mismo mecanismo de borrador
  // (editingWeekStart/editingWeekDraft), así que cualquiera de los dos deja
  // a la otra pestaña consistente — por eso todos re-renderizan con renderAll().
  function historyForAudit() {
    if (!editingWeekStart) return state.lockedWeeks;
    return state.lockedWeeks.map((w) => (w.startDate === editingWeekStart ? editingWeekDraft : w));
  }
  function handleEditWeekStart(startDate) {
    const week = state.lockedWeeks.find((w) => w.startDate === startDate);
    if (!week) return;
    editingWeekStart = startDate;
    editingWeekDraft = JSON.parse(JSON.stringify(week));
    renderAll();
  }
  function handleEditWeekCancel() {
    editingWeekStart = null;
    editingWeekDraft = null;
    renderAll();
  }
  function handleEditWeekSetArea(date, studentId, area) {
    const day = editingWeekDraft.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === studentId);
    if (a) a.area = area;
    renderAll();
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
  // Variante para el switch de "semana anterior" en Generar: además de
  // guardar, recalcula y vuelve a proponer la semana actual desde cero con
  // el historial ya actualizado — para que la propuesta activa no quede
  // basada en una versión vieja de la semana que se acaba de corregir.
  function handleConfirmPreviousWeekEdit() {
    const idx = state.lockedWeeks.findIndex((w) => w.startDate === editingWeekStart);
    if (idx === -1) return;
    state.lockedWeeks[idx] = editingWeekDraft;
    editingWeekStart = null;
    editingWeekDraft = null;
    if (state.pendingProposal) {
      const p = state.pendingProposal;
      const weekInfo = {
        index: p.weekIndex, year: p.year, month: p.month,
        start: Core.fromISO(p.startDate), end: Core.fromISO(p.endDate),
        days: p.days.map((d) => Core.fromISO(d.date)),
      };
      state.pendingProposal = Core.generateWeekProposal(state.students, state.lockedWeeks, weekInfo);
    }
    saveState();
    renderAll();
    showToast('Semana anterior confirmada. La propuesta actual se recalculó con el historial nuevo.');
  }

  // -----------------------------------------------------------------
  // Exportar a PDF (impresión del navegador, sin dependencias): arma una
  // vista limpia en #print-area y dispara window.print(); el usuario elige
  // "Guardar como PDF" en el diálogo de impresión.
  // -----------------------------------------------------------------
  function handlePrintMonth(monthKey) {
    const weeksOfMonth = weeksOfMonthKey(monthKey);
    if (!weeksOfMonth.length) return;
    const [, m] = monthKey.split('-').map(Number);
    const label = `${Core.MONTH_NAMES_ES[m - 1]} ${weeksOfMonth[0].year}`;
    const mergedDays = weeksOfMonth.flatMap((w) => w.days);
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `
      <h1>Hogar Colonia — Calendario de limpieza</h1>
      <h2>${escapeHtml(label)}</h2>
      ${renderWeekGridTable({ days: mergedDays })}
      <p class="print-footer">Generado ${new Date().toLocaleDateString('es-AR')}</p>
    `;
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
      else if (action === 'confirm-previous-week') handleConfirmPreviousWeekEdit();
      else if (action === 'cancel-edit-week') handleEditWeekCancel();
      else if (action === 'delete-previous-week') handleUnlockWeek(btn.dataset.start);
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'start-month-input') handleStartMonthChange(e.target);
      else if (e.target.matches('input[data-action="toggle-previous-lock"]')) {
        if (e.target.checked) handleEditWeekStart(e.target.dataset.start);
        else handleConfirmPreviousWeekEdit();
      } else if (e.target.matches('select[data-action="set-area"]')) {
        if (e.target.dataset.target === 'draft') handleEditWeekSetArea(e.target.dataset.date, e.target.dataset.student, e.target.value);
        else handleSetArea(e.target);
      }
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
      else if (action === 'toggle-detail') handleToggleDetail(id);
      else if (action === 'rename') handleRenameStart(id);
      else if (action === 'save-rename') handleRenameSave(id);
      else if (action === 'cancel-rename') handleRenameCancel();
      else if (action === 'delete') handleDeleteStudent(id);
    });
  }

  function initSemanasEvents() {
    const el = document.getElementById('tab-semanas');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'print-month') handlePrintMonth(btn.dataset.monthKey);
      else if (action === 'edit-week') handleEditWeekStart(btn.dataset.start);
      else if (action === 'unlock-week') handleUnlockWeek(btn.dataset.start);
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
