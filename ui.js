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
  let expandedMonthKey = null;
  let editingMonthKey = null;
  let editingMonthDraft = null;
  // Celdas de conflicto (2+ estudiantes en la misma área el mismo día, por
  // error) que el supervisor tocó para desplegar y corregir una por una.
  // Solo estado de UI, se resetea al recargar — no forma parte del dato.
  const expandedConflictCells = new Set();

  function defaultState() {
    return {
      students: JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS)),
      lockedWeeks: [],
      pendingProposal: null,
      settings: {},
      closedMonths: [],
    };
  }

  function normalizeState(parsed) {
    return {
      students: Array.isArray(parsed.students) ? parsed.students : defaultState().students,
      lockedWeeks: Array.isArray(parsed.lockedWeeks) ? parsed.lockedWeeks : [],
      pendingProposal: parsed.pendingProposal || null,
      settings: parsed.settings || {},
      closedMonths: Array.isArray(parsed.closedMonths) ? parsed.closedMonths : [],
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

  // Estrella de "exoneración": ícono vacío (contorno) por defecto, dorado
  // con resplandor cuando está marcada. Solo se puede marcar editando una
  // semana ya bloqueada o corrigiendo un mes cerrado — nunca en la
  // propuesta nueva, porque es una decisión posterior del supervisor, no
  // parte de la generación automática. Una vez marcada, ese estudiante
  // directamente no aparece en las vistas de solo lectura (Calendarios
  // anteriores, PDF, imagen para compartir): queda exonerado a la vista
  // de los chicos, aunque el registro interno sigue existiendo.
  const STAR_PATH = 'M12 2.6l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.7l-5.9 3.1 1.13-6.58L2.45 9.54l6.6-.96L12 2.6z';
  function starIconHtml(filled) {
    if (filled) {
      return `<svg class="star-icon star-filled" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="${STAR_PATH}" fill="#ffd23f" stroke="#ffd23f" stroke-width="1"/></svg>`;
    }
    return `<svg class="star-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="${STAR_PATH}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }

  // Nombre corto para celdas en conflicto (2+ estudiantes en la misma
  // área el mismo día, por error): "Joaquín" -> "Joaq...".
  function abbreviateName(name) {
    const trimmed = String(name).trim();
    return trimmed.length <= 4 ? trimmed : `${trimmed.slice(0, 4)}...`;
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
  function weekGridHeaderHtml(firstColLabel) {
    return `<tr><th>${escapeHtml(firstColLabel || 'Día')}</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}</tr>`;
  }

  function weekDayRowsHtml(days) {
    return days.map((day) => {
      const cellByArea = {};
      day.assignments.forEach((a) => {
        if (a.starred) return; // exonerado: no aparece en las vistas de solo lectura
        const nameHtml = escapeHtml(a.name);
        const existing = cellByArea[a.area];
        cellByArea[a.area] = existing ? `${existing}, ${nameHtml}` : nameHtml;
      });
      const dateObj = Core.fromISO(day.date);
      const cells = Core.AREAS.map((ar) => `<td>${cellByArea[ar.id] || '<span class="muted">—</span>'}</td>`).join('');
      return `<tr class="dow-${day.dow}"><td><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</td>${cells}</tr>`;
    }).join('');
  }

  function renderWeekGridTable(weekLike) {
    const header = weekGridHeaderHtml();
    const rows = weekDayRowsHtml(weekLike.days);
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
  }

  // Vista de un mes completo: varias semanas (Core.monthWeeks) una debajo de
  // otra, separadas por una fila fina "Semana N" — cada semana va del
  // primer día del mes (o lunes) hasta el domingo (o el último día del
  // mes), tal cual corta el propio calendario. Usada en Calendarios
  // anteriores y en el PDF; la imagen descargable dibuja lo mismo a mano.
  function renderMonthGridTable(weeksOfMonth) {
    const [firstWeek, ...restWeeks] = weeksOfMonth;
    if (!firstWeek) return '<div class="table-wrap"><table></table></div>';
    // La primera semana no lleva su propio divisor "Semana N" — quedaría
    // pegado justo debajo del encabezado, duplicando la fila de áreas. En
    // su lugar, la celda "Día" del encabezado se reemplaza directamente
    // por "Semana N" (el índice de la primera semana presente del mes,
    // que no siempre es 1 — ej. un mes con historial incompleto al inicio).
    const header = weekGridHeaderHtml(`Semana ${firstWeek.weekIndex}`);
    const body = weekDayRowsHtml(firstWeek.days) + restWeeks.map((week) => {
      const areaCells = Core.AREAS.map((a) => `<td>${escapeHtml(a.label)}</td>`).join('');
      const divider = `<tr class="week-divider-row"><td>Semana ${week.weekIndex}</td>${areaCells}</tr>`;
      return divider + weekDayRowsHtml(week.days);
    }).join('');
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  }

  // Celda editable de Día × Área, compartida entre la propuesta semanal, la
  // edición de una semana bloqueada y la corrección de un mes. Normalmente
  // hay un solo estudiante por celda (nombre + selector de área). Si por
  // error hay 2+ en la misma área el mismo día, se ven abreviados y
  // agrupados ("Joaq..., Flor...") hasta que se toca la celda: ahí se
  // despliegan uno por uno, cada uno con su propio selector para corregirlo.
  // `opts`: { starAction, selectAction, allowStar, extraAttrs(a), cellKeyPrefix }
  function renderAssignmentCell(assignments, day, ar, studentsById, opts) {
    if (!assignments.length) return '<td><span class="muted">—</span></td>';

    const starHtml = (a) => (opts.allowStar
      ? `<button type="button" class="star-toggle ${a.starred ? 'starred' : ''}" data-action="${opts.starAction}" ${opts.extraAttrs(a)} data-date="${day.date}" data-student="${a.studentId}" title="${a.starred ? 'Quitar estrella (exoneración)' : 'Dar estrella (exoneración de limpieza)'}">${starIconHtml(a.starred)}</button>`
      : '');
    const selectHtml = (a) => {
      const student = studentsById[a.studentId];
      const elig = student ? Core.eligibleAreas(student) : Core.AREAS;
      const options = elig.map((opt) => `<option value="${opt.id}" ${opt.id === a.area ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('');
      return `<select class="cell-area-select" data-action="${opts.selectAction}" ${opts.extraAttrs(a)} data-date="${day.date}" data-student="${a.studentId}">${options}</select>`;
    };

    if (assignments.length === 1) {
      const a = assignments[0];
      return `<td class="cell-edit">
        <div class="cell-student">${starHtml(a)}${escapeHtml(a.name)}</div>
        ${selectHtml(a)}
      </td>`;
    }

    // Conflicto: 2+ estudiantes en la misma área el mismo día.
    const key = `${opts.cellKeyPrefix}|${day.date}|${ar.id}`;
    if (!expandedConflictCells.has(key)) {
      const abbrList = assignments.map((a) => abbreviateName(a.name)).join(', ');
      return `<td class="cell-edit cell-conflict">
        <button type="button" class="cell-conflict-summary" data-action="toggle-conflict-cell" data-key="${escapeHtml(key)}" title="${assignments.length} estudiantes en la misma área — tocá para ver y corregir">
          ⚠ ${escapeHtml(abbrList)}
        </button>
      </td>`;
    }
    const rows = assignments.map((a) => `
      <div class="cell-conflict-row">
        <div class="cell-student">${starHtml(a)}${escapeHtml(a.name)}</div>
        ${selectHtml(a)}
      </div>`).join('');
    return `<td class="cell-edit cell-conflict cell-conflict-open">
      <button type="button" class="cell-conflict-summary" data-action="toggle-conflict-cell" data-key="${escapeHtml(key)}">⚠ Tocá para agrupar de nuevo</button>
      ${rows}
    </td>`;
  }

  // Variante editable de renderMonthGridTable: el mes completo se edita
  // como una única grilla continua (con sus divisores "Semana N"), no
  // semana por semana — usada en el modo "Corrección" del mes recién
  // cerrado. Cada celda ocupada lleva un <select>, igual que en la
  // propuesta semanal, pero con el inicio de semana en el dataset para
  // saber a qué semana del borrador aplicar el cambio.
  function editableMonthDayRowsHtml(days, weekStart, studentsById) {
    return days.map((day) => {
      const byArea = {};
      day.assignments.forEach((a) => { (byArea[a.area] = byArea[a.area] || []).push(a); });
      const dateObj = Core.fromISO(day.date);
      const cells = Core.AREAS.map((ar) => renderAssignmentCell(byArea[ar.id] || [], day, ar, studentsById, {
        starAction: 'toggle-month-star',
        selectAction: 'set-month-area',
        allowStar: true,
        extraAttrs: () => `data-week-start="${weekStart}"`,
        cellKeyPrefix: `month|${weekStart}`,
      })).join('');
      return `<tr class="dow-${day.dow}"><td><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</td>${cells}</tr>`;
    }).join('');
  }

  function renderEditableMonthGridTable(weeksDraft, studentsById) {
    const [firstWeek, ...restWeeks] = weeksDraft;
    if (!firstWeek) return '<div class="table-wrap"><table></table></div>';
    const header = weekGridHeaderHtml(`Semana ${firstWeek.weekIndex}`);
    const body = editableMonthDayRowsHtml(firstWeek.days, firstWeek.startDate, studentsById) + restWeeks.map((week) => {
      const areaCells = Core.AREAS.map((a) => `<td>${escapeHtml(a.label)}</td>`).join('');
      const divider = `<tr class="week-divider-row"><td>Semana ${week.weekIndex}</td>${areaCells}</tr>`;
      return divider + editableMonthDayRowsHtml(week.days, week.startDate, studentsById);
    }).join('');
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  }

  function auditMonthDraft(weeksDraft) {
    const draftStarts = new Set(weeksDraft.map((w) => w.startDate));
    let history = state.lockedWeeks.filter((w) => !draftStarts.has(w.startDate));
    const allWarnings = [];
    weeksDraft.forEach((week) => {
      const audit = Core.auditWeek(state.students, history, week);
      audit.warnings.forEach((w) => allWarnings.push({ ...w, weekIndex: week.weekIndex }));
      history = [...history, week];
    });
    return allWarnings;
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
      day.assignments.forEach((a) => { (byArea[a.area] = byArea[a.area] || []).push(a); });
      const dateObj = Core.fromISO(day.date);
      // La estrella solo se puede agregar editando una semana ya bloqueada
      // ('draft'), nunca en la propuesta nueva ('proposal').
      const cells = Core.AREAS.map((ar) => renderAssignmentCell(byArea[ar.id] || [], day, ar, studentsById, {
        starAction: 'toggle-star',
        selectAction: 'set-area',
        allowStar: target === 'draft',
        extraAttrs: () => `data-target="${target}"`,
        cellKeyPrefix: `week|${target}|${proposal.startDate}`,
      })).join('');
      return `<tr class="dow-${day.dow}"><td><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</td>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table>${header}${rows}</table></div>`;
  }

  // -----------------------------------------------------------------
  // Tab: Generar
  // -----------------------------------------------------------------
  function sortWeeksAsc(weeks) {
    return [...weeks].sort((a, b) => (a.endDate < b.endDate ? -1 : 1));
  }

  function weekLongLabel(w) {
    return `Semana ${w.weekIndex} de ${Core.MONTH_NAMES_ES[w.month - 1]} ${w.year} (${Core.formatDateEs(Core.fromISO(w.startDate))} – ${Core.formatDateEs(Core.fromISO(w.endDate))})`;
  }

  // Único bloque con el switch de bloqueo/edición, reutilizado tanto para
  // "semana anterior" (junto a una propuesta en curso) como para la última
  // semana de un mes recién completado (pantalla de cierre de mes).
  function renderPreviousWeekBlock(week, heading = 'Semana anterior', subtitle = 'referencia — confirmá que nadie repite área', editingSubtitle = 'editando en simultáneo') {
    if (!week) return '';
    const label = weekLongLabel(week);
    const editing = editingWeekStart === week.startDate;
    const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));
    const toggle = `
      <label class="switch" title="${editing ? 'Tocá para volver a bloquear' : 'Tocá para editar'}">
        <input type="checkbox" data-action="toggle-previous-lock" data-start="${week.startDate}" ${editing ? 'checked' : ''}>
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span class="switch-label">${editing ? 'Editando' : 'Bloqueada'}</span>
      </label>`;
    if (editing) {
      const ownHistory = state.lockedWeeks.filter((w) => w.startDate !== week.startDate);
      const ownAudit = Core.auditWeek(state.students, ownHistory, editingWeekDraft);
      return `
        <div class="card">
          <div class="week-card-head"><h3>${escapeHtml(heading)} <span class="muted">— ${escapeHtml(editingSubtitle)}</span></h3>${toggle}</div>
          <p class="muted">${escapeHtml(label)}</p>
          <div class="alert warning">Estás editando esta semana mientras revisás el resto. Los cambios se guardan al volver a bloquear (switch), y ahí se recalcula lo que dependa del historial nuevo.</div>
          <div class="audit-list">${renderAudit(ownAudit)}</div>
          ${renderEditableWeekGridTable(editingWeekDraft, studentsById, 'draft')}
          <div class="btn-row">
            <button class="btn" data-action="confirm-previous-week">Confirmar y bloquear de nuevo</button>
            <button class="btn secondary" data-action="cancel-edit-week">Cancelar sin guardar</button>
          </div>
        </div>`;
    }
    return `
      <div class="card">
        <div class="week-card-head">
          <h3>${escapeHtml(heading)} <span class="muted">(${escapeHtml(subtitle)})</span></h3>
          ${toggle}
          <button class="btn small danger" data-action="delete-previous-week" data-start="${week.startDate}">Eliminar esta semana</button>
        </div>
        <p class="muted">${escapeHtml(label)}</p>
        ${renderWeekGridTable(week)}
      </div>`;
  }

  // Semanas de referencia extra, de solo lectura (sin switch): al arrancar
  // un mes se ven las últimas dos semanas bloqueadas (aunque sean del mes
  // anterior); al ir generando la semana 2, 3, etc. de un mes en curso, acá
  // se van sumando en tiempo real las semanas ya bloqueadas de ESE mes.
  function renderReferenceWeekCard(w) {
    return `
      <div class="card">
        <h3>Referencia <span class="muted">(bloqueada)</span></h3>
        <p class="muted">${escapeHtml(weekLongLabel(w))}</p>
        ${renderWeekGridTable(w)}
      </div>`;
  }

  function renderGenerar() {
    const el = document.getElementById('tab-generar');
    if (state.pendingProposal) {
      const proposal = state.pendingProposal;
      const audit = Core.auditWeek(state.students, historyForAudit(), proposal);
      const label = `Semana ${proposal.weekIndex} de ${Core.MONTH_NAMES_ES[proposal.month - 1]} ${proposal.year} (${Core.formatDateEs(Core.fromISO(proposal.startDate))} – ${Core.formatDateEs(Core.fromISO(proposal.endDate))})`;
      const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));

      const sortedLocked = sortWeeksAsc(state.lockedWeeks);
      const previousWeek = sortedLocked[sortedLocked.length - 1] || null;
      let earlierRefWeeks = [];
      if (previousWeek) {
        if (proposal.weekIndex === 1) {
          const secondLast = sortedLocked[sortedLocked.length - 2];
          if (secondLast) earlierRefWeeks = [secondLast];
        } else {
          earlierRefWeeks = sortedLocked.filter((w) => w.year === proposal.year && w.month === proposal.month && w.startDate !== previousWeek.startDate);
        }
      }
      const earlierRefHtml = [...earlierRefWeeks].reverse().map(renderReferenceWeekCard).join('');

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
        ${renderPreviousWeekBlock(previousWeek)}
        ${earlierRefHtml}
      `;
      return;
    }

    const weekInfo = Core.getNextPendingWeekInfo(state);
    if (!weekInfo) {
      el.innerHTML = '<div class="empty-state">No se pudo calcular la próxima semana.</div>';
      return;
    }

    // Antes de dejar arrancar la semana 1 de un mes nuevo, si el mes recién
    // terminado todavía no se cerró explícitamente, se muestra completo
    // para un último ajuste + el botón "Cerrar calendario mensual".
    if (weekInfo.index === 1 && state.lockedWeeks.length > 0) {
      const sortedLocked = sortWeeksAsc(state.lockedWeeks);
      const lastLocked = sortedLocked[sortedLocked.length - 1];
      const closedKey = `${lastLocked.year}-${Core.pad2(lastLocked.month)}`;
      if (isMonthComplete(state.lockedWeeks, lastLocked.year, lastLocked.month) && !state.closedMonths.includes(closedKey)) {
        const weeksOfThatMonth = sortedLocked.filter((w) => w.year === lastLocked.year && w.month === lastLocked.month);
        const monthLabel = `${Core.MONTH_NAMES_ES[lastLocked.month - 1]} ${lastLocked.year}`;
        const nextLabel = `${Core.MONTH_NAMES_ES[weekInfo.month - 1]} ${weekInfo.year}`;
        const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));
        const editing = editingMonthKey === closedKey;

        const gridHtml = editing
          ? renderEditableMonthGridTable(editingMonthDraft, studentsById)
          : renderMonthGridTable(weeksOfThatMonth);

        const auditHtml = editing
          ? (() => {
              const warnings = auditMonthDraft(editingMonthDraft);
              return warnings.length
                ? warnings.map((w) => `<div class="alert ${w.severity}">Semana ${w.weekIndex}: ${escapeHtml(w.message)}</div>`).join('')
                : '<div class="alert ok">✓ Sin conflictos ni alertas detectadas en todo el mes.</div>';
            })()
          : '';

        const actionsHtml = editing ? `
            <div class="btn-row">
              <button class="btn" data-action="save-month-edit">Guardar corrección</button>
              <button class="btn secondary" data-action="cancel-month-edit">Cancelar</button>
            </div>` : `
            <div class="btn-row">
              <button class="btn" data-action="close-month" data-month-key="${closedKey}">Cerrar calendario mensual</button>
              <button class="btn small secondary" data-action="start-month-edit" data-month-key="${closedKey}">
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style="vertical-align:-1px;margin-right:4px;"><path fill="currentColor" d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708L4.708 14.292a.5.5 0 0 1-.233.131l-3.5 1a.5.5 0 0 1-.618-.618l1-3.5a.5.5 0 0 1 .131-.233L12.146.854zM11.207 2.5 13.5 4.793l1.146-1.147L12.354 1.354 11.207 2.5zM2.5 11.707l7-7L11.793 6l-7 7-1.5.429.207-1.722z"/></svg>Corrección
              </button>
            </div>`;

        el.innerHTML = `
          <div class="card">
            <h2>${escapeHtml(monthLabel)} — mes completo</h2>
            <p class="muted">${editing ? 'Corrigiendo el mes completo — cualquier celda se puede reasignar directo en la grilla.' : `Revisá el mes completo antes de pasar a ${escapeHtml(nextLabel)}.`}</p>
            ${auditHtml}
            ${gridHtml}
            ${actionsHtml}
          </div>
          <p class="muted">No se puede generar la semana siguiente hasta cerrar el calendario de este mes.</p>
        `;
        return;
      }
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

  function regeneratePendingProposal() {
    const p = state.pendingProposal;
    const weekInfo = {
      index: p.weekIndex,
      year: p.year,
      month: p.month,
      start: Core.fromISO(p.startDate),
      end: Core.fromISO(p.endDate),
      days: p.days.map((d) => Core.fromISO(d.date)),
    };
    state.pendingProposal = Core.generateWeekProposal(state.students, state.lockedWeeks, weekInfo);
  }

  function handleRegenerateClick() {
    if (!state.pendingProposal) return;
    regeneratePendingProposal();
    saveState();
    renderGenerar();
    showToast('Propuesta regenerada automáticamente.');
  }

  // Si hay una propuesta pendiente (todavía no aprobada) cuando se agrega,
  // edita o quita un estudiante, esa propuesta quedó calculada con datos
  // viejos (día fijo, grupo de cocina, alta/baja) — se recalcula sola para
  // que la pestaña Estudiantes y el Generar queden siempre sincronizados.
  // Devuelve true si hubo una propuesta para recalcular.
  function syncPendingProposalAfterStudentChange() {
    if (!state.pendingProposal) return false;
    regeneratePendingProposal();
    return true;
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
        assignments: d.assignments.map((a) => ({ studentId: a.studentId, name: a.name, area: a.area, starred: !!a.starred })),
      })),
      approvedAt: new Date().toISOString(),
    });
    state.pendingProposal = null;
    saveState();
    renderAll();
    showToast('Semana bloqueada. No se podrá reescribir salvo pedido explícito.');
  }

  function handleCloseMonth(monthKey) {
    if (!state.closedMonths.includes(monthKey)) {
      state.closedMonths = [...state.closedMonths, monthKey];
    }
    saveState();
    renderAll();
    showToast('Mes cerrado. Ya podés generar el próximo.');
  }

  // Modo "Corrección" del mes recién completado: todo el mes se edita como
  // una sola grilla continua (no semana por semana).
  function handleStartMonthEdit(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const weeks = sortWeeksAsc(state.lockedWeeks).filter((w) => w.year === y && w.month === m);
    editingMonthKey = monthKey;
    editingMonthDraft = JSON.parse(JSON.stringify(weeks));
    expandedMonthKey = monthKey;
    renderAll();
  }

  // Botón "Editar" en Calendarios anteriores — para CUALQUIER mes, no solo
  // el último cerrado (a diferencia de la vieja "Corrección" en Generar).
  // Pide confirmación antes de entrar, como freno para que no sea un click
  // accidental sobre un registro ya cerrado.
  function handleRequestMonthEdit(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const monthLabel = `${Core.MONTH_NAMES_ES[m - 1]} ${y}`;
    const ok = confirm(`¿Estás seguro que querés editar el calendario de ${monthLabel}? Ya está cerrado — confirmá solo si estás seguro, no es para un click accidental.`);
    if (!ok) return;
    handleStartMonthEdit(monthKey);
  }

  function handleCancelMonthEdit() {
    editingMonthKey = null;
    editingMonthDraft = null;
    renderAll();
  }

  // Estas tres tocan el borrador de corrección de mes (editingMonthDraft),
  // que ahora puede estar visible tanto en Generar como en Calendarios
  // anteriores (botón "Editar") — por eso re-renderizan con renderAll() en
  // vez de solo renderGenerar(), para que la otra pestaña quede al día.
  function handleSetMonthArea(weekStart, date, studentId, area) {
    const week = editingMonthDraft.find((w) => w.startDate === weekStart);
    const day = week && week.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === studentId);
    if (a) a.area = area;
    renderAll();
  }

  // Despliega/agrupa una celda con 2+ estudiantes en la misma área (error
  // de asignación) para poder corregirlos uno por uno. Solo estado de UI.
  function handleToggleConflictCell(key) {
    if (expandedConflictCells.has(key)) expandedConflictCells.delete(key);
    else expandedConflictCells.add(key);
    renderAll();
  }

  function handleToggleMonthStar(weekStart, date, studentId) {
    const week = editingMonthDraft.find((w) => w.startDate === weekStart);
    const day = week && week.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === studentId);
    if (!a) return;
    a.starred = !a.starred;
    renderAll();
  }

  function handleSaveMonthEdit() {
    editingMonthDraft.forEach((draftWeek) => {
      const idx = state.lockedWeeks.findIndex((w) => w.startDate === draftWeek.startDate);
      if (idx !== -1) state.lockedWeeks[idx] = draftWeek;
    });
    editingMonthKey = null;
    editingMonthDraft = null;
    saveState();
    renderAll();
    showToast('Mes corregido y bloqueado de nuevo.');
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

  // Estrella de exoneración: marca manual del supervisor, no cambia el
  // área asignada ni el algoritmo. Solo se puede tocar editando una semana
  // ya bloqueada (nunca en la propuesta nueva, ver renderEditableWeekGridTable).
  function handleToggleStar(date, studentId) {
    if (!editingWeekDraft) return;
    const day = editingWeekDraft.days.find((d) => d.date === date);
    const a = day && day.assignments.find((x) => x.studentId === studentId);
    if (!a) return;
    a.starred = !a.starred;
    renderAll();
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
            <div class="detail-fullname">${escapeHtml(s.fullName || s.name)} <span class="sex-symbol sex-${s.sex || 'na'}">${sexSymbol(s.sex)}</span></div>
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
      const coopTagsHtml = `
        <div class="coop-tags">
          <button type="button" class="coop-tag ${s.coopTag === 'noncooperative' ? 'active' : ''}" data-action="set-coop-tag" data-id="${s.id}" data-tag="noncooperative" title="No colabora">🎯</button>
          <button type="button" class="coop-tag ${s.coopTag === 'cooperative' ? 'active' : ''}" data-action="set-coop-tag" data-id="${s.id}" data-tag="cooperative" title="Cooperativo/a">👏</button>
          <button type="button" class="coop-tag ${s.coopTag === 'neutral' ? 'active' : ''}" data-action="set-coop-tag" data-id="${s.id}" data-tag="neutral" title="Neutral">⚖️</button>
        </div>`;

      return `<div class="student-row ${s.active ? '' : 'inactive'}" data-id="${s.id}">
        <div class="student-main">
          <div class="student-name-row">
            <button class="student-name-toggle" data-action="toggle-detail" data-id="${s.id}">
              <span class="student-name">${escapeHtml(s.name)}</span>${tierBadge}
            </button>
            ${coopTagsHtml}
          </div>
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
      <div class="card">
        <h2>Copia de seguridad</h2>
        <p class="muted">Mientras la PC y el celular estén en la misma red y abran el mismo link, ya se actualizan solos — no hace falta exportar nada para eso. Esto es para tener un respaldo aparte, o para pasar toda la información a otra computadora: descarga estudiantes, calendarios y meses cerrados en un solo archivo, e "Importar" lo vuelve a cargar (reemplazando todo lo que haya en este momento).</p>
        <div class="btn-row">
          <button class="btn small secondary" data-action="export-backup">Exportar copia completa</button>
          <button class="btn small secondary" data-action="import-backup">Importar copia</button>
          <input type="file" id="import-backup-input" accept="application/json" hidden>
        </div>
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
    const proposalRefreshed = syncPendingProposalAfterStudentChange();
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast(proposalRefreshed ? `${name} agregado/a y propuesta pendiente recalculada.` : `${name} agregado/a.`);
  }

  // -----------------------------------------------------------------
  // Copia de seguridad: exporta TODO el estado (estudiantes, calendarios,
  // meses cerrados) como un .json descargable, e importarlo lo reemplaza
  // por completo — pensado como respaldo manual o para migrar a otra PC,
  // no como el mecanismo normal de sincronización (eso ya lo hace el
  // servidor compartido solo, en tiempo real, para todo dispositivo en la
  // misma red que abra el mismo link).
  // -----------------------------------------------------------------
  function handleExportBackup() {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `calendario-hogar-colonia-copia-${Core.toISO(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Copia descargada.');
  }

  function handleImportBackupClick() {
    document.getElementById('import-backup-input').click();
  }

  function handleImportBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        showToast('El archivo no es una copia válida (JSON inválido).');
        return;
      }
      const ok = confirm('¿Importar esta copia? Va a REEMPLAZAR toda la información actual (estudiantes, calendarios, meses cerrados) acá y en el servidor compartido. Esta acción no se puede deshacer.');
      if (!ok) return;
      state = normalizeState(parsed);
      editingStudentId = null;
      expandedStudentId = null;
      editingWeekStart = null;
      editingWeekDraft = null;
      expandedMonthKey = null;
      editingMonthKey = null;
      editingMonthDraft = null;
      saveState();
      renderAll();
      showToast('Copia importada correctamente.');
    };
    reader.readAsText(file);
  }

  function handleToggleDetail(id) { expandedStudentId = expandedStudentId === id ? null : id; renderEstudiantes(); }

  // Etiqueta manual de cooperación (mira/aplausos/balanza) — solo para que
  // el supervisor identifique de un vistazo quién colabora, quién no y
  // quién es neutral. No afecta el algoritmo de rotación ni los puntos.
  // Tocar la misma etiqueta activa la desmarca.
  function handleSetCoopTag(id, tag) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    student.coopTag = student.coopTag === tag ? null : tag;
    saveState();
    renderEstudiantes();
  }
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
    let proposalRefreshed = false;
    if (student) {
      const newFixedDay = Number(dayInput.value);
      const newKitchenGroup = kitchenInput.value;
      const affectsSchedule = student.fixedDay !== newFixedDay || student.kitchenGroup !== newKitchenGroup;
      student.name = name;
      student.fullName = fullNameInput.value.trim() || name;
      student.sex = sexInput.value;
      student.fixedDay = newFixedDay;
      student.kitchenGroup = newKitchenGroup;
      proposalRefreshed = affectsSchedule && syncPendingProposalAfterStudentChange();
    }
    editingStudentId = null;
    saveState();
    renderEstudiantes();
    renderGenerar();
    showToast(proposalRefreshed ? 'Estudiante actualizado y propuesta pendiente recalculada.' : 'Estudiante actualizado.');
  }
  function handleDeleteStudent(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    if (!confirm(`¿Quitar la beca a ${student.name}? Esta acción no se puede deshacer. Su historial en semanas ya bloqueadas se conserva, pero dejará de aparecer en el calendario.`)) return;
    state.students = state.students.filter((s) => s.id !== id);
    if (editingStudentId === id) editingStudentId = null;
    const proposalRefreshed = syncPendingProposalAfterStudentChange();
    saveState();
    renderEstudiantes();
    renderGenerar();
    if (proposalRefreshed) showToast(`${student.name} quitado/a y propuesta pendiente recalculada.`);
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
      const dateRange = `${Core.formatDateEs(Core.fromISO(weeksOfMonth[0].startDate))} – ${Core.formatDateEs(Core.fromISO(weeksOfMonth[weeksOfMonth.length - 1].endDate))}`;
      const isOpen = expandedMonthKey === key;
      const editingThisMonth = editingMonthKey === key;

      const buildEditBodyHtml = () => {
        const warnings = auditMonthDraft(editingMonthDraft);
        const auditHtml = warnings.length
          ? warnings.map((w) => `<div class="alert ${w.severity}">Semana ${w.weekIndex}: ${escapeHtml(w.message)}</div>`).join('')
          : '<div class="alert ok">✓ Sin conflictos ni alertas detectadas en todo el mes.</div>';
        return `
        <div class="month-card-body">
          ${auditHtml}
          ${renderEditableMonthGridTable(editingMonthDraft, studentsById)}
          <div class="btn-row">
            <button class="btn" data-action="save-month-edit">Guardar corrección</button>
            <button class="btn secondary" data-action="cancel-month-edit">Cancelar</button>
          </div>
        </div>`;
      };

      const viewBodyHtml = `
        <div class="month-card-body">
          ${renderMonthGridTable(weeksOfMonth)}
          <div class="btn-row">
            <button class="btn small secondary" data-action="print-month" data-month-key="${key}">
              <svg class="icon-download" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1a1 1 0 0 1 1 1v6.086l1.793-1.793a1 1 0 1 1 1.414 1.414l-3.5 3.5a1 1 0 0 1-1.414 0l-3.5-3.5a1 1 0 1 1 1.414-1.414L7 8.086V2a1 1 0 0 1 1-1zM2 12a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1z"/></svg>
              PDF
            </button>
            <button class="btn small secondary" data-action="download-image" data-month-key="${key}">
              <svg class="icon-download" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1.5.5v6.6l2.6-2.4a.75.75 0 0 1 1 0l2 1.85 1.9-1.75a.75.75 0 0 1 1 0l1.5 1.4V3.5h-10zm0 9v-.66l3.1-2.87 4.9 4.53H3.5zm9-.06-2.02-1.87 2.02-1.86v3.73zM5.5 6.2a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>
              Imagen
            </button>
            <button class="btn small secondary" data-action="request-month-edit" data-month-key="${key}">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style="vertical-align:-1px;margin-right:4px;"><path fill="currentColor" d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708L4.708 14.292a.5.5 0 0 1-.233.131l-3.5 1a.5.5 0 0 1-.618-.618l1-3.5a.5.5 0 0 1 .131-.233L12.146.854zM11.207 2.5 13.5 4.793l1.146-1.147L12.354 1.354 11.207 2.5zM2.5 11.707l7-7L11.793 6l-7 7-1.5.429.207-1.722z"/></svg>
              Editar
            </button>
          </div>
        </div>`;

      const bodyHtml = isOpen ? (editingThisMonth ? buildEditBodyHtml() : viewBodyHtml) : '';

      return `<div class="week-card card month-card ${isOpen ? 'open' : ''}">
        <button type="button" class="month-toggle" data-action="toggle-month" data-month-key="${key}" aria-expanded="${isOpen}">
          <span class="month-toggle-title">
            <h3>${escapeHtml(label)}</h3>
            <span class="muted">${dateRange}</span>
          </span>
          <span class="month-toggle-chevron" aria-hidden="true">▾</span>
        </button>
        ${bodyHtml}
      </div>`;
    }).join('');

    el.innerHTML = monthCards;
  }

  function handleToggleMonth(key) {
    expandedMonthKey = expandedMonthKey === key ? null : key;
    renderSemanas();
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
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = `
      <h1>Hogar Colonia — Calendario de limpieza</h1>
      <h2>${escapeHtml(label)}</h2>
      ${renderMonthGridTable(weeksOfMonth)}
      <p class="print-footer">Generado ${new Date().toLocaleDateString('es-AR')}</p>
    `;
    window.print();
  }

  // -----------------------------------------------------------------
  // Descargar como imagen (PNG): dibuja el mismo calendario a mano en un
  // <canvas> (mismos colores por día que la app) y lo baja como archivo,
  // para poder mandarlo directo a un grupo de WhatsApp. Sin librerías: se
  // dibuja todo con la API 2D del canvas, en una sola imagen sin cortes de
  // página, así se ve el mes completo de punta a punta.
  // -----------------------------------------------------------------
  const DOW_COLORS = { 1: '#23303f', 2: '#2b2a3f', 3: '#313026', 4: '#2f2620', 5: '#263329', 6: '#332627', 7: '#23282e' };
  const IMG_FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function fitFontSize(ctx, text, maxWidth, weight, startSize) {
    let size = startSize;
    ctx.font = `${weight} ${size}px ${IMG_FONT}`;
    while (size > 9 && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = `${weight} ${size}px ${IMG_FONT}`;
    }
    return size;
  }

  function buildMonthImageDataUrl(monthKey) {
    const weeksOfMonth = weeksOfMonthKey(monthKey);
    if (!weeksOfMonth.length) return null;
    const [, m] = monthKey.split('-').map(Number);
    const label = `${Core.MONTH_NAMES_ES[m - 1]} ${weeksOfMonth[0].year}`;
    const totalDays = weeksOfMonth.reduce((sum, w) => sum + w.days.length, 0);

    const BG = '#14151a';
    const PANEL2 = '#21232c';
    const BORDER = '#333644';
    const TEXT = '#e7e8ec';
    const MUTED = '#9198a8';

    const dayColWidth = 148;
    const areaColWidth = 136;
    // La primera semana no lleva divisor propio (quedaría pegado debajo
    // del encabezado, duplicando la fila de áreas) — su número va directo
    // en la celda "Día" del encabezado, igual que en la vista HTML.
    const firstWeekIndex = weeksOfMonth[0] ? weeksOfMonth[0].weekIndex : 1;
    const cols = [{ id: 'day', label: `Semana ${firstWeekIndex}`, width: dayColWidth }]
      .concat(Core.AREAS.map((a) => ({ id: a.id, label: a.label, width: areaColWidth })));
    const tableWidth = cols.reduce((sum, c) => sum + c.width, 0);

    const headerH = 34;
    const rowH = 32;
    const dividerH = 22;
    const titleH = 66;
    const footerH = 26;
    const pad = 22;
    const width = tableWidth + pad * 2;
    const height = titleH + headerH + Math.max(0, weeksOfMonth.length - 1) * dividerH + totalDays * rowH + footerH + pad * 2;

    const SCALE = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'middle';

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = TEXT;
    ctx.font = `700 19px ${IMG_FONT}`;
    ctx.fillText('Hogar Colonia — Calendario de limpieza', pad, pad + 10);
    ctx.fillStyle = MUTED;
    ctx.font = `600 14px ${IMG_FONT}`;
    ctx.fillText(label, pad, pad + 34);

    let y = pad + titleH;

    ctx.fillStyle = PANEL2;
    ctx.fillRect(pad, y, tableWidth, headerH);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad + 0.5, y + 0.5, tableWidth - 1, headerH - 1);
    let hx = pad;
    ctx.fillStyle = MUTED;
    ctx.font = `700 10.5px ${IMG_FONT}`;
    cols.forEach((c) => {
      ctx.fillText(c.label.toUpperCase(), hx + 10, y + headerH / 2 + 1);
      hx += c.width;
    });
    y += headerH;

    weeksOfMonth.forEach((week, weekPos) => {
      if (weekPos > 0) {
        ctx.fillStyle = PANEL2;
        ctx.fillRect(pad, y, tableWidth, dividerH);
        // Borde blanco bien visible para separar cada semana a simple vista.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(pad + 1, y + 1, tableWidth - 2, dividerH - 2);
        ctx.lineWidth = 1;
        let dx = pad;
        ctx.font = `700 10px ${IMG_FONT}`;
        cols.forEach((c, i) => {
          ctx.fillStyle = i === 0 ? TEXT : MUTED;
          const label = i === 0 ? `SEMANA ${week.weekIndex}` : c.label.toUpperCase();
          ctx.fillText(label, dx + 10, y + dividerH / 2 + 1);
          dx += c.width;
        });
        y += dividerH;
      }

      week.days.forEach((day) => {
        const cellByArea = {};
        day.assignments.forEach((a) => {
          if (a.starred) return; // exonerado: no aparece en la imagen
          const existing = cellByArea[a.area];
          cellByArea[a.area] = existing ? `${existing}, ${a.name}` : a.name;
        });

        ctx.fillStyle = DOW_COLORS[day.dow];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(pad, y, tableWidth, rowH);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = BORDER;
        ctx.strokeRect(pad + 0.5, y + 0.5, tableWidth - 1, rowH - 1);

        let cx = pad;
        const dateObj = Core.fromISO(day.date);
        const dowLabel = Core.DOW_NAMES_ES[day.dow - 1];
        const dateLabel = Core.formatDateEs(dateObj);

        ctx.font = `700 10.5px ${IMG_FONT}`;
        const pillPadX = 7;
        const pillH = 18;
        const pillW = ctx.measureText(dowLabel).width + pillPadX * 2;
        const pillX = cx + 8;
        const pillY = y + rowH / 2 - pillH / 2;
        ctx.fillStyle = DOW_COLORS[day.dow];
        roundRectPath(ctx, pillX, pillY, pillW, pillH, 999);
        ctx.fill();
        ctx.fillStyle = TEXT;
        ctx.fillText(dowLabel, pillX + pillPadX, pillY + pillH / 2 + 1);

        ctx.font = `400 11.5px ${IMG_FONT}`;
        ctx.fillStyle = TEXT;
        ctx.fillText(dateLabel, pillX + pillW + 8, y + rowH / 2 + 1);

        cx += dayColWidth;
        Core.AREAS.forEach((ar) => {
          const text = cellByArea[ar.id] || '—';
          const maxTextWidth = areaColWidth - 16;
          fitFontSize(ctx, text, maxTextWidth, '400', 12);
          ctx.fillStyle = text === '—' ? MUTED : TEXT;
          ctx.fillText(text, cx + 10, y + rowH / 2 + 1);
          cx += areaColWidth;
        });

        y += rowH;
      });
    });

    ctx.fillStyle = MUTED;
    ctx.font = `400 10.5px ${IMG_FONT}`;
    ctx.fillText(`Generado ${new Date().toLocaleDateString('es-AR')}`, pad, y + 16);

    return canvas.toDataURL('image/png');
  }

  function handleDownloadMonthImage(monthKey) {
    const dataUrl = buildMonthImageDataUrl(monthKey);
    if (!dataUrl) return;
    const [, m] = monthKey.split('-').map(Number);
    const weeksOfMonth = weeksOfMonthKey(monthKey);
    const fileLabel = `${Core.MONTH_NAMES_ES[m - 1]}-${weeksOfMonth[0].year}`
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `calendario-${fileLabel}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      else if (action === 'close-month') handleCloseMonth(btn.dataset.monthKey);
      else if (action === 'start-month-edit') handleStartMonthEdit(btn.dataset.monthKey);
      else if (action === 'cancel-month-edit') handleCancelMonthEdit();
      else if (action === 'save-month-edit') handleSaveMonthEdit();
      else if (action === 'toggle-star') handleToggleStar(btn.dataset.date, btn.dataset.student);
      else if (action === 'toggle-month-star') handleToggleMonthStar(btn.dataset.weekStart, btn.dataset.date, btn.dataset.student);
      else if (action === 'toggle-conflict-cell') handleToggleConflictCell(btn.dataset.key);
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'start-month-input') handleStartMonthChange(e.target);
      else if (e.target.matches('input[data-action="toggle-previous-lock"]')) {
        if (e.target.checked) handleEditWeekStart(e.target.dataset.start);
        else handleConfirmPreviousWeekEdit();
      } else if (e.target.matches('select[data-action="set-area"]')) {
        if (e.target.dataset.target === 'draft') handleEditWeekSetArea(e.target.dataset.date, e.target.dataset.student, e.target.value);
        else handleSetArea(e.target);
      } else if (e.target.matches('select[data-action="set-month-area"]')) {
        handleSetMonthArea(e.target.dataset.weekStart, e.target.dataset.date, e.target.dataset.student, e.target.value);
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
      else if (action === 'set-coop-tag') handleSetCoopTag(id, btn.dataset.tag);
      else if (action === 'export-backup') handleExportBackup();
      else if (action === 'import-backup') handleImportBackupClick();
    });
    el.addEventListener('change', (e) => {
      if (e.target.id === 'import-backup-input') handleImportBackupFile(e.target.files[0]);
    });
  }

  function initSemanasEvents() {
    const el = document.getElementById('tab-semanas');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'print-month') handlePrintMonth(btn.dataset.monthKey);
      else if (action === 'download-image') handleDownloadMonthImage(btn.dataset.monthKey);
      else if (action === 'toggle-month') handleToggleMonth(btn.dataset.monthKey);
      else if (action === 'request-month-edit') handleRequestMonthEdit(btn.dataset.monthKey);
      else if (action === 'save-month-edit') handleSaveMonthEdit();
      else if (action === 'cancel-month-edit') handleCancelMonthEdit();
      else if (action === 'toggle-month-star') handleToggleMonthStar(btn.dataset.weekStart, btn.dataset.date, btn.dataset.student);
      else if (action === 'toggle-conflict-cell') handleToggleConflictCell(btn.dataset.key);
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('select[data-action="set-month-area"]')) {
        handleSetMonthArea(e.target.dataset.weekStart, e.target.dataset.date, e.target.dataset.student, e.target.value);
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
