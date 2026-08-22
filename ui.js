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

  // Diagnóstico TEMPORAL y visible en pantalla del bug de sincronización en
  // celular (se puede sacar una vez resuelto). Se arma acá arriba de todo
  // para capturar errores lo antes posible, incluso si algo revienta antes
  // de que initState() termine. Se muestra en la pestaña "Calendarios
  // anteriores" vía syncDebugHtml().
  const syncDebug = {
    attempts: [], // [{ n, status }] uno por cada intento de GET /api/state
    outcome: null,
    lockedWeeksCount: null,
    jsError: null,
  };
  window.addEventListener('error', (e) => {
    if (syncDebug.jsError) return;
    syncDebug.jsError = `${e.message || e} (${e.filename || '?'}:${e.lineno || '?'}:${e.colno || '?'})`;
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (syncDebug.jsError) return;
    const reason = e.reason;
    syncDebug.jsError = reason && reason.message ? reason.message : String(reason);
  });

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
  // Formularios de "agregar estudiante a este día" que el supervisor tocó
  // para desplegar, en las grillas editables. Solo estado de UI.
  const expandedDayAddForms = new Set();
  // Burbujas de gravedad (LOG de conflictos) que el supervisor tocó para
  // desplegar el resumen de esa gravedad, y conflictos individuales dentro
  // de una burbuja que tocó para ver el texto completo. Solo estado de UI.
  const expandedSeverityGroups = new Set();
  const expandedConflictItems = new Set();

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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Un solo intento de traer el estado — sin reintentos acá, eso lo maneja
  // loadStateFromServer. Puede fallar por cualquier motivo de red (VPN
  // reconectando, datos móviles con un pestañeo, servidor reiniciando).
  async function fetchStateOnce(attemptNum) {
    let res;
    try {
      res = await fetch('/api/state', { cache: 'no-store' });
    } catch (networkErr) {
      syncDebug.attempts.push({ n: attemptNum, status: `sin respuesta (${(networkErr && networkErr.message) || networkErr})` });
      throw networkErr;
    }
    syncDebug.attempts.push({ n: attemptNum, status: res.status });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return data ? normalizeState(data) : null;
  }

  // undefined = no hay servidor disponible después de reintentar (modo
  // standalone); null = hay servidor pero todavía no guardó nada; objeto =
  // estado real del servidor.
  //
  // Reintenta unas pocas veces antes de darse por vencido: un solo fallo
  // (típico al abrir la app recién con datos móviles + VPN todavía
  // reconectando) no debe tirar a toda la sesión al modo "solo este
  // navegador" — eso era lo que hacía ver vacía la pestaña de Calendarios
  // anteriores en el celular: no es que esa pestaña lea de otro lado, es
  // que TODO el estado (incluido el historial de semanas) caía al estado
  // por default (roster real, pero sin ninguna semana) apenas la primera
  // consulta al servidor fallaba una vez, sin avisar.
  async function loadStateFromServer() {
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fetchStateOnce(i + 1);
      } catch (e) {
        if (i < attempts - 1) await sleep(600 * (i + 1));
      }
    }
    return undefined;
  }

  async function initState() {
    const fromServer = await loadStateFromServer();
    if (fromServer === undefined) {
      usingServer = false;
      state = loadStateFromLocalStorage() || defaultState();
      syncDebug.outcome = 'sin servidor tras reintentar — usando copia local del navegador';
    } else {
      usingServer = true;
      state = fromServer || defaultState();
      syncDebug.outcome = fromServer ? 'servidor respondió OK' : 'servidor respondió OK pero todavía no hay nada guardado';
    }
    syncDebug.lockedWeeksCount = (state.lockedWeeks || []).length;
    updateConnStatus();
  }

  function saveState() {
    if (usingServer) {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).then((res) => {
        // fetch no rechaza la promesa por códigos 4xx/5xx (solo por errores
        // de red) — sin este chequeo, un guardado rechazado por el servidor
        // (ej. 403 de una clave de solo lectura) se vería como "guardado"
        // en la UI aunque en realidad no haya pasado nada.
        if (!res.ok) throw new Error(`status ${res.status}`);
      }).catch((e) => {
        console.error('No se pudo guardar en el servidor; se guarda localmente como respaldo.', e);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e2) { /* noop */ }
        const message = String(e && e.message).includes('403')
          ? 'Este código es de solo lectura: los cambios no se guardaron en el servidor.'
          : 'No se pudo guardar en el servidor. Revisá que server.js siga corriendo.';
        showToast(message);
      });
    } else {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.error(e); }
    }
  }

  function updateConnStatus() {
    const el = document.getElementById('conn-status');
    const banner = document.getElementById('offline-banner');
    if (usingServer) {
      if (el) { el.textContent = 'Compartido (servidor local)'; el.className = 'conn-status online'; }
      if (banner) banner.hidden = true;
    } else {
      if (el) { el.textContent = 'Solo este navegador (sin servidor)'; el.className = 'conn-status offline'; }
      // El pill del header es chico y fácil de no ver, sobre todo en el
      // celular — este aviso arriba de todo es la parte importante: sin
      // esto, una pestaña vacía (ej. Calendarios anteriores) se puede leer
      // como "no hay datos" en vez de "no se pudo conectar todavía".
      if (banner) banner.hidden = false;
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  // Reemplaza a confirm() nativo: los diálogos nativos (confirm/alert) del
  // navegador fuerzan la salida automática de pantalla completa apenas
  // aparecen — este modal es HTML común dentro de la propia página, así
  // que no dispara ese comportamiento. Misma forma de uso: se espera el
  // resultado (true = Aceptar, false = Cancelar/cerrar).
  function showConfirmModal(message) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirm-modal');
      const msgEl = document.getElementById('confirm-modal-message');
      const acceptBtn = document.getElementById('confirm-modal-accept');
      const cancelBtn = document.getElementById('confirm-modal-cancel');
      if (!overlay || !msgEl || !acceptBtn || !cancelBtn) {
        // Red de seguridad: si por algún motivo el modal no está en el DOM,
        // que no se rompa el flujo (aunque se pierda el detalle de no
        // cortar la pantalla completa).
        resolve(window.confirm(message));
        return;
      }
      msgEl.textContent = message;
      overlay.hidden = false;
      const cleanup = (result) => {
        overlay.hidden = true;
        acceptBtn.removeEventListener('click', onAccept);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlayClick);
        resolve(result);
      };
      const onAccept = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onOverlayClick = (e) => { if (e.target === overlay) cleanup(false); };
      acceptBtn.addEventListener('click', onAccept);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlayClick);
    });
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

  // Nombre del día + fecha, en una sola línea que nunca se corta (la
  // columna se ensancha sola si hace falta) — evita que la fecha quede
  // colgando debajo del nombre en pantallas angostas.
  function dayCellHeadHtml(day, dateObj) {
    return `<span class="day-cell-head"><span class="day-pill dow-${day.dow}">${Core.DOW_NAMES_ES[day.dow - 1]}</span> ${Core.formatDateEs(dateObj)}</span>`;
  }

  function weekDayRowsHtml(days) {
    return days.map((day) => {
      const cellByArea = {};
      day.assignments.forEach((a) => {
        const nameHtml = escapeHtml(a.name);
        const existing = cellByArea[a.area];
        cellByArea[a.area] = existing ? `${existing}, ${nameHtml}` : nameHtml;
      });
      const dateObj = Core.fromISO(day.date);
      const cells = Core.AREAS.map((ar) => `<td>${cellByArea[ar.id] || '<span class="muted">—</span>'}</td>`).join('');
      return `<tr class="dow-${day.dow}"><td>${dayCellHeadHtml(day, dateObj)}</td>${cells}</tr>`;
    }).join('');
  }

  function renderWeekGridTable(weekLike) {
    const header = weekGridHeaderHtml();
    const rows = weekDayRowsHtml(weekLike.days);
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
  }

  // Alerta de asignación pegada al rótulo "Semana N" (encabezado o fila
  // divisora, en las grillas de mes) — un estudiante con beca sin ninguna
  // asignación ESA semana en particular. Solo cuenta a quien realmente
  // tenga su día fijo dentro de esa semana (Core.studentCoverageForWeek ya
  // lo hace así): si el mes corta la semana a mitad de camino, el resto de
  // esa semana natural cae en la semana 1 del mes siguiente y se evalúa
  // ahí — nunca se marca acá a alguien que no le tocaba esta semana.
  // `students` en null/undefined desactiva la alerta (usado en el PDF,
  // donde no hay forma de tocarla para desplegar el detalle).
  function weekCoverageMarkerHtml(students, week, groupKey) {
    if (!students) return '';
    const coverage = Core.studentCoverageForWeek(students, week);
    if (!coverage.missing.length) return '';
    const isOpen = expandedSeverityGroups.has(groupKey);
    return ` <button type="button" class="week-row-alert ${isOpen ? 'is-open' : ''}" data-action="toggle-severity-group" data-key="${escapeHtml(groupKey)}" title="${isOpen ? 'Tocá para cerrar' : 'Tocá para ver quién falta'}" aria-label="Falta asignar a alguien esta semana">⚠</button>`;
  }

  // Fila con solamente los nombres de quienes falten, debajo del divisor de
  // esa semana — únicamente si la alerta de arriba está desplegada.
  function weekCoverageDetailRowHtml(students, week, groupKey) {
    if (!students || !expandedSeverityGroups.has(groupKey)) return '';
    const coverage = Core.studentCoverageForWeek(students, week);
    if (!coverage.missing.length) return '';
    const colSpan = 1 + Core.AREAS.length;
    return `<tr class="week-alert-detail-row"><td colspan="${colSpan}">${coverage.missing.map((m) => escapeHtml(m.name)).join(', ')}</td></tr>`;
  }

  // Vista de un mes completo: varias semanas (Core.monthWeeks) una debajo de
  // otra, separadas por una fila fina "Semana N" — cada semana va del
  // primer día del mes (o lunes) hasta el domingo (o el último día del
  // mes), tal cual corta el propio calendario. Usada en Calendarios
  // anteriores y en el PDF; la imagen descargable dibuja lo mismo a mano.
  // `studentsById` y `groupKeyPrefix` son opcionales: sin ellos (como en el
  // PDF) no se muestra la alerta de asignación por semana.
  function renderMonthGridTable(weeksOfMonth, studentsById, groupKeyPrefix) {
    const [firstWeek, ...restWeeks] = weeksOfMonth;
    if (!firstWeek) return '<div class="table-wrap"><table></table></div>';
    const students = studentsById ? Object.values(studentsById) : null;
    // La primera semana no lleva su propio divisor "Semana N" — quedaría
    // pegado justo debajo del encabezado, duplicando la fila de áreas. En
    // su lugar, la celda "Día" del encabezado se reemplaza directamente
    // por "Semana N" (el índice de la primera semana presente del mes,
    // que no siempre es 1 — ej. un mes con historial incompleto al inicio).
    const firstGk = `${groupKeyPrefix}|w${firstWeek.weekIndex}|coverage`;
    const header = `<tr><th>Semana ${firstWeek.weekIndex}${weekCoverageMarkerHtml(students, firstWeek, firstGk)}</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}</tr>`;
    const body = weekCoverageDetailRowHtml(students, firstWeek, firstGk) + weekDayRowsHtml(firstWeek.days) + restWeeks.map((week) => {
      const gk = `${groupKeyPrefix}|w${week.weekIndex}|coverage`;
      const areaCells = Core.AREAS.map((a) => `<td>${escapeHtml(a.label)}</td>`).join('');
      const divider = `<tr class="week-divider-row"><td>Semana ${week.weekIndex}${weekCoverageMarkerHtml(students, week, gk)}</td>${areaCells}</tr>`;
      return divider + weekCoverageDetailRowHtml(students, week, gk) + weekDayRowsHtml(week.days);
    }).join('');
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  }

  // Celda editable de Día × Área, compartida entre la propuesta semanal, la
  // edición de una semana bloqueada y la corrección de un mes. Normalmente
  // hay un solo estudiante por celda (nombre + selector de área). Si por
  // error hay 2+ en la misma área el mismo día, se ven abreviados y
  // agrupados ("Joaq..., Flor...") hasta que se toca la celda: ahí se
  // despliegan uno por uno, cada uno con su propio selector para corregirlo.
  // `opts`: { selectAction, removeAction, extraAttrs(a), cellKeyPrefix }
  function renderAssignmentCell(assignments, day, ar, studentsById, opts) {
    if (!assignments.length) return '<td><span class="muted">—</span></td>';

    const selectHtml = (a) => {
      const student = studentsById[a.studentId];
      const elig = student ? Core.eligibleAreas(student) : Core.AREAS;
      const options = elig.map((opt) => `<option value="${opt.id}" ${opt.id === a.area ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('');
      return `<select class="cell-area-select" data-action="${opts.selectAction}" ${opts.extraAttrs(a)} data-date="${day.date}" data-student="${a.studentId}">${options}</select>`;
    };
    const removeHtml = (a) => `<button type="button" class="cell-remove" data-action="${opts.removeAction}" ${opts.extraAttrs(a)} data-date="${day.date}" data-student="${a.studentId}" title="Quitar a ${escapeHtml(a.name)} de este día">✕</button>`;

    if (assignments.length === 1) {
      const a = assignments[0];
      return `<td class="cell-edit">
        <div class="cell-student">${escapeHtml(a.name)}${removeHtml(a)}</div>
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
        <div class="cell-student">${escapeHtml(a.name)}${removeHtml(a)}</div>
        ${selectHtml(a)}
      </div>`).join('');
    return `<td class="cell-edit cell-conflict cell-conflict-open">
      <button type="button" class="cell-conflict-summary" data-action="toggle-conflict-cell" data-key="${escapeHtml(key)}">⚠ Tocá para agrupar de nuevo</button>
      ${rows}
    </td>`;
  }

  // Botón "+" en la celda de fecha de cada fila (grillas editables): abre
  // un mini-formulario para agregar a un estudiante que ese día no tenía
  // asignación — necesario cuando cambia el día fijo de alguien y hay que
  // insertarlo a mano en una semana o mes ya bloqueado.
  function renderDayAddControl(day, opts) {
    const key = `${opts.cellKeyPrefix}|${day.date}|add`;
    const isOpen = expandedDayAddForms.has(key);
    const toggleBtn = `<button type="button" class="day-add-toggle" data-action="toggle-day-add" data-key="${escapeHtml(key)}" title="${isOpen ? 'Cerrar' : 'Agregar un estudiante a este día'}">${isOpen ? '✕' : '+'}</button>`;
    if (!isOpen) return toggleBtn;

    const assignedIds = new Set(day.assignments.map((a) => a.studentId));
    const available = state.students
      .filter((s) => s.active && !assignedIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!available.length) {
      return `${toggleBtn}<div class="day-add-form"><p class="muted">No hay más estudiantes activos sin asignar ese día.</p></div>`;
    }
    // Nombre + símbolo de sexo y color (celeste para varones, rosa fuerte
    // para mujeres) solo acá, para identificar a cada uno de un vistazo al
    // elegir a quién agregar — no afecta cómo se ven en el resto de la app.
    const studentOptions = available.map((s) => {
      const symbol = sexSymbol(s.sex);
      const colorStyle = s.sex === 'M' ? ' style="color:#5ec8f2"' : s.sex === 'F' ? ' style="color:#ff4fa6"' : '';
      return `<option value="${s.id}"${colorStyle}>${escapeHtml(s.name)}${symbol ? ` ${symbol}` : ''}</option>`;
    }).join('');
    const areaOptions = Core.eligibleAreas(available[0]).map((a) => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join('');
    return `${toggleBtn}
      <div class="day-add-form">
        <select class="day-add-student">${studentOptions}</select>
        <select class="day-add-area">${areaOptions}</select>
        <button type="button" class="btn small" data-action="${opts.addAction}" ${opts.extraAttrs()} data-date="${day.date}">Agregar</button>
      </div>`;
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
      const cellOpts = {
        selectAction: 'set-month-area',
        removeAction: 'remove-month-assignment',
        addAction: 'add-month-assignment',
        extraAttrs: () => `data-week-start="${weekStart}"`,
        cellKeyPrefix: `month|${weekStart}`,
      };
      const cells = Core.AREAS.map((ar) => renderAssignmentCell(byArea[ar.id] || [], day, ar, studentsById, cellOpts)).join('');
      const addControl = renderDayAddControl(day, cellOpts);
      return `<tr class="dow-${day.dow}"><td>${dayCellHeadHtml(day, dateObj)}${addControl}</td>${cells}</tr>`;
    }).join('');
  }

  function renderEditableMonthGridTable(weeksDraft, studentsById, groupKeyPrefix) {
    const [firstWeek, ...restWeeks] = weeksDraft;
    if (!firstWeek) return '<div class="table-wrap"><table></table></div>';
    const students = Object.values(studentsById);
    const firstGk = `${groupKeyPrefix}|w${firstWeek.weekIndex}|coverage`;
    const header = `<tr><th>Semana ${firstWeek.weekIndex}${weekCoverageMarkerHtml(students, firstWeek, firstGk)}</th>${Core.AREAS.map((a) => `<th>${escapeHtml(a.label)}</th>`).join('')}</tr>`;
    const body = weekCoverageDetailRowHtml(students, firstWeek, firstGk) + editableMonthDayRowsHtml(firstWeek.days, firstWeek.startDate, studentsById) + restWeeks.map((week) => {
      const gk = `${groupKeyPrefix}|w${week.weekIndex}|coverage`;
      const areaCells = Core.AREAS.map((a) => `<td>${escapeHtml(a.label)}</td>`).join('');
      const divider = `<tr class="week-divider-row"><td>Semana ${week.weekIndex}${weekCoverageMarkerHtml(students, week, gk)}</td>${areaCells}</tr>`;
      return divider + weekCoverageDetailRowHtml(students, week, gk) + editableMonthDayRowsHtml(week.days, week.startDate, studentsById);
    }).join('');
    return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  }

  // Audita cada semana del borrador de mes por separado, pero contra el
  // historial que se va acumulando semana a semana, como siempre.
  // `weeksDraft` ya viene ordenado S1..S4 (sortWeeksAsc en
  // handleStartMonthEdit). La cobertura de becados se maneja aparte, en la
  // propia grilla (weekCoverageMarkerHtml), no acá.
  function auditMonthDraftByWeek(weeksDraft) {
    const draftStarts = new Set(weeksDraft.map((w) => w.startDate));
    let history = state.lockedWeeks.filter((w) => !draftStarts.has(w.startDate));
    return weeksDraft.map((week) => {
      const audit = Core.auditWeek(state.students, history, week);
      history = [...history, week];
      return { week, audit };
    });
  }

  // Severidades usadas por Core.auditWeek, ordenadas de más a menos grave.
  // Cada una es una "burbuja" clickeable (icono + contador) que despliega el
  // resumen de esa gravedad — más grave, más grande y más llamativa.
  const SEVERITY_META = {
    error: { icon: '🚨', label: 'Conflictos graves', className: 'sev-error' },
    warning: { icon: '⚠️', label: 'Conflictos moderados', className: 'sev-warning' },
    info: { icon: '⚠', label: 'Avisos menores', className: 'sev-info' },
  };
  const SEVERITY_ORDER = ['error', 'warning', 'info'];
  const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
  // Gravedad más grave presente en una lista de warnings (o null si no hay
  // ninguno), para colorear una burbuja que resume varias gravedades a la vez.
  function worstSeverity(warnings) {
    let worst = null;
    warnings.forEach((w) => {
      if (worst === null || SEVERITY_RANK[w.severity] < SEVERITY_RANK[worst]) worst = w.severity;
    });
    return worst;
  }
  // A partir de esta cantidad de conflictos en una misma burbuja, cada uno
  // se muestra resumido (1 línea) y hay que tocarlo para ver el texto
  // completo. Por debajo, no vale la pena resumir: se muestra entero directo.
  const SUMMARY_THRESHOLD = 3;

  // Frase corta para identificar un conflicto de un vistazo, sin tener que
  // leer el mensaje completo (que puede ser largo). Se arma con los campos
  // que ya trae cada warning (área/fecha/estudiante), no con el texto.
  function conflictSummary(w, studentsById) {
    const student = w.studentId ? studentsById[w.studentId] : null;
    const studentName = student ? student.name : 'Estudiante';
    const areaLbl = w.area ? Core.areaLabel(w.area) : 'Área';
    const dateLbl = w.date ? Core.formatDateEs(Core.fromISO(w.date)) : '';
    const dateSuffix = dateLbl ? ` (${dateLbl})` : '';
    switch (w.type) {
      case 'repeat': return `${studentName} repite área${dateSuffix}`;
      case 'kitchenGroup': return `${studentName} — grupo de cocina${dateSuffix}`;
      case 'sameDayConflict': return `${areaLbl} duplicada${dateSuffix}`;
      case 'gap': return `${areaLbl} — hueco${dateSuffix}`;
      case 'gapSoft': return `${areaLbl} — por encima de lo preferido${dateSuffix}`;
      case 'minimum': return `${areaLbl} bajo el mínimo semanal`;
      case 'maximum': return `${areaLbl} superó el techo semanal`;
      default: return w.message.length > 60 ? `${w.message.slice(0, 57)}…` : w.message;
    }
  }

  // Fila de burbujas (una al lado de la otra) + los paneles desplegados
  // debajo. `groupKeyPrefix` distingue esta grilla de cualquier otra que
  // pueda estar en pantalla al mismo tiempo (propuesta, semana anterior en
  // edición, corrección de mes), para que abrir una no afecte a las demás.
  function renderSeverityLog(warnings, groupKeyPrefix, studentsById, prefixFor) {
    if (!warnings.length) {
      return '<div class="alert ok">✓ Sin conflictos ni alertas detectadas.</div>';
    }
    const groups = {};
    warnings.forEach((w) => { (groups[w.severity] = groups[w.severity] || []).push(w); });
    const present = SEVERITY_ORDER.filter((sev) => groups[sev] && groups[sev].length);

    const bubbles = present.map((sev) => {
      const meta = SEVERITY_META[sev];
      const items = groups[sev];
      const groupKey = `${groupKeyPrefix}|${sev}`;
      const isOpen = expandedSeverityGroups.has(groupKey);
      return `<button type="button" class="severity-bubble ${meta.className} ${isOpen ? 'is-open' : ''}" data-action="toggle-severity-group" data-key="${escapeHtml(groupKey)}">
        <span class="severity-icon" aria-hidden="true">${meta.icon}</span>
        <span class="severity-label">${escapeHtml(meta.label)}</span>
        <span class="severity-count">${items.length}</span>
      </button>`;
    }).join('');

    const panels = present.filter((sev) => expandedSeverityGroups.has(`${groupKeyPrefix}|${sev}`)).map((sev) => {
      const meta = SEVERITY_META[sev];
      const items = groups[sev];
      const groupKey = `${groupKeyPrefix}|${sev}`;
      const needsSummary = items.length >= SUMMARY_THRESHOLD;
      const itemsHtml = items.map((w, idx) => {
        const prefixHtml = prefixFor ? escapeHtml(prefixFor(w)) : '';
        if (!needsSummary) {
          return `<div class="alert ${w.severity}">${prefixHtml}${escapeHtml(w.message)}</div>`;
        }
        const itemKey = `${groupKey}|${idx}`;
        const itemOpen = expandedConflictItems.has(itemKey);
        const label = itemOpen
          ? `${prefixHtml}${escapeHtml(w.message)}`
          : `${prefixHtml}${escapeHtml(conflictSummary(w, studentsById))}`;
        return `<button type="button" class="conflict-item alert ${w.severity} ${itemOpen ? 'is-open' : ''}" data-action="toggle-conflict-item" data-key="${escapeHtml(itemKey)}" title="${itemOpen ? 'Tocá para resumir' : 'Tocá para ver el conflicto completo'}">${label}</button>`;
      }).join('');
      return `<div class="severity-panel ${meta.className}">${itemsHtml}</div>`;
    }).join('');

    return `<div class="severity-log"><div class="severity-bubbles">${bubbles}</div>${panels}</div>`;
  }

  function renderAudit(audit, groupKeyPrefix, studentsById, prefixFor) {
    return renderSeverityLog(audit.warnings, groupKeyPrefix, studentsById || {}, prefixFor);
  }

  // Insignia compacta "asignados/esperados" para pegar al lado del título
  // de una semana (ej. "Semana 1 de Octubre... 19/19"). Si falta alguien,
  // es un botón con ⚠ + un "+"/"−" que despliega/resume el detalle (quién
  // falta) justo debajo, vía renderWeekCoverageDetail con la misma clave.
  function renderWeekCoverageBadge(students, weekLike, groupKey) {
    const coverage = Core.studentCoverageForWeek(students, weekLike);
    const countLabel = `${coverage.assignedCount}/${coverage.expectedCount}`;
    if (!coverage.missing.length) {
      return `<span class="week-badge ok">${countLabel}</span>`;
    }
    const isOpen = expandedSeverityGroups.has(groupKey);
    return `<button type="button" class="week-badge warn ${isOpen ? 'is-open' : ''}" data-action="toggle-severity-group" data-key="${escapeHtml(groupKey)}" title="${isOpen ? 'Tocá para resumir' : 'Tocá para ver quién falta'}">
      ${countLabel} <span aria-hidden="true">⚠</span> <span class="week-badge-toggle" aria-hidden="true">${isOpen ? '−' : '+'}</span>
    </button>`;
  }

  // Detalle de renderWeekCoverageBadge, solo si está desplegado — nada más
  // que los nombres de quienes falten.
  function renderWeekCoverageDetail(students, weekLike, groupKey) {
    if (!expandedSeverityGroups.has(groupKey)) return '';
    const coverage = Core.studentCoverageForWeek(students, weekLike);
    if (!coverage.missing.length) return '';
    return `<div class="alert error">${coverage.missing.map((m) => escapeHtml(m.name)).join(', ')}</div>`;
  }

  // Fila de burbujas S1, S2, S3... (una por semana del mes), coloreada
  // según el conflicto más grave que tenga esa semana (o verde si está
  // limpia). Tocar una burbuja despliega SUS conflictos, ordenados por
  // gravedad — igual que renderSeverityLog, resumidos a partir de 3. La
  // cobertura de becados NO va acá: se ve directo en la propia grilla,
  // pegada al rótulo "Semana N" (weekCoverageMarkerHtml).
  function renderWeekChipsLog(entries, groupKeyPrefix, studentsById) {
    const chips = entries.map(({ week, audit }) => {
      const gk = `${groupKeyPrefix}|w${week.weekIndex}`;
      const isOpen = expandedSeverityGroups.has(gk);
      const worst = worstSeverity(audit.warnings);
      const chipClass = worst ? SEVERITY_META[worst].className : 'sev-ok';
      return `<button type="button" class="severity-bubble week-chip ${chipClass} ${isOpen ? 'is-open' : ''}" data-action="toggle-severity-group" data-key="${escapeHtml(gk)}">
        <span class="severity-label">S${week.weekIndex}</span>
        ${audit.warnings.length ? `<span class="severity-count">${audit.warnings.length}</span>` : ''}
        <span class="week-badge-toggle" aria-hidden="true">${isOpen ? '−' : '+'}</span>
      </button>`;
    }).join('');

    const panels = entries.filter(({ week }) => expandedSeverityGroups.has(`${groupKeyPrefix}|w${week.weekIndex}`)).map(({ week, audit }) => {
      const gk = `${groupKeyPrefix}|w${week.weekIndex}`;
      const sorted = [...audit.warnings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
      const needsSummary = sorted.length >= SUMMARY_THRESHOLD;
      const conflictItemsHtml = sorted.map((w, idx) => {
        if (!needsSummary) return `<div class="alert ${w.severity}">${escapeHtml(w.message)}</div>`;
        const itemKey = `${gk}|${idx}`;
        const itemOpen = expandedConflictItems.has(itemKey);
        const itemLabel = itemOpen ? escapeHtml(w.message) : escapeHtml(conflictSummary(w, studentsById));
        return `<button type="button" class="conflict-item alert ${w.severity} ${itemOpen ? 'is-open' : ''}" data-action="toggle-conflict-item" data-key="${escapeHtml(itemKey)}" title="${itemOpen ? 'Tocá para resumir' : 'Tocá para ver el conflicto completo'}">${itemLabel}</button>`;
      }).join('');
      const emptyHtml = !sorted.length ? '<div class="alert ok">✓ Sin conflictos para esta semana.</div>' : '';
      return `<div class="severity-panel">${conflictItemsHtml}${emptyHtml}</div>`;
    }).join('');

    return `<div class="severity-log"><div class="severity-bubbles">${chips}</div>${panels}</div>`;
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
      const cellOpts = {
        selectAction: 'set-area',
        removeAction: target === 'draft' ? 'edit-week-remove-assignment' : 'remove-assignment',
        addAction: target === 'draft' ? 'edit-week-add-assignment' : 'add-assignment',
        extraAttrs: () => `data-target="${target}"`,
        cellKeyPrefix: `week|${target}|${proposal.startDate}`,
      };
      const cells = Core.AREAS.map((ar) => renderAssignmentCell(byArea[ar.id] || [], day, ar, studentsById, cellOpts)).join('');
      const addControl = renderDayAddControl(day, cellOpts);
      return `<tr class="dow-${day.dow}"><td>${dayCellHeadHtml(day, dateObj)}${addControl}</td>${cells}</tr>`;
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
      const gk = `audit|draft|${editingWeekDraft.startDate}`;
      return `
        <div class="card">
          <div class="week-card-head"><h3>${escapeHtml(heading)} <span class="muted">— ${escapeHtml(editingSubtitle)}</span></h3>${toggle}</div>
          <p class="muted">${escapeHtml(label)} ${renderWeekCoverageBadge(state.students, editingWeekDraft, `${gk}|coverage`)}</p>
          <div class="alert warning">Estás editando esta semana mientras revisás el resto. Los cambios se guardan al volver a bloquear (switch), y ahí se recalcula lo que dependa del historial nuevo.</div>
          <div class="audit-list">${renderAudit(ownAudit, gk, studentsById)}${renderWeekCoverageDetail(state.students, editingWeekDraft, `${gk}|coverage`)}</div>
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
    // El botón de pantalla completa y el aviso de "girá el celular" viven
    // fuera de este contenedor a propósito (en index.html, como estático),
    // para no perderlos cada vez que se re-renderiza este tab.
    const el = document.getElementById('generar-content');
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
          <h2>Propuesta: ${escapeHtml(label)} ${renderWeekCoverageBadge(state.students, proposal, `audit|proposal|${proposal.startDate}|coverage`)}</h2>
          <p class="muted">Editá el área de cada estudiante directo en la grilla. La IA nunca aplica esto por su cuenta: queda a la espera de que lo apruebes.</p>
          <div class="audit-list">${renderAudit(audit, `audit|proposal|${proposal.startDate}`, studentsById)}${renderWeekCoverageDetail(state.students, proposal, `audit|proposal|${proposal.startDate}|coverage`)}</div>
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
          ? renderEditableMonthGridTable(editingMonthDraft, studentsById, `grid|${closedKey}`)
          : renderMonthGridTable(weeksOfThatMonth, studentsById, `grid|${closedKey}`);

        const auditHtml = editing
          ? renderWeekChipsLog(auditMonthDraftByWeek(editingMonthDraft), `audit|month|${closedKey}`, studentsById)
          : '';

        const actionsHtml = editing ? `
            <div class="btn-row">
              <button class="btn" data-action="save-month-edit">Guardar corrección</button>
              <button class="btn secondary" data-action="regenerate-month">Regenerar mes automáticamente</button>
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

  async function handleDiscardClick() {
    if (!(await showConfirmModal('¿Descartar esta propuesta? No se guarda nada.'))) return;
    state.pendingProposal = null;
    saveState();
    renderGenerar();
  }

  async function handleApproveClick() {
    const proposal = state.pendingProposal;
    if (!proposal) return;
    const audit = Core.auditWeek(state.students, state.lockedWeeks, proposal);
    if (audit.warnings.length) {
      const ok = await showConfirmModal(`Hay ${audit.warnings.length} alerta(s) activa(s) para esta semana. ¿Confirmás bloquearla de todas formas?`);
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
  async function handleRequestMonthEdit(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const monthLabel = `${Core.MONTH_NAMES_ES[m - 1]} ${y}`;
    const ok = await showConfirmModal(`¿Estás seguro que querés editar el calendario de ${monthLabel}? Ya está cerrado — confirmá solo si estás seguro, no es para un click accidental.`);
    if (!ok) return;
    handleStartMonthEdit(monthKey);
  }

  function handleCancelMonthEdit() {
    editingMonthKey = null;
    editingMonthDraft = null;
    renderAll();
  }

  // "Regenerar mes automáticamente": vuelve a correr el algoritmo para
  // TODAS las semanas del mes en edición, sin importar cómo esté repartido
  // ahora mismo (manual o no) — busca de nuevo el mejor reparto posible.
  // Cada semana se recalcula contra el historial real que le corresponde
  // (lo de afuera del mes + lo que ya se recalculó de este mismo mes en las
  // semanas anteriores), igual que si se generaran una por una en orden,
  // para que el mes entero quede coherente entre sí, no solo semana por
  // semana. Es una foto nueva del borrador: no se guarda hasta "Guardar
  // corrección", así que "Cancelar" siempre puede volver atrás.
  function handleRegenerateMonthClick() {
    if (!editingMonthDraft) return;
    const draftStarts = new Set(editingMonthDraft.map((w) => w.startDate));
    let history = state.lockedWeeks.filter((w) => !draftStarts.has(w.startDate));
    editingMonthDraft = editingMonthDraft.map((week) => {
      const weekInfo = {
        index: week.weekIndex,
        year: week.year,
        month: week.month,
        start: Core.fromISO(week.startDate),
        end: Core.fromISO(week.endDate),
        days: week.days.map((d) => Core.fromISO(d.date)),
      };
      const proposal = Core.generateWeekProposal(state.students, history, weekInfo);
      history = [...history, proposal];
      return proposal;
    });
    renderAll();
    showToast('Mes regenerado automáticamente, semana por semana.');
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

  // Despliega/cierra el mini-formulario de "agregar estudiante a este día".
  // Solo estado de UI.
  function handleToggleDayAddForm(key) {
    if (expandedDayAddForms.has(key)) expandedDayAddForms.delete(key);
    else expandedDayAddForms.add(key);
    renderAll();
  }

  // Despliega/cierra el resumen de una burbuja de gravedad del LOG de
  // conflictos. Solo estado de UI.
  function handleToggleSeverityGroup(key) {
    if (expandedSeverityGroups.has(key)) expandedSeverityGroups.delete(key);
    else expandedSeverityGroups.add(key);
    renderAll();
  }

  // Despliega/resume un conflicto individual dentro de una burbuja ya
  // abierta (cuando hay 3 o más, cada uno arranca resumido). Solo estado de UI.
  function handleToggleConflictItem(key) {
    if (expandedConflictItems.has(key)) expandedConflictItems.delete(key);
    else expandedConflictItems.add(key);
    renderAll();
  }

  function handleAddMonthAssignment(weekStart, date, studentId, area) {
    const week = editingMonthDraft.find((w) => w.startDate === weekStart);
    const day = week && week.days.find((d) => d.date === date);
    const student = state.students.find((s) => s.id === studentId);
    if (!day || !student) return;
    day.assignments.push({ studentId, name: student.name, area });
    expandedDayAddForms.delete(`month|${weekStart}|${date}|add`);
    renderAll();
  }

  function handleRemoveMonthAssignment(weekStart, date, studentId) {
    const week = editingMonthDraft.find((w) => w.startDate === weekStart);
    const day = week && week.days.find((d) => d.date === date);
    if (!day) return;
    day.assignments = day.assignments.filter((a) => a.studentId !== studentId);
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

  function handleAddAssignment(date, studentId, area) {
    const day = state.pendingProposal.days.find((d) => d.date === date);
    const student = state.students.find((s) => s.id === studentId);
    if (!day || !student) return;
    day.assignments.push({ studentId, name: student.name, area });
    expandedDayAddForms.delete(`week|proposal|${state.pendingProposal.startDate}|${date}|add`);
    saveState();
    renderGenerar();
  }

  function handleRemoveAssignment(date, studentId) {
    const day = state.pendingProposal.days.find((d) => d.date === date);
    if (!day) return;
    day.assignments = day.assignments.filter((a) => a.studentId !== studentId);
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
    reader.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        showToast('El archivo no es una copia válida (JSON inválido).');
        return;
      }
      const ok = await showConfirmModal('¿Importar esta copia? Va a REEMPLAZAR toda la información actual (estudiantes, calendarios, meses cerrados) acá y en el servidor compartido. Esta acción no se puede deshacer.');
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
  async function handleDeleteStudent(id) {
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    if (!(await showConfirmModal(`¿Quitar la beca a ${student.name}? Esta acción no se puede deshacer. Su historial en semanas ya bloqueadas se conserva, pero dejará de aparecer en el calendario.`))) return;
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

  // Diagnóstico TEMPORAL y visible del bug de sincronización en celular —
  // se puede sacar (junto con syncDebug arriba) una vez resuelto.
  function syncDebugHtml() {
    const attemptsText = syncDebug.attempts.length
      ? syncDebug.attempts.map((a) => `#${a.n}: ${a.status}`).join(' · ')
      : 'ninguno todavía';
    return `<div class="sync-debug">
      <strong>Diagnóstico temporal de sincronización</strong><br>
      ¿Se hizo GET /api/state?: ${syncDebug.attempts.length ? 'sí' : 'no'}<br>
      Resultado de cada intento: ${escapeHtml(attemptsText)}<br>
      Resultado final: ${escapeHtml(syncDebug.outcome || '(todavía no terminó)')}<br>
      Calendarios anteriores (semanas) recibidos: ${syncDebug.lockedWeeksCount == null ? '?' : syncDebug.lockedWeeksCount}<br>
      Excepción de JavaScript: ${syncDebug.jsError ? escapeHtml(syncDebug.jsError) : 'ninguna'}
    </div>`;
  }

  function renderSemanas() {
    const el = document.getElementById('tab-semanas');
    const studentsById = Object.fromEntries(state.students.map((s) => [s.id, s]));

    if (!state.lockedWeeks.length) {
      el.innerHTML = syncDebugHtml() + '<div class="empty-state">Todavía no hay calendarios anteriores.</div>';
      return;
    }

    const monthKeys = [...new Set(state.lockedWeeks.map((w) => `${w.year}-${Core.pad2(w.month)}`))];
    const completeMonths = monthKeys
      .filter((key) => { const [y, m] = key.split('-').map(Number); return isMonthComplete(state.lockedWeeks, y, m); })
      .sort().reverse();

    if (!completeMonths.length) {
      el.innerHTML = syncDebugHtml() + '<div class="empty-state">Todavía no hay ningún mes completo — los calendarios en curso se ven en la pestaña Generar. Un mes aparece acá recién cuando está bloqueado hasta el último día.</div>';
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
        const auditHtml = renderWeekChipsLog(auditMonthDraftByWeek(editingMonthDraft), `audit|month|${key}`, studentsById);
        return `
        <div class="month-card-body">
          ${auditHtml}
          ${renderEditableMonthGridTable(editingMonthDraft, studentsById, `grid|${key}`)}
          <div class="btn-row">
            <button class="btn" data-action="save-month-edit">Guardar corrección</button>
            <button class="btn secondary" data-action="regenerate-month">Regenerar mes automáticamente</button>
            <button class="btn secondary" data-action="cancel-month-edit">Cancelar</button>
          </div>
        </div>`;
      };

      const viewBodyHtml = `
        <div class="month-card-body">
          ${renderMonthGridTable(weeksOfMonth, studentsById, `grid|${key}`)}
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

    el.innerHTML = syncDebugHtml() + monthCards;
  }

  function handleToggleMonth(key) {
    expandedMonthKey = expandedMonthKey === key ? null : key;
    renderSemanas();
  }

  async function handleUnlockWeek(startDate) {
    const week = state.lockedWeeks.find((w) => w.startDate === startDate);
    if (!week) return;
    const latest = [...state.lockedWeeks].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
    const message = latest.startDate === startDate
      ? '¿Desbloquear esta semana? Vuelve a quedar pendiente en la pestaña Generar y la podés proponer de nuevo.'
      : '¿Desbloquear esta semana? OJO: no es la última semana bloqueada — las semanas posteriores ya aprobadas no se recalculan solas y van a seguir basadas en el historial que tenían. Revisalas manualmente si hace falta.';
    if (!(await showConfirmModal(message))) return;
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

  function handleEditWeekAddAssignment(date, studentId, area) {
    const day = editingWeekDraft.days.find((d) => d.date === date);
    const student = state.students.find((s) => s.id === studentId);
    if (!day || !student) return;
    day.assignments.push({ studentId, name: student.name, area });
    expandedDayAddForms.delete(`week|draft|${editingWeekDraft.startDate}|${date}|add`);
    renderAll();
  }

  function handleEditWeekRemoveAssignment(date, studentId) {
    const day = editingWeekDraft.days.find((d) => d.date === date);
    if (!day) return;
    day.assignments = day.assignments.filter((a) => a.studentId !== studentId);
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
    ctx.font = `700 10.5px ${IMG_FONT}`;
    cols.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? MUTED : '#ffffff';
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
          ctx.fillStyle = i === 0 ? TEXT : '#ffffff';
          const label = i === 0 ? `SEMANA ${week.weekIndex}` : c.label.toUpperCase();
          ctx.fillText(label, dx + 10, y + dividerH / 2 + 1);
          dx += c.width;
        });
        y += dividerH;
      }

      week.days.forEach((day) => {
        const cellByArea = {};
        day.assignments.forEach((a) => {
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

  // Modo pantalla completa para Generar/edición, pensado para cuando hay
  // que armar el calendario desde el celular (no reemplaza el uso normal
  // en vertical, es un modo alternativo). Si el navegador no soporta la
  // Fullscreen API el botón queda oculto en vez de mostrarse roto — no
  // depende de HTTPS, así que anda igual detrás de Tailscale sin dominio.
  function initFullscreenToggle() {
    const btn = document.getElementById('fullscreen-toggle');
    if (!btn || !document.documentElement.requestFullscreen) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        return;
      }
      document.documentElement.requestFullscreen()
        .then(() => {
          // Mejor esfuerzo nomás: la mayoría de los navegadores solo
          // permiten fijar la orientación estando en pantalla completa, y
          // varios (Safari/iOS entre ellos) no lo soportan para nada —
          // por eso el catch queda mudo, no es un error real.
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
          }
        })
        .catch(() => showToast('No se pudo activar pantalla completa en este navegador.'));
    });
    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      btn.textContent = isFullscreen ? '✕ Salir de pantalla completa' : '⛶ Pantalla completa';
      document.body.classList.toggle('is-fullscreen', isFullscreen);
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
      else if (action === 'regenerate-month') handleRegenerateMonthClick();
      else if (action === 'toggle-conflict-cell') handleToggleConflictCell(btn.dataset.key);
      else if (action === 'toggle-day-add') handleToggleDayAddForm(btn.dataset.key);
      else if (action === 'toggle-severity-group') handleToggleSeverityGroup(btn.dataset.key);
      else if (action === 'toggle-conflict-item') handleToggleConflictItem(btn.dataset.key);
      else if (action === 'remove-assignment') handleRemoveAssignment(btn.dataset.date, btn.dataset.student);
      else if (action === 'edit-week-remove-assignment') handleEditWeekRemoveAssignment(btn.dataset.date, btn.dataset.student);
      else if (action === 'remove-month-assignment') handleRemoveMonthAssignment(btn.dataset.weekStart, btn.dataset.date, btn.dataset.student);
      else if (action === 'add-assignment' || action === 'edit-week-add-assignment' || action === 'add-month-assignment') {
        const form = btn.closest('.day-add-form');
        const studentId = form.querySelector('.day-add-student').value;
        const area = form.querySelector('.day-add-area').value;
        if (action === 'add-assignment') handleAddAssignment(btn.dataset.date, studentId, area);
        else if (action === 'edit-week-add-assignment') handleEditWeekAddAssignment(btn.dataset.date, studentId, area);
        else handleAddMonthAssignment(btn.dataset.weekStart, btn.dataset.date, studentId, area);
      }
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
      } else if (e.target.matches('select.day-add-student')) {
        updateDayAddAreaOptions(e.target);
      }
    });
  }

  // Al cambiar el estudiante elegido en el mini-formulario de "agregar",
  // recalcula las áreas del select vecino según a qué puede limpiar ese
  // estudiante en particular (mismo criterio que el resto de los selects).
  function updateDayAddAreaOptions(studentSelect) {
    const student = state.students.find((s) => s.id === studentSelect.value);
    const areaSelect = studentSelect.closest('.day-add-form').querySelector('.day-add-area');
    const elig = student ? Core.eligibleAreas(student) : Core.AREAS;
    areaSelect.innerHTML = elig.map((opt) => `<option value="${opt.id}">${escapeHtml(opt.label)}</option>`).join('');
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
      else if (action === 'regenerate-month') handleRegenerateMonthClick();
      else if (action === 'cancel-month-edit') handleCancelMonthEdit();
      else if (action === 'toggle-conflict-cell') handleToggleConflictCell(btn.dataset.key);
      else if (action === 'toggle-day-add') handleToggleDayAddForm(btn.dataset.key);
      else if (action === 'toggle-severity-group') handleToggleSeverityGroup(btn.dataset.key);
      else if (action === 'toggle-conflict-item') handleToggleConflictItem(btn.dataset.key);
      else if (action === 'remove-month-assignment') handleRemoveMonthAssignment(btn.dataset.weekStart, btn.dataset.date, btn.dataset.student);
      else if (action === 'add-month-assignment') {
        const form = btn.closest('.day-add-form');
        const studentId = form.querySelector('.day-add-student').value;
        const area = form.querySelector('.day-add-area').value;
        handleAddMonthAssignment(btn.dataset.weekStart, btn.dataset.date, studentId, area);
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('select[data-action="set-month-area"]')) {
        handleSetMonthArea(e.target.dataset.weekStart, e.target.dataset.date, e.target.dataset.student, e.target.value);
      } else if (e.target.matches('select.day-add-student')) {
        updateDayAddAreaOptions(e.target);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initFullscreenToggle();
    initGenerarEvents();
    initEstudiantesEvents();
    initSemanasEvents();
    const retryBtn = document.getElementById('offline-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => window.location.reload());
    await initState();
    renderAll();
    // Recién acá se destapa la app — hasta este punto, "Sincronizando
    // datos…" tapaba todo para que nunca se llegara a ver una pestaña
    // vacía o vieja como si fuera el calendario real.
    const overlay = document.getElementById('sync-overlay');
    if (overlay) overlay.remove();
  });
})();
