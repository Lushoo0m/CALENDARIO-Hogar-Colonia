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
  //  - maxWeekly = techo estricto semanal (null = sin techo, absorbe lo que sobre).
  //  - maxGapDays = cuántos días CALENDARIO seguidos puede quedar un área sin
  //    que nadie la limpie, como máximo — el día siguiente a ese límite ya
  //    tiene que tener a alguien sí o sí. Se cuenta cruzando semanas y meses
  //    sin cortes (para el algoritmo, las semanas son siempre continuas; los
  //    meses son solo un cierre administrativo para quien usa la app).
  //  - preferredGapDays = para áreas con dos niveles (Cocina 2): el límite
  //    "cómodo" que se intenta respetar siempre; maxGapDays es el límite
  //    duro que solo se toca si de verdad no queda otra opción.
  //  - rotationPriority = antes de repetir a alguien acá, tienen que haber
  //    pasado TODOS los estudiantes activos por esta área al menos una vez
  //    (rotación: Escaleras y Lavadero, tareas parejas para repartir en el año).
  const AREAS = [
    { id: 'kitchen1', label: 'Cocina', points: 7, minWeekly: 4, maxWeekly: null, maxGapDays: 1 },
    { id: 'kitchen2', label: 'Cocina 2', points: 5, minWeekly: 2, maxWeekly: 3, preferredGapDays: 3, maxGapDays: 4 },
    { id: 'dining', label: 'Comedor', points: 7, minWeekly: 4, maxWeekly: null, maxGapDays: 1 },
    { id: 'studyRoom', label: 'Sala Estudios', points: 5, minWeekly: 2, maxWeekly: 3, maxGapDays: 3 },
    { id: 'studyBathroom', label: 'Baño Estudios', points: 5, minWeekly: 2, maxWeekly: 3, maxGapDays: 3 },
    { id: 'laundry', label: 'Lavadero', points: 3, minWeekly: 1, maxWeekly: 1, rotationPriority: true },
    { id: 'stairs', label: 'Escaleras', points: 3, minWeekly: 1, maxWeekly: 1, rotationPriority: true },
  ];
  const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
  function areaLabel(id) { return AREA_BY_ID[id] ? AREA_BY_ID[id].label : id; }
  function areaPoints(id) { return AREA_BY_ID[id] ? AREA_BY_ID[id].points : 0; }

  // Roster inicial: 20 estudiantes, día fijo (1=Lunes..7=Domingo) y grupo de cocina.
  // k2 = solo puede limpiar Cocina 2 (nunca Cocina 1). k1 = el resto (nunca Cocina 2).
  // sex: 'M' (varón) / 'F' (mujer). fullName: nombre y apellido completo (Encomiendas
  // Núñez); name es el nombre corto que se usa en la grilla del calendario.
  const INITIAL_STUDENTS = [
    { id: 'darhian', name: 'Darhian', fullName: 'Darhian Martín Torres Galardi', sex: 'M', fixedDay: 1, kitchenGroup: 'k1', active: true },
    { id: 'lorenzo-c', name: 'Lorenzo C.', fullName: 'Lorenzo Coimbra Rodríguez', sex: 'M', fixedDay: 1, kitchenGroup: 'k1', active: true },
    { id: 'pablo', name: 'Pablo', fullName: 'Pablo Pereira', sex: 'M', fixedDay: 1, kitchenGroup: 'k1', active: true },

    { id: 'joaquin', name: 'Joaquín', fullName: 'Joaquín Techera Duarte', sex: 'M', fixedDay: 2, kitchenGroup: 'k1', active: true },
    { id: 'florencia', name: 'Florencia', fullName: 'Keyt Florencia Acuña Camargo', sex: 'F', fixedDay: 2, kitchenGroup: 'k1', active: true },
    { id: 'gaston', name: 'Gastón', fullName: 'Lucas Gastón Acuña Márquez', sex: 'M', fixedDay: 2, kitchenGroup: 'k2', active: true },

    { id: 'fernanda', name: 'Fernanda', fullName: 'Fernanda Patiño Hernández', sex: 'F', fixedDay: 3, kitchenGroup: 'k1', active: true },
    { id: 'lautaro', name: 'Lautaro', fullName: 'Lautaro Germán Taborda Taborda', sex: 'M', fixedDay: 3, kitchenGroup: 'k2', active: true },
    { id: 'anthony', name: 'Anthony', fullName: 'Anthony Nahuel Correa Buzó', sex: 'M', fixedDay: 3, kitchenGroup: 'k2', active: true },

    { id: 'nadia', name: 'Nadia', fullName: 'Nadia Sofía Hernández Bertoche', sex: 'F', fixedDay: 4, kitchenGroup: 'k1', active: true },
    { id: 'romina', name: 'Romina', fullName: 'Romina Tahiná Moreira González', sex: 'F', fixedDay: 4, kitchenGroup: 'k1', active: true },
    { id: 'lucas-bz', name: 'Lucas Bz.', fullName: 'Lucas Rafael Buzó Oxley', sex: 'M', fixedDay: 4, kitchenGroup: 'k2', active: true },

    { id: 'soledad', name: 'Soledad', fullName: 'Noelia Soledad Gallo Pinto', sex: 'F', fixedDay: 5, kitchenGroup: 'k1', active: true },
    { id: 'lorenzo-g', name: 'Lorenzo G.', fullName: 'Lorenzo González Márquez', sex: 'M', fixedDay: 5, kitchenGroup: 'k2', active: true },

    { id: 'kathleen', name: 'Kathleen', fullName: 'Kathleen Aylin Sosa Antúnez', sex: 'F', fixedDay: 6, kitchenGroup: 'k1', active: true },
    { id: 'paula', name: 'Paula', fullName: 'Paula Micaela Rosas Aire', sex: 'F', fixedDay: 6, kitchenGroup: 'k1', active: true },
    { id: 'lucas-brs', name: 'Lucas Brs.', fullName: 'Lucas Brasesco González', sex: 'M', fixedDay: 6, kitchenGroup: 'k2', active: true },

    { id: 'natasha', name: 'Natasha', fullName: 'Carmen Natasha Silvera Ramos', sex: 'F', fixedDay: 7, kitchenGroup: 'k1', active: true },
    { id: 'luana-r', name: 'Luana R.', fullName: 'Luana R.', sex: null, fixedDay: 7, kitchenGroup: 'k1', active: true },
    { id: 'vitorio', name: 'Vitorio', fullName: 'Vitorio Olivera', sex: 'M', fixedDay: 7, kitchenGroup: 'k2', active: true },
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

  // ---------------------------------------------------------------------
  // Días máximos sin limpiar por área (maxGapDays) — se usa tanto para
  // detectar el hueco (auditWeek) como para intentar taparlo al generar
  // (repairGapViolations). Siempre mirando el historial completo, así el
  // conteo cruza semanas y meses sin cortarse nunca.
  // ---------------------------------------------------------------------

  /** Fechas (YYYY-MM-DD) donde un área ya fue cubierta, según el historial. */
  function areaCoveredDatesFromHistory(sortedAssignments, areaId) {
    const set = new Set();
    for (const a of sortedAssignments) if (a.area === areaId) set.add(a.date);
    return set;
  }

  /**
   * Para cada fecha de `orderedDates` (días de calendario consecutivos, sin
   * huecos entre sí), cuántos días seguidos LLEVA sin cubrirse un área hasta
   * esa fecha inclusive (0 si esa fecha está cubierta).
   */
  function gapStreaksByDate(coveredDates, orderedDates) {
    const streaks = {};
    let streak = 0;
    for (const dateISO of orderedDates) {
      streak = coveredDates.has(dateISO) ? 0 : streak + 1;
      streaks[dateISO] = streak;
    }
    return streaks;
  }

  /**
   * Lista de días de calendario consecutivos (reales, sin huecos) desde
   * `lookbackDays` antes de `firstDateISO` hasta `lastDateISO`. Si hay
   * historial, el punto de partida nunca retrocede antes de la fecha más
   * antigua conocida (para no inventar "días fantasma" sin datos antes de
   * que el calendario existiera).
   */
  function extendedDateRange(firstDateISO, lastDateISO, lookbackDays, earliestKnownDateISO) {
    let start = fromISO(firstDateISO);
    if (lookbackDays > 0) {
      start = addDays(start, -lookbackDays);
      if (earliestKnownDateISO && toISO(start) < earliestKnownDateISO) start = fromISO(earliestKnownDateISO);
    }
    const end = fromISO(lastDateISO);
    const dates = [];
    for (let cur = start; cur <= end; cur = addDays(cur, 1)) dates.push(toISO(cur));
    return dates;
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

  /**
   * Para MOSTRAR en pantalla (badge de carga por estudiante): dos estados
   * nomás, liviano/a ('low') o sobrecargado/a ('high'), cortando por la
   * mediana de puntos. Un empate exacto de puntos en el corte nunca separa
   * a dos estudiantes con la misma carga en estados distintos, aunque la
   * mitad quede despareja. No se usa para el algoritmo de asignación — ahí
   * importa que el corte sea siempre el mismo (computeTiers de arriba), no
   * que se vea "prolijo".
   */
  function computeDisplayTiers(activeStudents, sortedAssignments) {
    const withPoints = activeStudents.map((s) => ({
      id: s.id,
      points: totalPointsForStudent(sortedAssignments, s.id),
    }));
    withPoints.sort((a, b) => a.points - b.points);
    const n = withPoints.length;
    let cut = Math.ceil(n / 2);
    while (cut > 0 && cut < n && withPoints[cut].points === withPoints[cut - 1].points) cut++;
    const tierOf = {};
    withPoints.forEach((s, idx) => {
      tierOf[s.id] = idx < cut ? 'low' : 'high';
    });
    return tierOf;
  }

  // Sistema de comportamiento: independiente de la carga de limpieza.
  // Cada estudiante acumula votos positivos/negativos (botones + / - en la
  // pestaña Estudiantes) y el ícono de cooperación se asigna solo, según la
  // diferencia entre ambos — nunca se elige a mano.
  //   diferencia > umbral  -> cooperativo/a (👏)
  //   diferencia < -umbral -> no colabora (🎯)
  //   |diferencia| <= umbral -> neutral / balanza de equilibrio (⚖️)
  const COOP_BALANCE_THRESHOLD = 15;

  function computeCoopTag(positive, negative) {
    const diff = (positive || 0) - (negative || 0);
    if (diff > COOP_BALANCE_THRESHOLD) return 'cooperative';
    if (diff < -COOP_BALANCE_THRESHOLD) return 'noncooperative';
    return 'neutral';
  }

  function eligibleAreas(student) {
    return AREAS.filter((a) => {
      if (a.id === 'kitchen1' && student.kitchenGroup === 'k2') return false;
      if (a.id === 'kitchen2' && student.kitchenGroup === 'k1') return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // Resolución de una semana: dos fases para que los techos semanales se
  // repartan con visión de conjunto sin que el backtracking explote en
  // tiempo (resolver los ~20 estudiantes de la semana como un solo
  // problema combinatorio es intratable; día por día sin más es rápido
  // pero "gasta" cupos de forma miope). Se combinan ambas ventajas:
  //
  //  Fase 1 — computeWeekQuota: con el total de asignaciones de la semana
  //  (que SÍ se conoce de entrada, sin importar en qué día caiga cada una),
  //  reparte cuánto le toca a cada área en toda la semana: primero cubre
  //  los mínimos, después reparte el resto en Cocina y Comedor (sin techo).
  //  Esto ya respeta los techos por construcción, con visión completa.
  //
  //  Fase 2 — solveDayAgainstQuota: recorre los días en orden cronológico
  //  y resuelve cada día (backtracking exacto, pocos estudiantes/día) contra
  //  la cuota restante, igual que antes pero ahora la cuota no se agota por
  //  casualidad del orden de los días.
  // ---------------------------------------------------------------------

  function computeWeekQuota(totalTasks) {
    const quota = {};
    AREAS.forEach((a) => { quota[a.id] = 0; });
    let remaining = totalTasks;
    AREAS.forEach((a) => {
      const cap = a.maxWeekly == null ? Infinity : a.maxWeekly;
      const take = Math.max(0, Math.min(a.minWeekly, cap - quota[a.id], remaining));
      quota[a.id] += take;
      remaining -= take;
    });
    const flexible = AREAS.filter((a) => a.maxWeekly == null); // Cocina y Comedor: sin techo, absorben el resto
    let idx = 0;
    while (remaining > 0 && flexible.length) {
      quota[flexible[idx % flexible.length].id]++;
      remaining--;
      idx++;
    }
    // Caso límite (no debería darse con la configuración actual: siempre hay
    // áreas sin techo): si aun así sobra demanda, se reparte igual para que
    // nadie quede sin asignar; auditWeek lo reportará como techo superado.
    idx = 0;
    while (remaining > 0) {
      quota[AREAS[idx % AREAS.length].id]++;
      remaining--;
      idx++;
    }
    return quota;
  }

  function solveDayAgainstQuota(dateISO, studentsToday, ctx) {
    const n = studentsToday.length;
    if (n === 0) return [];

    // Costo único (una sola búsqueda, sin pases "estricto/relajado" por
    // separado): así repetir área y exceder la cuota semanal compiten en el
    // mismo término y gana siempre la opción realmente menos mala, en vez de
    // que una regla "gane" a la otra solo por el orden en que se evalúan.
    function costOf(student, area) {
      let cost = 0;
      const last = lastAreaForStudent(ctx.sortedAssignments, student.id, dateISO);
      if (last === area.id) cost += 1000; // evitar repetir área respecto a la última asignación registrada
      const target = TIER_TARGET_POINTS[ctx.tierOf[student.id]];
      cost += Math.abs(area.points - target) * 10; // equidad por terciles de carga
      const deficit = Math.max(0, (ctx.quota[area.id] || 0) - (ctx.weekCounts[area.id] || 0));
      cost -= deficit * 6; // usar la cuota disponible en vez de dejarla sin tocar (evita que se amontone en pocas áreas)
      const overBy = Math.max(0, (ctx.weekCounts[area.id] || 0) + 1 - (ctx.quota[area.id] || 0));
      cost += overBy * 700; // techo semanal: muy penalizado si igual hay que excederlo (último recurso)
      if (area.id === 'dining' && student.kitchenGroup === 'k2') cost -= 300; // Comedor es su ÚNICO respaldo sin techo (no pueden limpiar Cocina): dárselo a ellos libera Cocina para el resto
      if (area.rotationPriority) {
        const timesDoneEver = countsForStudent(ctx.sortedAssignments, student.id)[area.id];
        cost += timesDoneEver * 400; // rotación: nadie repite acá hasta que todos los activos hayan pasado al menos una vez
      }
      const lastDone = lastDoneDate(ctx.sortedAssignments, student.id, area.id, dateISO);
      if (lastDone) {
        const daysSince = (fromISO(dateISO) - fromISO(lastDone)) / 86400000;
        cost -= Math.min(daysSince, 180) * 0.05; // desempate: prioriza a quien hace más que no hace esa área
      } else {
        cost -= 10; // nunca hizo esta área todavía
      }
      return cost;
    }

    let best = null;
    let bestCost = Infinity;
    function backtrack(i, usedSet, acc, accCost) {
      if (accCost >= bestCost) return;
      if (i === n) { bestCost = accCost; best = acc.slice(); return; }
      const student = studentsToday[i];
      const elig = eligibleAreas(student).filter((a) => !usedSet.has(a.id));
      const scored = elig.map((a) => ({ area: a, cost: costOf(student, a) })).sort((x, y) => x.cost - y.cost);
      for (const { area, cost } of scored) {
        usedSet.add(area.id);
        acc.push({ studentId: student.id, area: area.id });
        backtrack(i + 1, usedSet, acc, accCost + cost);
        acc.pop();
        usedSet.delete(area.id);
      }
    }
    backtrack(0, new Set(), [], 0);
    return best || [];
  }

  // Cuenta cuántos estudiantes de un día son del grupo Cocina 2: para ellos
  // Comedor es el único respaldo sin techo (Cocina les está vedada), así que
  // un día con muchos es más "ajustado" que uno con solo estudiantes del
  // grupo Cocina (que tienen Cocina Y Comedor como respaldo).
  function dayTightness(studentsToday) {
    if (!studentsToday.length) return 0;
    const k2 = studentsToday.filter((s) => s.kitchenGroup === 'k2').length;
    return k2 / studentsToday.length;
  }

  function solveWeek(tasks, ctx) {
    if (!tasks.length) return [];
    const quota = computeWeekQuota(tasks.length); // objetivo fijo por área para toda la semana
    const weekCounts = {};
    AREAS.forEach((a) => { weekCounts[a.id] = 0; });
    const byDate = new Map();
    tasks.forEach((t) => {
      if (!byDate.has(t.dateISO)) byDate.set(t.dateISO, []);
      byDate.get(t.dateISO).push(t.student);
    });

    // Resolver primero los días más ajustados (más estudiantes de Cocina 2)
    // para que no se queden sin cupo por culpa de días más flexibles que ya
    // consumieron el cupo compartido de áreas sin techo. El resultado igual
    // se devuelve indexado por fecha real, sin importar este orden interno.
    const datesByTightness = [...byDate.keys()].sort((a, b) => {
      const diff = dayTightness(byDate.get(b)) - dayTightness(byDate.get(a));
      if (diff !== 0) return diff;
      return a < b ? -1 : 1; // empate: orden cronológico, para que sea determinístico
    });

    const results = [];
    for (const dateISO of datesByTightness) {
      const studentsToday = byDate.get(dateISO);
      const solved = solveDayAgainstQuota(dateISO, studentsToday, { tierOf: ctx.tierOf, sortedAssignments: ctx.sortedAssignments, quota, weekCounts });
      solved.forEach((a) => {
        weekCounts[a.area] = (weekCounts[a.area] || 0) + 1;
        results.push({ studentId: a.studentId, area: a.area, date: dateISO });
      });
    }

    const studentById = Object.fromEntries(tasks.map((t) => [t.student.id, t.student]));
    const orderedDates = [...byDate.keys()].sort();
    const afterCaps = repairCapOverruns(results, studentById, ctx.sortedAssignments);
    return repairGapViolations(afterCaps, studentById, ctx.sortedAssignments, orderedDates);
  }

  /**
   * Tercera pasada: para las áreas con `maxGapDays` (Cocina, Comedor, Sala,
   * Baño, Cocina 2) no puede quedar más días calendario seguidos sin nadie
   * asignado que ese límite — contando también los últimos días del
   * historial (semana/mes anterior), para que el chequeo sea continuo. Por
   * cada fecha de la propuesta que rompería el límite, busca (retrocediendo
   * dentro de la propia racha, sin tocar semanas ya bloqueadas) a un
   * estudiante elegible para mover hacia esa área. Si no encuentra a quién
   * mover, el hueco queda y auditWeek lo reporta como conflicto.
   */
  function repairGapViolations(results, studentById, sortedAssignments, orderedDates) {
    const gapAreas = AREAS.filter((a) => a.maxGapDays != null);
    if (!gapAreas.length || !orderedDates.length) return results;

    const earliestKnown = sortedAssignments.length ? sortedAssignments[0].date : null;
    const firstDate = orderedDates[0];
    const lastDate = orderedDates[orderedDates.length - 1];
    const proposalDates = new Set(orderedDates);

    gapAreas.forEach((area) => {
      const lookback = earliestKnown ? area.maxGapDays : 0;
      const fullRange = extendedDateRange(firstDate, lastDate, lookback, earliestKnown);

      let safety = 0;
      let fixedSomething = true;
      while (fixedSomething && safety < 20) {
        fixedSomething = false;
        safety++;
        const covered = areaCoveredDatesFromHistory(sortedAssignments, area.id);
        results.forEach((r) => { if (r.area === area.id) covered.add(r.date); });
        const streaks = gapStreaksByDate(covered, fullRange);

        for (const dateISO of fullRange) {
          if (!proposalDates.has(dateISO)) continue; // no se puede tocar una semana ya bloqueada
          if (streaks[dateISO] <= area.maxGapDays) continue;

          let streakStart = fromISO(dateISO);
          for (let back = 1; back < streaks[dateISO]; back++) streakStart = addDays(streakStart, -1);

          let fixed = false;
          for (let d = fromISO(dateISO); d >= streakStart; d = addDays(d, -1)) {
            const dISO = toISO(d);
            if (!proposalDates.has(dISO)) continue;
            const candidates = results
              .filter((r) => r.date === dISO && r.area !== area.id)
              .sort((a, b) => (AREA_BY_ID[a.area].maxGapDays != null ? 1 : 0) - (AREA_BY_ID[b.area].maxGapDays != null ? 1 : 0));
            for (const r of candidates) {
              const student = studentById[r.studentId];
              if (!student) continue;
              if (!eligibleAreas(student).some((a) => a.id === area.id)) continue;
              if (lastAreaForStudent(sortedAssignments, student.id, dISO) === area.id) continue;
              r.area = area.id;
              fixed = true;
              break;
            }
            if (fixed) break;
          }
          if (fixed) { fixedSomething = true; break; }
        }
      }
    });
    return results;
  }

  /**
   * Segunda pasada: la búsqueda día a día (aunque procesa primero los días
   * más ajustados) igual puede dejar algún área semanal por encima de su
   * techo si esa fue la única forma de no dejar a alguien sin asignar ese
   * día. Acá se intenta "reparar" cada excedente con un intercambio: mover
   * a UN estudiante de esa asignación hacia otra área elegible, del mismo
   * día, que no esté ya usada ese día, que no le genere una repetición, y
   * que no esté ya en su propio techo. Si no hay ningún intercambio válido,
   * el excedente queda como está y auditWeek lo reporta como conflicto —
   * nunca se fuerza en silencio ni se deja a nadie sin asignar.
   */
  function repairCapOverruns(results, studentById, sortedAssignments) {
    const usedByDate = {};
    results.forEach((r) => {
      usedByDate[r.date] = usedByDate[r.date] || new Set();
      usedByDate[r.date].add(r.area);
    });
    const weekCounts = {};
    AREAS.forEach((a) => { weekCounts[a.id] = 0; });
    results.forEach((r) => { weekCounts[r.area]++; });

    let iterations = 0;
    let changed = true;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      for (const area of AREAS) {
        if (area.maxWeekly == null || weekCounts[area.id] <= area.maxWeekly) continue;
        const candidates = results.filter((r) => r.area === area.id);
        for (const r of candidates) {
          const student = studentById[r.studentId];
          const lastArea = lastAreaForStudent(sortedAssignments, student.id, r.date);
          const alternatives = eligibleAreas(student)
            .filter((a) => a.id !== area.id)
            .filter((a) => !usedByDate[r.date].has(a.id))
            .filter((a) => a.id !== lastArea)
            .filter((a) => a.maxWeekly == null || weekCounts[a.id] < a.maxWeekly)
            .sort((a, b) => (weekCounts[a.id] - a.minWeekly) - (weekCounts[b.id] - b.minWeekly)); // preferir la que más lejos está de su propio mínimo
          if (alternatives.length) {
            const newArea = alternatives[0];
            usedByDate[r.date].delete(area.id);
            usedByDate[r.date].add(newArea.id);
            weekCounts[area.id]--;
            weekCounts[newArea.id]++;
            r.area = newArea.id;
            changed = true;
            break;
          }
        }
      }
    }
    return results;
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
    const studentsById = Object.fromEntries(students.map((s) => [s.id, s]));

    const tasks = [];
    weekInfo.days.forEach((date) => {
      const dateISO = toISO(date);
      const dow = isoWeekdayMon1(date);
      activeStudents.filter((s) => s.fixedDay === dow).forEach((s) => tasks.push({ dateISO, dow, student: s }));
    });
    const solved = solveWeek(tasks, { tierOf, sortedAssignments });
    const solvedByKey = new Map(solved.map((a) => [`${a.date}|${a.studentId}`, a.area]));

    const days = weekInfo.days.map((date) => {
      const dateISO = toISO(date);
      const dow = isoWeekdayMon1(date);
      const studentsToday = activeStudents.filter((s) => s.fixedDay === dow);
      return {
        date: dateISO,
        dow,
        assignments: studentsToday.map((s) => ({
          studentId: s.id,
          name: studentsById[s.id].name,
          area: solvedByKey.get(`${dateISO}|${s.id}`),
        })),
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

    const gapAreas = AREAS.filter((a) => a.maxGapDays != null);
    if (gapAreas.length && weekProposal.days.length) {
      const earliestKnown = sortedAssignments.length ? sortedAssignments[0].date : null;
      const firstDate = weekProposal.days[0].date;
      const lastDate = weekProposal.days[weekProposal.days.length - 1].date;
      const proposalDates = new Set(weekProposal.days.map((d) => d.date));

      gapAreas.forEach((area) => {
        const lookback = earliestKnown ? area.maxGapDays : 0;
        const fullRange = extendedDateRange(firstDate, lastDate, lookback, earliestKnown);
        const covered = areaCoveredDatesFromHistory(sortedAssignments, area.id);
        weekProposal.days.forEach((day) => {
          if (day.assignments.some((a) => a.area === area.id)) covered.add(day.date);
        });
        const streaks = gapStreaksByDate(covered, fullRange);
        const softLimit = area.preferredGapDays != null ? area.preferredGapDays : area.maxGapDays;

        fullRange.forEach((dateISO) => {
          if (!proposalDates.has(dateISO)) return; // no repetir avisos de semanas ya bloqueadas
          const streak = streaks[dateISO];
          if (streak > area.maxGapDays) {
            warnings.push({
              type: 'gap',
              severity: 'error',
              area: area.id,
              date: dateISO,
              message: `"${area.label}" llevaría ${streak} días seguidos sin limpiarse (contando desde semanas anteriores si corresponde) hasta el ${dateISO} — supera el máximo permitido de ${area.maxGapDays} día(s). Revisar manualmente.`,
            });
          } else if (streak > softLimit) {
            warnings.push({
              type: 'gapSoft',
              severity: 'warning',
              area: area.id,
              date: dateISO,
              message: `"${area.label}" llevaría ${streak} días seguidos sin limpiarse hasta el ${dateISO} — por encima de lo preferido (${softLimit}), aunque todavía dentro del máximo tolerado (${area.maxGapDays}).`,
            });
          }
        });
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
      if (a.maxWeekly != null && counts[a.id] > a.maxWeekly) {
        warnings.push({
          type: 'maximum',
          severity: 'error',
          area: a.id,
          message: `"${a.label}" superó el techo semanal estricto: ${counts[a.id]} asignación(es) contra un máximo de ${a.maxWeekly}. Revisar manualmente cuál de esas asignaciones mover a otra área.`,
        });
      }
    });

    return { warnings, counts, isPartial };
  }

  // Compara cuántos estudiantes con beca (active) corresponden a esta semana
  // (según su día fijo) contra cuántos quedaron realmente asignados a algún
  // área. En una semana completa, expectedCount == totalActive (los 20); en
  // una semana parcial de inicio/fin de mes, expectedCount puede ser menor
  // porque algunos días fijos ni siquiera caen dentro de esta semana.
  function studentCoverageForWeek(students, weekProposal) {
    const activeStudents = students.filter((s) => s.active);
    const daysDow = new Set(weekProposal.days.map((d) => d.dow));
    const expected = activeStudents.filter((s) => daysDow.has(s.fixedDay));
    const assignedIds = new Set();
    weekProposal.days.forEach((day) => day.assignments.forEach((a) => assignedIds.add(a.studentId)));
    const missing = expected.filter((s) => !assignedIds.has(s.id));
    return {
      totalActive: activeStudents.length,
      expectedCount: expected.length,
      assignedCount: expected.length - missing.length,
      missing: missing.map((s) => ({ id: s.id, name: s.name })),
    };
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
    computeDisplayTiers,
    COOP_BALANCE_THRESHOLD,
    computeCoopTag,
    eligibleAreas,
    solveWeek,
    generateWeekProposal,
    auditWeek,
    studentCoverageForWeek,
    getNextPendingWeekInfo,
  };
});
