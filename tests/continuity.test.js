/*
 * Pruebas de consola (Node, sin DOM) para el motor de generación.
 * Ejecutar con: node tests/continuity.test.js
 *
 * Objetivo principal: demostrar que la rotación de áreas NO se reinicia
 * entre meses, es decir, que al generar la primera semana de un mes nuevo
 * el algoritmo respeta la última área asignada en la última semana
 * bloqueada del mes anterior — tratándolas como semanas consecutivas.
 */
const assert = require('assert');
const Core = require('../core.js');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`OK   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function lockWeek(students, lockedWeeks, weekInfo) {
  const proposal = Core.generateWeekProposal(students, lockedWeeks, weekInfo);
  const audit = Core.auditWeek(students, lockedWeeks, proposal);
  lockedWeeks.push(proposal);
  return { proposal, audit };
}

// Convierte un weekInfo de Core.monthWeeks() (days = Date[]) a la forma de
// semana ya "armada" (days = [{date, dow, assignments}]) que esperan
// Core.auditWeek / Core.studentCoverageForWeek. `assignmentsByDow` deja
// poner asignaciones a mano en un día puntual de la semana, por dow (1-7).
function toWeekShape(weekInfo, assignmentsByDow) {
  return {
    year: weekInfo.year,
    month: weekInfo.month,
    weekIndex: weekInfo.index,
    startDate: Core.toISO(weekInfo.start),
    endDate: Core.toISO(weekInfo.end),
    days: weekInfo.days.map((date) => {
      const dow = Core.isoWeekdayMon1(date);
      return { date: Core.toISO(date), dow, assignments: (assignmentsByDow && assignmentsByDow[dow]) || [] };
    }),
  };
}

// ---------------------------------------------------------------------
// 1. monthWeeks(): verificar el ejemplo exacto del enunciado (julio 2026)
// ---------------------------------------------------------------------
check('monthWeeks julio 2026 produce 5 semanas con los cortes esperados', () => {
  const weeks = Core.monthWeeks(2026, 7);
  assert.strictEqual(weeks.length, 5);
  const fmt = (w) => `${Core.formatDateEs(w.start)}-${Core.formatDateEs(w.end)}`;
  assert.strictEqual(fmt(weeks[0]), '01/07-05/07'); // mié 1 a dom 5
  assert.strictEqual(fmt(weeks[1]), '06/07-12/07'); // lun a dom
  assert.strictEqual(fmt(weeks[2]), '13/07-19/07');
  assert.strictEqual(fmt(weeks[3]), '20/07-26/07');
  assert.strictEqual(fmt(weeks[4]), '27/07-31/07'); // lun 27 a vie 31 (parcial)
  weeks.forEach((w) => w.days.forEach((d) => assert.strictEqual(d.getMonth(), 6)));
});

// ---------------------------------------------------------------------
// 2. Continuidad de rotación cruzando agosto -> septiembre 2026
// ---------------------------------------------------------------------
check('la última semana de agosto y la primera semana de septiembre con Lunes se tratan como consecutivas', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  let lockedWeeks = [];

  // Generar y bloquear TODAS las semanas de agosto 2026.
  const augWeeks = Core.monthWeeks(2026, 8);
  augWeeks.forEach((w) => lockWeek(students, lockedWeeks, w));

  const lastAugWeek = lockedWeeks[lockedWeeks.length - 1];
  assert.strictEqual(lastAugWeek.month, 8);
  // Agosto 2026 tiene 31 días; el 31/8 es lunes, así que la última semana de
  // agosto es una semana parcial de un solo día (lunes 31).
  assert.strictEqual(lastAugWeek.endDate, '2026-08-31');

  // Área asignada a cada estudiante de Lunes en esa última semana de agosto.
  const lastAreaByStudent = {};
  lastAugWeek.days.forEach((day) => day.assignments.forEach((a) => { lastAreaByStudent[a.studentId] = a.area; }));
  assert.ok(Object.keys(lastAreaByStudent).length > 0, 'la última semana de agosto debe tener asignaciones');

  // Septiembre 2026 empieza martes 1/9, así que su Semana 1 (mar 1 a dom 6) NO
  // contiene ningún lunes: los estudiantes de "Lunes" no vuelven a aparecer
  // hasta la Semana 2 de septiembre (lun 7 a dom 13). El algoritmo debe seguir
  // comparando contra la última área de agosto en ese momento, sin importar
  // que haya una semana de septiembre completa de por medio sin ellos.
  const state = { lockedWeeks, settings: {} };
  const sepWeek1Info = Core.getNextPendingWeekInfo(state);
  assert.strictEqual(sepWeek1Info.month, 9);
  assert.strictEqual(sepWeek1Info.index, 1);
  assert.strictEqual(Core.toISO(sepWeek1Info.start), '2026-09-01');
  assert.ok(!sepWeek1Info.days.some((d) => Core.isoWeekdayMon1(d) === 1), 'la semana 1 de septiembre no debe contener ningún lunes');
  const { audit: sepWeek1Audit } = lockWeek(students, lockedWeeks, sepWeek1Info);
  assert.strictEqual(sepWeek1Audit.warnings.filter((w) => w.type === 'repeat').length, 0);

  const state2 = { lockedWeeks, settings: {} };
  const sepWeek2Info = Core.getNextPendingWeekInfo(state2);
  assert.strictEqual(sepWeek2Info.month, 9);
  assert.strictEqual(sepWeek2Info.index, 2);
  assert.ok(sepWeek2Info.days.some((d) => Core.toISO(d) === '2026-09-07'));

  const { proposal: sepWeek2, audit: sepWeek2Audit } = lockWeek(students, lockedWeeks, sepWeek2Info);

  // Para cada estudiante de "Lunes" (Darhian, Lorenzo C., Pablo), su área del
  // lunes 7/9 NO debe coincidir con la que tuvo el lunes 31/8 — aunque entre
  // medio haya caído una semana calendario entera (Semana 1 de septiembre)
  // en la que ni siquiera tuvieron asignación.
  let studentsCheckedAcrossBoundary = 0;
  const mondaySep7 = sepWeek2.days.find((d) => d.date === '2026-09-07');
  mondaySep7.assignments.forEach((a) => {
    assert.ok(Object.prototype.hasOwnProperty.call(lastAreaByStudent, a.studentId), `${a.name} debería ser uno de los estudiantes de Lunes`);
    studentsCheckedAcrossBoundary++;
    assert.notStrictEqual(
      a.area,
      lastAreaByStudent[a.studentId],
      `${a.name} repitió el área "${a.area}" entre el 31/8 (fin de agosto) y el 7/9 (primer lunes de septiembre)`,
    );
  });
  assert.strictEqual(studentsCheckedAcrossBoundary, 3, 'deben verificarse los 3 estudiantes de Lunes');

  const repeatWarnings = sepWeek2Audit.warnings.filter((w) => w.type === 'repeat');
  assert.strictEqual(repeatWarnings.length, 0, `no debería haber repeticiones cruzando agosto->septiembre: ${JSON.stringify(repeatWarnings)}`);

  console.log(`   (${studentsCheckedAcrossBoundary} estudiantes de Lunes verificados a través del límite agosto/septiembre, saltando la Semana 1 de septiembre que no tiene lunes)`);
});

check('invariante general: en TODA la historia, ningún estudiante repite área entre dos asignaciones consecutivas suyas, sin importar mes/semana', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const lockedWeeks = [];
  let year = 2026, month = 1;
  for (let i = 0; i < 14; i++) {
    Core.monthWeeks(year, month).forEach((w) => lockWeek(students, lockedWeeks, w));
    month++;
    if (month > 12) { month = 1; year++; }
  }
  const sorted = Core.allAssignmentsSorted(lockedWeeks);
  const byStudent = {};
  sorted.forEach((a) => { (byStudent[a.studentId] = byStudent[a.studentId] || []).push(a); });
  let pairsChecked = 0;
  Object.entries(byStudent).forEach(([studentId, list]) => {
    for (let i = 1; i < list.length; i++) {
      pairsChecked++;
      assert.notStrictEqual(
        list[i].area,
        list[i - 1].area,
        `${studentId} repitió área "${list[i].area}" entre ${list[i - 1].date} y ${list[i].date}`,
      );
    }
  });
  console.log(`   (${pairsChecked} pares de asignaciones consecutivas verificados en 14 meses de historial, incluyendo todos los límites de mes)`);
});

// ---------------------------------------------------------------------
// 3. El detector de repeticiones SÍ dispara si se fuerza manualmente una
//    repetición cruzando el límite de mes (para probar que no es un falso
//    negativo por casualidad, sino que la lógica realmente compara).
// ---------------------------------------------------------------------
check('auditWeek detecta una repetición forzada que cruza el límite de mes', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const lockedWeeks = [];
  const augWeeks = Core.monthWeeks(2026, 8);
  augWeeks.forEach((w) => lockWeek(students, lockedWeeks, w));

  const state = { lockedWeeks, settings: {} };
  const nextWeekInfo = Core.getNextPendingWeekInfo(state);
  const proposal = Core.generateWeekProposal(students, lockedWeeks, nextWeekInfo);

  // Tomamos el primer estudiante asignado en la propuesta de septiembre y lo
  // forzamos a repetir el área que tuvo en su última asignación de agosto.
  const sortedAssignments = Core.allAssignmentsSorted(lockedWeeks);
  const someAssignment = proposal.days.flatMap((d) => d.assignments.map((a) => ({ ...a, date: d.date })))[0];
  const lastArea = Core.lastAreaForStudent(sortedAssignments, someAssignment.studentId, someAssignment.date);
  assert.ok(lastArea, 'el estudiante de prueba debe tener una última área registrada en agosto');

  proposal.days.forEach((day) => day.assignments.forEach((a) => {
    if (a.studentId === someAssignment.studentId) a.area = lastArea;
  }));

  const audit = Core.auditWeek(students, lockedWeeks, proposal);
  const repeatWarnings = audit.warnings.filter((w) => w.type === 'repeat' && w.studentId === someAssignment.studentId);
  assert.strictEqual(repeatWarnings.length, 1, 'la repetición forzada cruzando el límite de mes debe ser detectada');
});

// ---------------------------------------------------------------------
// 4. La numeración de semana se reinicia cada mes pero el historial no.
// ---------------------------------------------------------------------
check('la numeración "Semana N" se reinicia cada mes sin afectar el historial acumulado', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const lockedWeeks = [];
  Core.monthWeeks(2026, 8).forEach((w) => lockWeek(students, lockedWeeks, w));
  const lastAug = lockedWeeks[lockedWeeks.length - 1];
  assert.ok(lastAug.weekIndex >= 4); // última semana de agosto (numerada dentro de agosto)

  const state = { lockedWeeks, settings: {} };
  const sepWeek1Info = Core.getNextPendingWeekInfo(state);
  assert.strictEqual(sepWeek1Info.index, 1); // se reinicia la numeración

  const totalPointsBefore = Core.totalPointsForStudent(Core.allAssignmentsSorted(lockedWeeks), Core.INITIAL_STUDENTS[0].id);
  lockWeek(students, lockedWeeks, sepWeek1Info);
  const totalPointsAfter = Core.totalPointsForStudent(Core.allAssignmentsSorted(lockedWeeks), Core.INITIAL_STUDENTS[0].id);
  // Los puntos acumulados nunca bajan ni se resetean al cruzar de mes.
  assert.ok(totalPointsAfter >= totalPointsBefore);
});

// ---------------------------------------------------------------------
// 5. Reglas duras: nunca Cocina1<->Cocina2 cruzado, nunca duplicado de área
//    el mismo día, sobre una simulación larga (12 meses seguidos).
// ---------------------------------------------------------------------
check('simulación de 12 meses consecutivos sin violar reglas duras', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const studentsById = Object.fromEntries(students.map((s) => [s.id, s]));
  const lockedWeeks = [];
  let year = 2026, month = 1;
  let totalRepeatWarnings = 0;
  for (let i = 0; i < 12; i++) {
    const weeks = Core.monthWeeks(year, month);
    weeks.forEach((w) => {
      const { proposal, audit } = lockWeek(students, lockedWeeks, w);
      audit.warnings.forEach((warn) => {
        if (warn.type === 'kitchenGroup' || warn.type === 'sameDayConflict') {
          throw new Error(`Violación de regla dura en ${JSON.stringify(warn)}`);
        }
        if (warn.type === 'repeat') totalRepeatWarnings++;
      });
      proposal.days.forEach((day) => day.assignments.forEach((a) => {
        const student = studentsById[a.studentId];
        if (a.area === 'kitchen2') assert.strictEqual(student.kitchenGroup, 'k2');
        if (a.area === 'kitchen1') assert.strictEqual(student.kitchenGroup, 'k1');
      }));
    });
    month++;
    if (month > 12) { month = 1; year++; }
  }
  console.log(`   (${lockedWeeks.length} semanas bloqueadas a lo largo de 12 meses, ${totalRepeatWarnings} repeticiones detectadas por el propio algoritmo -> deberían ser 0)`);
  assert.strictEqual(totalRepeatWarnings, 0, 'el resolutor por backtracking debería poder evitar siempre las repeticiones dada la holgura disponible (2-3 estudiantes/día contra 6 áreas elegibles)');
});

// ---------------------------------------------------------------------
// 6. Techos semanales estrictos: Lavadero/Escaleras <=1, Sala/Baño <=2,
//    Cocina 2 <=3. Cocina y Comedor no tienen techo (absorben lo que sobra).
//    El algoritmo debe respetarlos casi siempre; si alguna vez no puede
//    (holgura insuficiente), el estudiante igual queda asignado y la
//    auditoría lo reporta como conflicto en vez de ocultarlo.
// ---------------------------------------------------------------------
check('techos semanales estrictos se respetan (o se reportan como conflicto, nunca en silencio)', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const lockedWeeks = [];
  let year = 2026, month = 1;
  let weeksChecked = 0;
  let capOverruns = 0;
  for (let i = 0; i < 12; i++) {
    Core.monthWeeks(year, month).forEach((w) => {
      const { proposal, audit } = lockWeek(students, lockedWeeks, w);
      weeksChecked++;
      const counts = {};
      Core.AREAS.forEach((a) => { counts[a.id] = 0; });
      proposal.days.forEach((day) => day.assignments.forEach((a) => { counts[a.area]++; }));

      Core.AREAS.forEach((a) => {
        if (a.maxWeekly == null) return;
        const reported = audit.warnings.some((w2) => w2.type === 'maximum' && w2.area === a.id);
        if (counts[a.id] > a.maxWeekly) {
          capOverruns++;
          // Si el techo se superó, TIENE que estar reportado como conflicto (nunca en silencio).
          assert.ok(reported, `"${a.label}" superó su techo (${counts[a.id]}/${a.maxWeekly}) en ${w.year}-${w.month} sin ser reportado`);
        } else {
          assert.ok(!reported, `se reportó un techo superado para "${a.label}" que en realidad no se superó`);
        }
      });
    });
    month++;
    if (month > 12) { month = 1; year++; }
  }
  console.log(`   (${weeksChecked} semanas verificadas contra los techos semanales; ${capOverruns} casos de holgura insuficiente, todos reportados correctamente como conflicto)`);
});

// ---------------------------------------------------------------------
// 7. Días máximos sin limpiar por área (maxGapDays): Cocina/Comedor (1),
//    Sala/Baño (3), Cocina 2 (aviso a los 4, error a los 5). El chequeo
//    debe ser continuo entre semanas y meses (usa el historial completo),
//    y todo lo que realmente se supere debe quedar reportado, nunca en
//    silencio — mismo criterio que el resto de las reglas duras.
// ---------------------------------------------------------------------
check('reglas de "máximo de días sin limpiar" por área se respetan (o se reportan) en 12 meses seguidos, cruzando meses sin cortes', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const lockedWeeks = [];
  const gapAreas = Core.AREAS.filter((a) => a.maxGapDays != null);
  let year = 2026, month = 1;
  let weeksChecked = 0;
  let gapErrors = 0;
  let gapSoftNotices = 0;

  for (let i = 0; i < 12; i++) {
    Core.monthWeeks(year, month).forEach((w) => {
      const historyBefore = Core.allAssignmentsSorted(lockedWeeks);
      const { proposal, audit } = lockWeek(students, lockedWeeks, w);
      weeksChecked++;

      gapAreas.forEach((area) => {
        // Recálculo independiente de la racha real (mismo criterio que
        // auditWeek, pero reimplementado acá a mano) para verificar que el
        // LOG de conflictos no deja pasar ningún hueco real sin avisar.
        const covered = new Set(historyBefore.filter((a) => a.area === area.id).map((a) => a.date));
        proposal.days.forEach((day) => {
          if (day.assignments.some((a) => a.area === area.id)) covered.add(day.date);
        });
        const earliestKnown = historyBefore.length ? historyBefore[0].date : null;
        const lookback = earliestKnown ? area.maxGapDays : 0;
        let cursor = Core.fromISO(proposal.days[0].date);
        if (lookback > 0) {
          cursor = Core.addDays(cursor, -lookback);
          if (earliestKnown && Core.toISO(cursor) < earliestKnown) cursor = Core.fromISO(earliestKnown);
        }
        const lastDate = Core.fromISO(proposal.days[proposal.days.length - 1].date);
        let streak = 0;
        let maxStreakInWeek = 0;
        for (let d = cursor; d <= lastDate; d = Core.addDays(d, 1)) {
          const dISO = Core.toISO(d);
          streak = covered.has(dISO) ? 0 : streak + 1;
          maxStreakInWeek = Math.max(maxStreakInWeek, streak);
        }

        const hasErrorWarning = audit.warnings.some((warn) => warn.type === 'gap' && warn.area === area.id);
        if (maxStreakInWeek > area.maxGapDays) {
          gapErrors++;
          assert.ok(hasErrorWarning, `"${area.label}" tuvo una racha real de ${maxStreakInWeek} días (> máximo ${area.maxGapDays}) en la semana de ${w.year}-${w.month} sin ser reportada`);
        } else {
          assert.ok(!hasErrorWarning, `se reportó un hueco duro para "${area.label}" que en realidad no se superó (semana ${w.year}-${w.month})`);
          const soft = area.preferredGapDays != null ? area.preferredGapDays : area.maxGapDays;
          if (maxStreakInWeek > soft) gapSoftNotices++;
        }
      });
    });
    month++;
    if (month > 12) { month = 1; year++; }
  }
  console.log(`   (${weeksChecked} semanas verificadas; ${gapErrors} huecos duros y ${gapSoftNotices} avisos de Cocina 2 por encima de lo preferido, todos correctamente reportados)`);
});

check('detector de huecos dispara en el día exacto para cada área: Cocina (1 día), Sala Estudios (3 días), Cocina 2 (aviso a los 4, error a los 5), Escaleras sin límite', () => {
  const students = JSON.parse(JSON.stringify(Core.INITIAL_STUDENTS));
  const studentsById = Object.fromEntries(students.map((s) => [s.id, s]));

  // Semana sintética de `days` días, cubierta SOLO el primer día en `areaId`
  // (con un único estudiante) y ningún otro — para forzar una racha de
  // huecos exacta y verificar en qué día exacto dispara el aviso/error.
  function buildFakeWeek(startISO, days, areaId, studentId) {
    const start = Core.fromISO(startISO);
    return {
      year: start.getFullYear(), month: start.getMonth() + 1, weekIndex: 1,
      startDate: startISO,
      endDate: Core.toISO(Core.addDays(start, days - 1)),
      days: Array.from({ length: days }, (_, i) => {
        const date = Core.addDays(start, i);
        return {
          date: Core.toISO(date),
          dow: Core.isoWeekdayMon1(date),
          assignments: i === 0 ? [{ studentId, name: studentsById[studentId].name, area: areaId }] : [],
        };
      }),
    };
  }

  // Cocina (kitchen1, maxGapDays=1): cubierta el día 1; el segundo día
  // seguido sin nadie (día 3 en total) ya es error.
  const kitchenAudit = Core.auditWeek(students, [], buildFakeWeek('2026-01-05', 3, 'kitchen1', 'darhian'));
  const kitchenErrors = kitchenAudit.warnings.filter((w) => w.type === 'gap' && w.area === 'kitchen1');
  assert.strictEqual(kitchenErrors.length, 1, 'Cocina debería marcar error al segundo día seguido sin limpiar');
  assert.strictEqual(kitchenErrors[0].date, '2026-01-07');

  // Sala Estudios (maxGapDays=3): recién el 4to día seguido sin nadie es error.
  const salaAudit = Core.auditWeek(students, [], buildFakeWeek('2026-01-05', 5, 'studyRoom', 'darhian'));
  const salaErrors = salaAudit.warnings.filter((w) => w.type === 'gap' && w.area === 'studyRoom');
  assert.strictEqual(salaErrors.length, 1, 'Sala Estudios debería marcar error recién al 4to día seguido sin limpiar');
  assert.strictEqual(salaErrors[0].date, '2026-01-09');

  // Cocina 2 (preferredGapDays=3, maxGapDays=4): 4to día = aviso (no error),
  // 5to día = error.
  const k2Audit = Core.auditWeek(students, [], buildFakeWeek('2026-01-05', 6, 'kitchen2', 'gaston'));
  const k2Soft = k2Audit.warnings.filter((w) => w.type === 'gapSoft' && w.area === 'kitchen2');
  const k2Error = k2Audit.warnings.filter((w) => w.type === 'gap' && w.area === 'kitchen2');
  assert.strictEqual(k2Soft.length, 1, 'Cocina 2 debería avisar (no error) al 4to día seguido sin limpiar');
  assert.strictEqual(k2Soft[0].date, '2026-01-09');
  assert.strictEqual(k2Error.length, 1, 'Cocina 2 debería marcar error recién al 5to día seguido sin limpiar');
  assert.strictEqual(k2Error[0].date, '2026-01-10');

  // Escaleras: sin límite de huecos configurado, nunca debería generar
  // avisos de este tipo aunque pasen muchos días sin asignación.
  const stairsAudit = Core.auditWeek(students, [], buildFakeWeek('2026-01-05', 7, 'stairs', 'darhian'));
  const stairsGapWarnings = stairsAudit.warnings.filter((w) => (w.type === 'gap' || w.type === 'gapSoft') && w.area === 'stairs');
  assert.strictEqual(stairsGapWarnings.length, 0, 'Escaleras no debería tener límite de días sin limpiar');
});

// ---------------------------------------------------------------------
// 9. Cobertura de becados: la semana corta de fin de mes no debe marcar
//    como "falta" a nadie cuyo día real caiga en la semana siguiente.
// ---------------------------------------------------------------------
check('cobertura de becados respeta el corte de mes: septiembre 2026 termina miércoles 30 (semana corta), el resto de esa semana natural (jueves a domingo) es la semana 1 de octubre — nadie se marca "falta" en el mes que no le corresponde', () => {
  const students = [
    { id: 'lun', name: 'Lunes Test', active: true, fixedDay: 1 },
    { id: 'jue', name: 'Jueves Test', active: true, fixedDay: 4 },
  ];
  const sepWeeks = Core.monthWeeks(2026, 9);
  const octWeeks = Core.monthWeeks(2026, 10);
  const sepWeek5 = sepWeeks[sepWeeks.length - 1];
  const octWeek1 = octWeeks[0];

  // Confirma el supuesto del propio caso: septiembre corta un miércoles a
  // mitad de semana, y octubre arranca justo al día siguiente.
  assert.strictEqual(Core.toISO(sepWeek5.end), '2026-09-30');
  assert.strictEqual(Core.toISO(octWeek1.start), '2026-10-01');

  // Nadie asignado en ninguna de las dos semanas (como si la propuesta
  // automática o una edición manual hubiera dejado a todos sin área).
  const covSep = Core.studentCoverageForWeek(students, toWeekShape(sepWeek5, {}));
  const covOct = Core.studentCoverageForWeek(students, toWeekShape(octWeek1, {}));

  // El de día fijo lunes: el 28/09 (lunes) cae DENTRO de la semana corta de
  // septiembre -> le corresponde ahí, no en octubre.
  assert.ok(covSep.missing.some((m) => m.id === 'lun'), 'el de lunes debería figurar como faltante en la semana corta de septiembre (su día cayó ahí)');
  assert.ok(!covOct.missing.some((m) => m.id === 'lun'), 'el de lunes NO debería aparecer en octubre: su día ya pasó dentro de septiembre');

  // El de día fijo jueves: la semana corta de septiembre es lunes-miércoles
  // nada más (no llega a tener jueves) -> su jueves real es el 01/10, ya
  // parte de la semana 1 de octubre.
  assert.ok(!covSep.missing.some((m) => m.id === 'jue'), 'el de jueves NO debería figurar como faltante en septiembre: esa semana corta no llega a tener jueves');
  assert.ok(covOct.missing.some((m) => m.id === 'jue'), 'el de jueves debería figurar como faltante recién en la semana 1 de octubre, que es donde realmente le toca');
});

console.log(`\n${passed} pruebas OK`);
if (process.exitCode) {
  console.error('Hay pruebas fallidas.');
} else {
  console.log('Todas las pruebas pasaron.');
}
