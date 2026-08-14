/*
 * core.js — lógica pura (sin DOM) del generador de calendario de limpieza.
 * Se carga como script normal en el navegador (expone window.Core) y también
 * es requerible desde Node para pruebas automatizadas (module.exports).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  }
  root.Core = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constantes de dominio
  // ---------------------------------------------------------------------

  const DOW_NAMES_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const MONTH_NAMES_ES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  // Orden fijo de columnas/áreas, tal como debe aparecer siempre en la UI.
  const AREAS = [
    { id: 'kitchen1', label: 'Cocina', points: 7, minWeekly: 4 },
    { id: 'kitchen2', label: 'Cocina 2', points: 5, minWeekly: 3 },
    { id: 'dining', label: 'Comedor', points: 7, minWeekly: 4 },
    { id: 'studyRoom', label: 'Sala Estudios', points: 5, minWeekly: 2 },
    { id: 'studyBathroom', label: 'Baño Estudios', points: 5, minWeekly: 2 },
    { id: 'laundry', label: 'Lavadero', points: 3, minWeekly: 1 },
    { id: 'stairs', label: 'Escaleras', points: 3, minWeekly: 1 },
  ];
  const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
  function areaLabel(id) { return AREA_BY_ID[id] ? AREA_BY_ID[id].label : id; }
  function areaPoints(id) { return AREA_BY_ID[id] ? AREA_BY_ID[id].points : 0; }

  // Roster inicial: 20 estudiantes, día fijo (1=Lunes..7=Domingo) y grupo de cocina.
  // k2 = solo puede limpiar Cocina 2 (nunca Cocina 1). k1 = el resto (nunca Cocina 2).
  const INITIAL_STUDENTS = [
    { id: 'darhian', name: 'Darhian', fixedDay: 1, kitchenGroup: 'k1', active: true },
    { id: 'lorenzo-c', name: 'Lorenzo C.', fixedDay: 1, kitchenGroup: 'k1', active: true },
    { id: 'pablo', name: 'Pablo', fixedDay: 1, kitchenGroup: 'k1', active: true },

    { id: 'joaquin', name: 'Joaquín', fixedDay: 2, kitchenGroup: 'k1', active: true },
    { id: 'florencia', name: 'Florencia', fixedDay: 2, kitchenGroup: 'k1', active: true },
    { id: 'angel', name: 'Ángel', fixedDay: 2, kitchenGroup: 'k2', active: true },

    { id: 'fernanda', name: 'Fernanda', fixedDay: 3, kitchenGroup: 'k1', active: true },
    { id: 'lautaro', name: 'Lautaro', fixedDay: 3, kitchenGroup: 'k2', active: true },
    { id: 'anthony', name: 'Anthony', fixedDay: 3, kitchenGroup: 'k2', active: true },

    { id: 'nadia', name: 'Nadia', fixedDay: 4, kitchenGroup: 'k1', active: true },
    { id: 'romina', name: 'Romina', fixedDay: 4, kitchenGroup: 'k1', active: true },
    { id: 'lucas-bz', name: 'Lucas Bz.', fixedDay: 4, kitchenGroup: 'k2', active: true },

    { id: 'soledad', name: 'Soledad', fixedDay: 5, kitchenGroup: 'k1', active: true },
    { id: 'lorenzo-g', name: 'Lorenzo G.', fixedDay: 5, kitchenGroup: 'k2', active: true },

    { id: 'kathleen', name: 'Kathleen', fixedDay: 6, kitchenGroup: 'k1', active: true },
    { id: 'paula', name: 'Paula', fixedDay: 6, kitchenGroup: 'k1', active: true },
    { id: 'lucas-brs', name: 'Lucas Brs.', fixedDay: 6, kitchenGroup: 'k2', active: true },

    { id: 'natasha', name: 'Natasha', fixedDay: 7, kitchenGroup: 'k1', active: true },
    { id: 'luana-r', name: 'Luana R.', fixedDay: 7, kitchenGroup: 'k1', active: true },
    { id: 'vitorio', name: 'Vitorio', fixedDay: 7, kitchenGroup: 'k2', active: true },
  ];

  // ---------------------------------------------------------------------
  // Utilidades de fecha
  // ---------------------------------------------------------------------

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
  function fromISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  // Lunes=1 ... Domingo=7 (ISO)
  function isoWeekdayMon1(date) { const dow = date.getDay(); return dow === 0 ? 7 : dow; }
  function mondayOf(date) { return addDays(date, -(isoWeekdayMon1(date) - 1)); }
  function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

  /**
   * Agrupa los días 1..último del mes por semana ISO (lunes a domingo),
   * sin cruzar nunca el límite del mes. La primera y última semana pueden
   * quedar parciales; las intermedias son siempre lunes-domingo completas.
   */
  function monthWeeks(year, month) {
    const total = daysInMonth(year, month);
    const groups = [];
    let currentMondayKey = null;
    let current = null;
    for (let d = 1; d <= total; d++) {
      const date = new Date(year, month - 1, d);
      const mKey = toISO(mondayOf(date));
      if (mKey !== currentMondayKey) {
        current = { days: [] };
        groups.push(current);
        currentMondayKey = mKey;
      }
      current.days.push(date);
    }
    return groups.map((g, idx) => ({
      index: idx + 1,
      year,
      month,
      start: g.days[0],
      end: g.days[g.days.length - 1],
      days: g.days,
    }));
  }

  function formatDateEs(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  }
  function formatWeekLabel(weekInfo) {
    return `Semana ${weekInfo.index} de ${MONTH_NAMES_ES[weekInfo.month - 1]} ${weekInfo.year} (${formatDateEs(weekInfo.start)} – ${formatDateEs(weekInfo.end)})`;
  }

  // ---------------------------------------------------------------------
  // Historial (siempre se lee de punta a punta, nunca se corta por mes)
  // ---------------------------------------------------------------------

  /** Aplana todas las semanas bloqueadas en una lista de asignaciones, ordenada por fecha ascendente. */
  function allAssignmentsSorted(lockedWeeks) {
    const out = [];
    for (const w of lockedWeeks) {
      for (const day of w.days) {
        for (const a of day.assignments) {
          out.push({ date: day.date, studentId: a.studentId, area: a.area, points: areaPoints(a.area) });
        }
      }
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }

  /**
   * Última área asignada a un estudiante antes de `beforeDateISO`, recorriendo
   * TODO el historial sin importar mes/semana calendario. Es la pieza clave de
   * la continuidad entre meses: no hay ningún corte especial en el límite de mes.
   */
  function lastAreaForStudent(sortedAssignments, studentId, beforeDateISO) {
    let result = null;
    for (const a of sortedAssignments) {
      if (a.date >= beforeDateISO) break;
      if (a.studentId === studentId) result = a.area;
    }
    return result;
  }

  function lastDoneDate(sortedAssignments, studentId, areaId, beforeDateISO) {
    let result = null;
    for (const a of sortedAssignments) {
      if (a.date >= beforeDateISO) break;
      if (a.studentId === studentId && a.area === areaId) result = a.date;
    }
    return result;
  }

  function totalPointsForStudent(sortedAssignments, studentId) {
    let sum = 0;
    for (const a of sortedAssignments) if (a.studentId === studentId) sum += a.points;
    return sum;
  }

  function countsForStudent(sortedAssignments, studentId) {
    const counts = {};
    AREAS.forEach((a) => { counts[a.id] = 0; });
    for (const a of sortedAssignments) if (a.studentId === studentId) counts[a.area]++;
    return counts;
  }

  // ---------------------------------------------------------------------
  // Equidad: terciles por carga acumulada
  // ---------------------------------------------------------------------

  const TIER_TARGET_POINTS = { low: 7, mid: 5, high: 3 };

  function computeTiers(activeStudents, sortedAssignments) {
    const withPoints = activeStudents.map((s) => ({
      id: s.id,
      name: s.name,
      points: totalPointsForStudent(sortedAssignments, s.id),
    }));
    withPoints.sort((a, b) => a.points - b.points || a.name.localeCompare(b.name, 'es'));
    const n = withPoints.length;
    const lowEnd = Math.ceil(n / 3);
    const midEnd = lowEnd + Math.ceil((n - lowEnd) / 2);
    const tierOf = {};
    withPoints.forEach((s, idx) => {
      tierOf[s.id] = idx < lowEnd ? 'low' : idx < midEnd ? 'mid' : 'high';
    });
    return tierOf;
  }

  function eligibleAreas(student) {
    return AREAS.filter((a) => {
      if (a.id === 'kitchen1' && student.kitchenGroup === 'k2') return false;
      if (a.id === 'kitchen2' && student.kitchenGroup === 'k1') return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // Resolución de un día (backtracking exacto sobre pocos estudiantes/día)
  // ---------------------------------------------------------------------

  function solveDay(dateISO, studentsToday, ctx) {
    const n = studentsToday.length;
    if (n === 0) return [];
    let best = null;
    let bestCost = Infinity;

    function costOf(student, area) {
      let cost = 0;
      const last = lastAreaForStudent(ctx.sortedAssignments, student.id, dateISO);
      if (last === area.id) cost += 1000; // evitar repetir área respecto a la última asignación registrada
      const target = TIER_TARGET_POINTS[ctx.tierOf[student.id]];
      cost += Math.abs(area.points - target) * 10; // equidad por terciles de carga
      const deficit = Math.max(0, area.minWeekly - (ctx.weekCounts[area.id] || 0));
      cost -= deficit * 6; // priorizar áreas que todavía no llegan al mínimo semanal
      const lastDone = lastDoneDate(ctx.sortedAssignments, student.id, area.id, dateISO);
      if (lastDone) {
        const daysSince = (fromISO(dateISO) - fromISO(lastDone)) / 86400000;
        cost -= Math.min(daysSince, 180) * 0.05; // desempate: prioriza a quien hace más que no hace esa área
      } else {
        cost -= 10; // nunca hizo esta área todavía
      }
      return cost;
    }

    function backtrack(i, usedSet, acc, accCost) {
      if (accCost >= bestCost) return;
      if (i === n) {
        bestCost = accCost;
        best = acc.slice();
        return;
      }
      const student = studentsToday[i];
      const elig = eligibleAreas(student).filter((a) => !usedSet.has(a.id));
      for (const area of elig) {
        usedSet.add(area.id);
        acc.push({ studentId: student.id, area: area.id });
        backtrack(i + 1, usedSet, acc, accCost + costOf(student, area));
        acc.pop();
        usedSet.delete(area.id);
      }
    }
    backtrack(0, new Set(), [], 0);
    return best || [];
  }

  /**
   * Genera la propuesta de una semana (aún no aprobada). `weekInfo` viene de
   * monthWeeks(). El historial que alimenta el algoritmo es SIEMPRE el
   * historial completo acumulado (lockedWeeks de todos los meses anteriores).
   */
  function generateWeekProposal(students, lockedWeeks, weekInfo) {
    const sortedAssignments = allAssignmentsSorted(lockedWeeks);
    const activeStudents = students.filter((s) => s.active);
    const tierOf = computeTiers(activeStudents, sortedAssignments);
    const weekCounts = {};
    AREAS.forEach((a) => { weekCounts[a.id] = 0; });
    const studentsById = Object.fromEntries(students.map((s) => [s.id, s]));

    const days = weekInfo.days.map((date) => {
      const dateISO = toISO(date);
      const dow = isoWeekdayMon1(date);
      const studentsToday = activeStudents.filter((s) => s.fixedDay === dow);
      const solved = solveDay(dateISO, studentsToday, { tierOf, sortedAssignments, weekCounts });
      solved.forEach((a) => { weekCounts[a.area] = (weekCounts[a.area] || 0) + 1; });
      return {
        date: dateISO,
        dow,
        assignments: solved.map((a) => ({ studentId: a.studentId, name: studentsById[a.studentId].name, area: a.area })),
      };
    });

    return {
      year: weekInfo.year,
      month: weekInfo.month,
      weekIndex: weekInfo.index,
      startDate: toISO(weekInfo.start),
      endDate: toISO(weekInfo.end),
      days,
    };
  }

  // ---------------------------------------------------------------------
  // Auditoría (nunca aplica cambios sola: solo detecta y reporta)
  // ---------------------------------------------------------------------

  function auditWeek(students, lockedWeeks, weekProposal) {
    const warnings = [];
    const sortedAssignments = allAssignmentsSorted(lockedWeeks);
    const studentsById = Object.fromEntries(students.map((s) => [s.id, s]));

    for (const day of weekProposal.days) {
      for (const a of day.assignments) {
        const last = lastAreaForStudent(sortedAssignments, a.studentId, day.date);
        if (last && last === a.area) {
          warnings.push({
            type: 'repeat',
            severity: 'error',
            date: day.date,
            studentId: a.studentId,
            message: `${a.name} repetiría "${areaLabel(a.area)}" respecto a su última asignación registrada (puede corresponder a la semana previa, incluso de otro mes).`,
          });
        }
      }
    }

    for (const day of weekProposal.days) {
      for (const a of day.assignments) {
        const student = studentsById[a.studentId];
        if (!student) continue;
        if (a.area === 'kitchen1' && student.kitchenGroup === 'k2') {
          warnings.push({ type: 'kitchenGroup', severity: 'error', date: day.date, studentId: a.studentId, message: `${a.name} es del grupo Cocina 2 y no puede limpiar Cocina.` });
        }
        if (a.area === 'kitchen2' && student.kitchenGroup === 'k1') {
          warnings.push({ type: 'kitchenGroup', severity: 'error', date: day.date, studentId: a.studentId, message: `${a.name} no pertenece al grupo Cocina 2 y no puede limpiar Cocina 2.` });
        }
      }
    }

    for (const day of weekProposal.days) {
      const seen = {};
      day.assignments.forEach((a) => { seen[a.area] = (seen[a.area] || 0) + 1; });
      Object.entries(seen).forEach(([area, count]) => {
        if (count > 1) {
          warnings.push({ type: 'sameDayConflict', severity: 'error', date: day.date, area, message: `Dos o más estudiantes coinciden en "${areaLabel(area)}" el ${day.date}.` });
        }
      });
    }

    const counts = {};
    AREAS.forEach((a) => { counts[a.id] = 0; });
    weekProposal.days.forEach((day) => day.assignments.forEach((a) => { counts[a.area]++; }));
    const isPartial = weekProposal.days.length < 7;
    AREAS.forEach((a) => {
      if (counts[a.id] < a.minWeekly) {
        warnings.push({
          type: 'minimum',
          severity: isPartial ? 'info' : 'warning',
          area: a.id,
          message: `"${a.label}" quedó con ${counts[a.id]} asignación(es) esta semana, por debajo del mínimo habitual (${a.minWeekly})${isPartial ? ' — semana parcial de inicio/fin de mes, puede ser esperable.' : '.'}`,
        });
      }
    });

    return { warnings, counts, isPartial };
  }

  // ---------------------------------------------------------------------
  // Próxima semana pendiente (cruza meses automáticamente)
  // ---------------------------------------------------------------------

  function getNextPendingWeekInfo(state) {
    let year, month, anchorDate;
    if (!state.lockedWeeks.length) {
      anchorDate = state.settings && state.settings.startDate ? fromISO(state.settings.startDate) : new Date();
      year = anchorDate.getFullYear();
      month = anchorDate.getMonth() + 1;
      const weeks = monthWeeks(year, month);
      return weeks[0];
    }
    const last = [...state.lockedWeeks].sort((a, b) => (a.endDate < b.endDate ? -1 : 1)).pop();
    const nextDate = addDays(fromISO(last.endDate), 1);
    year = nextDate.getFullYear();
    month = nextDate.getMonth() + 1;
    const weeks = monthWeeks(year, month);
    const nextISO = toISO(nextDate);
    return weeks.find((w) => toISO(w.start) === nextISO) || weeks.find((w) => w.days.some((d) => toISO(d) === nextISO));
  }

  return {
    DOW_NAMES_ES,
    MONTH_NAMES_ES,
    AREAS,
    AREA_BY_ID,
    INITIAL_STUDENTS,
    areaLabel,
    areaPoints,
    pad2,
    toISO,
    fromISO,
    addDays,
    isoWeekdayMon1,
    mondayOf,
    daysInMonth,
    monthWeeks,
    formatDateEs,
    formatWeekLabel,
    allAssignmentsSorted,
    lastAreaForStudent,
    lastDoneDate,
    totalPointsForStudent,
    countsForStudent,
    computeTiers,
    eligibleAreas,
    solveDay,
    generateWeekProposal,
    auditWeek,
    getNextPendingWeekInfo,
  };
});
