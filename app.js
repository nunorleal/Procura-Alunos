const schoolData = window.SCHOOL_DATA;
const bundledSchedulesByYear = Object.fromEntries(
  Object.entries(schoolData.years).map(([year, payload]) => [year, payload.schedules || {}]),
);

const searchInput = document.querySelector("#searchInput");
const searchLabel = document.querySelector("#searchLabel");
const modeButtons = document.querySelectorAll(".mode-button");
const yearSelect = document.querySelector("#yearSelect");
const studentSummary = document.querySelector("#studentSummary");
const importYearInput = document.querySelector("#importYearInput");
const importText = document.querySelector("#importText");
const importTextButton = document.querySelector("#importTextButton");
const exportStorageButton = document.querySelector("#exportStorageButton");
const importStorageInput = document.querySelector("#importStorageInput");
const dateInput = document.querySelector("#dateInput");
const timeInput = document.querySelector("#timeInput");
const nowButton = document.querySelector("#nowButton");
const results = document.querySelector("#results");
const resultTitle = document.querySelector("#resultTitle");
const clockLabel = document.querySelector("#clockLabel");
const studentTemplate = document.querySelector("#studentTemplate");
const classTemplate = document.querySelector("#classTemplate");

let searchMode = "student";
Object.assign(schoolData.years, loadStoredYears());
let activeYear =
  loadStoredActiveYear() || schoolData.activeYear || Object.keys(schoolData.years || {})[0];
let data = schoolData.years[activeYear];

const dayNames = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
  7: "Domingo",
};

const dayNumbers = {
  "segunda-feira": 1,
  "terça-feira": 2,
  "terca-feira": 2,
  "quarta-feira": 3,
  "quinta-feira": 4,
  "sexta-feira": 5,
};

function withAvailableSchedules(year, payload) {
  const schedules = { ...payload.schedules };
  for (const [classKey, days] of Object.entries(bundledSchedulesByYear[year] || {})) {
    if (!Object.values(schedules[classKey] || {}).some((lessons) => lessons.length)) {
      schedules[classKey] = days;
    }
  }
  return { ...payload, schedules };
}

function loadStoredYears() {
  try {
    const stored = JSON.parse(localStorage.getItem("schoolImportedYears") || "{}");
    return Object.fromEntries(Object.entries(stored).map(([year, payload]) => [
      year, withAvailableSchedules(year, payload),
    ]));
  } catch {
    return {};
  }
}

function loadStoredActiveYear() {
  try {
    return localStorage.getItem("schoolActiveYear");
  } catch {
    return "";
  }
}

function saveStoredYear(year, payload) {
  try {
    const years = loadStoredYears();
    years[year] = payload;
    localStorage.setItem("schoolImportedYears", JSON.stringify(years));
    localStorage.setItem("schoolActiveYear", year);
  } catch {
    // If storage is unavailable, the imported year still works for this session.
  }
}

function exportStoredData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    activeYear,
    years: loadStoredYears(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `pesquisa-alunos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importStoredData(file) {
  const payload = JSON.parse(await file.text());
  if (!payload.years || typeof payload.years !== "object") {
    throw new Error("O ficheiro não contém uma cópia válida de anos letivos.");
  }

  const normalizedYears = {};
  for (const [year, yearPayload] of Object.entries(payload.years)) {
    normalizedYears[year] = normalizeYearPayload(withAvailableSchedules(year, yearPayload));
  }

  localStorage.setItem("schoolImportedYears", JSON.stringify(normalizedYears));
  if (payload.activeYear && normalizedYears[payload.activeYear]) {
    localStorage.setItem("schoolActiveYear", payload.activeYear);
  }

  Object.assign(schoolData.years, normalizedYears);
  activeYear = payload.activeYear && schoolData.years[payload.activeYear]
    ? payload.activeYear
    : Object.keys(normalizedYears)[0];
  data = schoolData.years[activeYear];
  populateYearSelect();
  yearSelect.value = activeYear;
  render();
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeTokens(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function normalizeClassQuery(value) {
  const compact = normalize(value);
  const match = compact.match(/^([5-9])(?:ano|o)?([a-f])?$/i);
  if (!match) {
    return compact;
  }
  return `${match[1]}${match[2] ? match[2].toUpperCase() : ""}`;
}

function classKeyFromStudentHeading(line) {
  const match = line.match(/^Turma\s+(\d+)\.º\s*-?\s*([A-Z])$/i);
  return match ? `${match[1]}${match[2].toUpperCase()}` : "";
}

function classKeyFromScheduleHeading(line) {
  const match = line.match(/^(\d+)\.º\s+Ano\s+-\s+Turma\s+([A-Z])$/i);
  return match ? `${match[1]}${match[2].toUpperCase()}` : "";
}

function classNameFromKey(classKey) {
  return `${classKey.slice(0, -1)}.º ${classKey.slice(-1)}`;
}

function splitActivity(raw) {
  const dashParts = raw.split(/\s+—\s+/);
  if (dashParts.length > 1) {
    const subject = dashParts[0].trim().replace(/[. ]+$/g, "");
    const roomText = dashParts.slice(1).join(" — ").trim().replace(/[. ]+$/g, "");
    if (/sem sala fixa/i.test(roomText)) {
      return { subject, room: "" };
    }
    return {
      subject,
      room: roomText.replace(/^Sala\s+/i, "").replace(/[()]/g, "").trim(),
    };
  }

  const match = raw.match(/\(([^()]*)\)\s*\.?$/);
  if (!match) {
    return { subject: raw.trim().replace(/^[.]+|[.]+$/g, ""), room: "" };
  }
  return {
    subject: raw.slice(0, match.index).trim().replace(/^[.]+|[.]+$/g, ""),
    room: match[1].trim(),
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function withMinutes(lesson) {
  return {
    ...lesson,
    startMinutes: lesson.startMinutes ?? parseTime(lesson.start),
    endMinutes: lesson.endMinutes ?? parseTime(lesson.end),
    raw: lesson.raw || `${lesson.subject}${lesson.room ? ` (${lesson.room})` : ""}`,
  };
}

function parseTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeYearPayload(payload) {
  const students = (payload.students || []).map((student) => ({
    ...student,
    id: student.id || `${student.classKey}-${student.number}`,
    searchName: student.searchName || normalize(student.name || ""),
  }));
  const classes =
    payload.classes ||
    [...new Map(students.map((student) => [student.classKey, student.className])).entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.key.localeCompare(b.key, "pt", { numeric: true }));
  const schedules = {};

  for (const [classKey, days] of Object.entries(payload.schedules || {})) {
    schedules[classKey] = {};
    for (const [day, lessons] of Object.entries(days)) {
      schedules[classKey][day] = lessons.map(withMinutes);
    }
  }

  return {
    source: payload.source || "Importado",
    generatedAt: payload.generatedAt || new Date().toISOString(),
    students,
    classes,
    schedules,
  };
}

function parseWordText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstScheduleIndex = lines.findIndex(classKeyFromScheduleHeading);
  const studentLines = firstScheduleIndex >= 0 ? lines.slice(0, firstScheduleIndex) : lines;
  const scheduleLines = firstScheduleIndex >= 0 ? lines.slice(firstScheduleIndex) : [];
  const students = [];
  const schedules = {};
  let currentClass = "";
  let currentDay = "";

  for (const line of studentLines) {
    const headingClass = classKeyFromStudentHeading(line);
    if (headingClass) {
      currentClass = headingClass;
      continue;
    }

    const studentMatch = line.match(/^(\d+)\s*-\s*(.+?)\s*[–-]\s*(\d+)$/);
    if (!studentMatch || !currentClass) {
      continue;
    }

    const [, number, name, process] = studentMatch;
    students.push({
      classKey: currentClass,
      className: classNameFromKey(currentClass),
      number: Number(number),
      name: name.trim(),
      process,
    });
  }

  for (const line of scheduleLines) {
    const headingClass = classKeyFromScheduleHeading(line);
    if (headingClass) {
      currentClass = headingClass;
      schedules[currentClass] ||= { 1: [], 2: [], 3: [], 4: [], 5: [] };
      currentDay = "";
      continue;
    }

    const day = dayNumbers[normalizeTokens(line).join("-")];
    if (day) {
      currentDay = String(day);
      continue;
    }

    const lessonMatch = line.match(/^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2}):\s*(.+)$/);
    if (!lessonMatch || !currentClass || !currentDay) {
      continue;
    }

    const [, start, end, activity] = lessonMatch;
    const { subject, room } = splitActivity(activity);
    schedules[currentClass][currentDay].push(withMinutes({ start, end, subject, room, raw: activity }));
  }

  const classMap = new Map();
  for (const student of students) {
    classMap.set(student.classKey, student.className);
  }
  for (const classKey of Object.keys(schedules)) {
    classMap.set(classKey, classNameFromKey(classKey));
  }

  return normalizeYearPayload({
    source: "Texto copiado do Word",
    students,
    classes: [...classMap.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.key.localeCompare(b.key, "pt", { numeric: true })),
    schedules,
  });
}

function setActiveYear(year) {
  activeYear = year;
  data = schoolData.years[activeYear];
  schoolData.activeYear = activeYear;
  try {
    localStorage.setItem("schoolActiveYear", activeYear);
  } catch {
    // Ignore storage failures.
  }
  render();
}

function populateYearSelect() {
  yearSelect.innerHTML = "";
  Object.keys(schoolData.years || {})
    .sort()
    .forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      option.selected = year === activeYear;
      yearSelect.append(option);
    });
}

function setNow() {
  const now = new Date();
  dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  timeInput.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  render();
}

function selectedDateTime() {
  const [year, month, day] = dateInput.value.split("-").map(Number);
  const [hour, minute] = timeInput.value.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function selectedDayAndMinutes() {
  const selected = selectedDateTime();
  const jsDay = selected.getDay();
  const schoolDay = jsDay === 0 ? 7 : jsDay;
  return {
    date: selected,
    day: schoolDay,
    minutes: selected.getHours() * 60 + selected.getMinutes(),
  };
}

function lessonsFor(classKey, day) {
  return data.schedules[classKey]?.[String(day)] || [];
}

function findCurrentLesson(classKey, day, minutes) {
  const lessons = lessonsFor(classKey, day);
  return lessons.find((lesson) => minutes >= lesson.startMinutes && minutes < lesson.endMinutes);
}

function lessonOptions(lesson) {
  return lesson.options?.length ? lesson.options : [{ subject: lesson.subject, room: lesson.room }];
}

function roomLabel(room) {
  return !room || room === "Sem sala" ? "Sem sala" : `Sala ${room}`;
}

function appendLessonOptions(container, options) {
  options.forEach((option, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.className = "lesson-or";
      separator.textContent = "ou";
      container.append(separator);
    }
    const choice = document.createElement("div");
    choice.className = "lesson-option";
    const subject = document.createElement("strong");
    subject.textContent = option.subject;
    choice.append(subject);
    if (option.subject.toUpperCase() !== "ALMOÇO") {
      const room = document.createElement("span");
      room.className = "lesson-room";
      room.textContent = roomLabel(option.room);
      choice.append(room);
    }
    container.append(choice);
  });
}

function statusForClass(classKey, day, minutes, prefix = "Está") {
  const lessons = lessonsFor(classKey, day);
  const current = findCurrentLesson(classKey, day, minutes);

  if (current) {
    if (current.subject.toUpperCase() === "ALMOÇO") {
      return {
        active: false,
        title: `${prefix} em período de almoço`,
        detail: `${current.start} - ${current.end}`,
      };
    }

    const options = lessonOptions(current);
    if (options.length > 1) {
      return {
        active: true,
        title: "Possíveis atividades neste horário",
        detail: `${current.start} - ${current.end}\n${options.map((option) => `${option.subject} · ${roomLabel(option.room)}`).join("\nou ")}`,
      };
    }
    return {
      active: true,
      title: `${prefix} a ter ${options[0].subject} · ${roomLabel(options[0].room)}`,
      detail: `${current.start} - ${current.end}`,
    };
  }

  if (day > 5) {
    return {
      active: false,
      title: "Fora do horário letivo",
      detail: "Não há horário letivo registado para este dia.",
    };
  }

  if (!lessons.length) {
    return {
      active: false,
      title: "Sem horário registado",
      detail: "A turma não tem blocos horários neste dia.",
    };
  }

  const first = lessons[0];
  const last = lessons[lessons.length - 1];
  if (minutes < first.startMinutes) {
    return {
      active: false,
      title: "Fora do horário letivo",
      detail: `A primeira atividade começa às ${first.start}.`,
    };
  }

  if (minutes >= last.endMinutes) {
    return {
      active: false,
      title: "Fora do horário letivo",
      detail: `A última atividade terminou às ${last.end}.`,
    };
  }

  const next = lessons.find((lesson) => minutes < lesson.startMinutes);
  return {
    active: false,
    title: "Intervalo",
    detail: next ? `A próxima atividade começa às ${next.start}.` : "Sem mais atividades hoje.",
  };
}

function statusFor(student, day, minutes) {
  return statusForClass(student.classKey, day, minutes, "Está");
}

function renderSchedule(classKey, day, minutes, container) {
  const lessons = lessonsFor(classKey, day);
  container.innerHTML = "";

  if (!lessons.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "Sem blocos registados para este dia.";
    container.append(empty);
    return;
  }

  for (const lesson of lessons) {
    const row = document.createElement("div");
    row.className = "lesson";
    if (minutes >= lesson.startMinutes && minutes < lesson.endMinutes) {
      row.classList.add("active");
    }

    const time = document.createElement("span");
    time.className = "lesson-time";
    time.textContent = `${lesson.start} - ${lesson.end}`;

    const choices = document.createElement("div");
    choices.className = "lesson-options";
    appendLessonOptions(choices, lessonOptions(lesson));
    row.append(time, choices);
    container.append(row);
  }
}

function renderWeekSchedule(classKey, selectedDay, minutes, container) {
  container.innerHTML = "";
  container.classList.add("week-schedule");

  const days = [1, 2, 3, 4, 5];
  const allLessons = days.flatMap((day) => lessonsFor(classKey, day));
  const boundaries = [...new Set(allLessons.flatMap((lesson) => [lesson.startMinutes, lesson.endMinutes]))]
    .sort((a, b) => a - b);
  const formatMinutes = (value) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
  const slots = boundaries.slice(0, -1).map((startMinutes, index) => ({
    startMinutes, endMinutes: boundaries[index + 1],
    start: formatMinutes(startMinutes), end: formatMinutes(boundaries[index + 1]),
  })).filter((slot) => allLessons.some((lesson) =>
    lesson.startMinutes < slot.endMinutes && lesson.endMinutes > slot.startMinutes));

  if (!slots.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "Sem horário semanal registado.";
    container.append(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "week-grid";

  const corner = document.createElement("div");
  corner.className = "week-head time-head";
  corner.textContent = "Hora";
  grid.append(corner);

  for (const day of days) {
    const dayHead = document.createElement("div");
    dayHead.className = "week-head";
    dayHead.textContent = dayNames[day];
    grid.append(dayHead);
  }

  for (const slot of slots) {
    const timeCell = document.createElement("div");
    timeCell.className = "week-time";
    timeCell.textContent = `${slot.start} - ${slot.end}`;
    grid.append(timeCell);

    for (const day of days) {
      const lesson = lessonsFor(classKey, day).find(
        (item) => item.startMinutes <= slot.startMinutes && item.endMinutes >= slot.endMinutes,
      );
      const cell = document.createElement("div");
      cell.className = "week-cell";

      if (lesson) {
        if (day === selectedDay && minutes >= slot.startMinutes && minutes < slot.endMinutes) {
          cell.classList.add("active");
        }

        appendLessonOptions(cell, lessonOptions(lesson));
      } else {
        cell.classList.add("empty-cell");
        cell.textContent = " ";
      }

      grid.append(cell);
    }
  }

  container.append(grid);
}

function setScheduleView(card, classKey, day, minutes, view) {
  const schedule = card.querySelector(".class-schedule");
  const buttons = card.querySelectorAll(".schedule-button");

  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  schedule.classList.toggle("week-schedule", view === "week");

  if (view === "week") {
    renderWeekSchedule(classKey, day, minutes, schedule);
    return;
  }

  schedule.classList.remove("week-schedule");
  renderSchedule(classKey, day, minutes, schedule);
}

function renderStudent(student, day, minutes) {
  const fragment = studentTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".student-card");
  const title = fragment.querySelector("h3");
  const meta = fragment.querySelector(".meta");
  const pill = fragment.querySelector(".class-pill");
  const status = fragment.querySelector(".status");
  const schedule = fragment.querySelector(".day-schedule");

  const state = statusFor(student, day, minutes);
  title.textContent = student.name;
  meta.textContent = `N.º ${student.number} · Processo ${student.process}`;
  pill.textContent = student.className;
  status.classList.toggle("off", !state.active);
  status.innerHTML = `<strong></strong><p></p>`;
  status.querySelector("strong").textContent = state.title;
  status.querySelector("p").textContent = state.detail;
  renderSchedule(student.classKey, day, minutes, schedule);

  return card;
}

function jumpToClass(classKey) {
  setMode("class");
  searchInput.value = classKey;
  render();
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStudentListItem(student, day, minutes) {
  const state = statusFor(student, day, minutes);
  const item = document.createElement("article");
  item.className = "student-result";
  item.innerHTML = `
    <span class="student-result-main">
      <strong></strong>
      <small></small>
      <span class="student-result-status">
        <b></b>
        <em></em>
      </span>
    </span>
    <button class="class-pill class-jump" type="button" title="Ver turma e horário"></button>
  `;
  item.querySelector("strong").textContent = student.name;
  item.querySelector("small").textContent = `N.º ${student.number} · Processo ${student.process}`;
  item.querySelector(".class-pill").textContent = student.className;
  item.querySelector(".student-result-status b").textContent = state.title;
  item.querySelector(".student-result-status em").textContent = state.detail;

  item.addEventListener("click", () => {
    document.querySelectorAll(".student-result.active").forEach((item) => {
      item.classList.remove("active");
    });
    item.classList.add("active");
  });
  item.querySelector(".class-jump").addEventListener("click", (event) => {
    event.stopPropagation();
    jumpToClass(student.classKey);
  });

  return item;
}

function studentMatches(rawQuery) {
  const query = normalize(rawQuery);
  const queryTokens = normalizeTokens(rawQuery);
  return data.students
    .filter((student) => {
      if (student.searchName.includes(query)) {
        return true;
      }
      const studentTokens = normalizeTokens(student.name);
      return queryTokens.every((token) =>
        studentTokens.some((studentToken) => studentToken.startsWith(token)),
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

function renderStudentSearch(rawQuery, day, minutes) {
  const query = normalize(rawQuery);

  if (!query) {
    resultTitle.textContent = "Começa a escrever um nome";
    results.innerHTML = `<div class="empty">A pesquisa mostra turma, número, processo e localização no horário selecionado.</div>`;
    return;
  }

  const matches = studentMatches(rawQuery);
  resultTitle.textContent =
    matches.length === 1 ? "1 aluno encontrado" : `${matches.length} alunos encontrados`;

  if (!matches.length) {
    results.innerHTML = `<div class="empty">Nenhum aluno encontrado para esta pesquisa.</div>`;
    return;
  }

  if (matches.length === 1) {
    results.append(renderStudent(matches[0], day, minutes));
    return;
  }

  const list = document.createElement("div");
  list.className = "student-result-list";

  for (const student of matches) {
    list.append(renderStudentListItem(student, day, minutes));
  }

  results.append(list);
}

function classMatches(rawQuery) {
  const query = normalizeClassQuery(rawQuery);
  if (!query) {
    return [];
  }

  return data.classes
    .filter((schoolClass) => {
      const classKey = normalizeClassQuery(schoolClass.key);
      const className = normalizeClassQuery(schoolClass.name);
      return classKey.startsWith(query) || className.startsWith(query);
    })
    .sort((a, b) => a.key.localeCompare(b.key, "pt", { numeric: true }));
}

function renderClassResult(schoolClass, day, minutes) {
  const fragment = classTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".class-card");
  const title = fragment.querySelector("h3");
  const meta = fragment.querySelector(".meta");
  const pill = fragment.querySelector(".class-pill");
  const status = fragment.querySelector(".status");
  const list = fragment.querySelector(".class-list");
  const students = data.students
    .filter((student) => student.classKey === schoolClass.key)
    .sort((a, b) => (a.order ?? a.number) - (b.order ?? b.number));
  const state = statusForClass(schoolClass.key, day, minutes, "A turma está");

  title.textContent = `Turma ${schoolClass.name}`;
  meta.textContent =
    students.length === 1 ? "1 aluno" : `${students.length} alunos`;
  pill.textContent = schoolClass.key;
  const editButton = editorIconButton("Pencil", `Editar turma ${schoolClass.name}`, () => openClassEditor(schoolClass));
  const actions = document.createElement("div");
  actions.className = "class-actions";
  pill.replaceWith(actions);
  actions.append(pill, editButton);
  status.classList.toggle("off", !state.active);
  status.innerHTML = `<strong></strong><p></p>`;
  status.querySelector("strong").textContent = state.title;
  status.querySelector("p").textContent = state.detail;

  for (const student of students) {
    const item = document.createElement("li");
    item.innerHTML = `<strong></strong> <span class="student-process"></span>`;
    item.querySelector("strong").textContent = student.name;
    item.querySelector(".student-process").textContent = `N.º ${student.number} · Proc. ${student.process}`;
    list.append(item);
  }

  setScheduleView(card, schoolClass.key, day, minutes, "day");
  card.querySelectorAll(".schedule-button").forEach((button) => {
    button.addEventListener("click", () => {
      setScheduleView(card, schoolClass.key, day, minutes, button.dataset.view);
    });
  });
  return card;
}

function renderClassSearch(rawQuery, day, minutes) {
  const query = normalizeClassQuery(rawQuery);

  if (!query) {
    resultTitle.textContent = "Escreve a turma";
    results.innerHTML = `<div class="empty">Exemplos: 6B, 6.º B, 7 C ou 9.º.</div>`;
    return;
  }

  const matches = classMatches(rawQuery);
  resultTitle.textContent =
    matches.length === 1 ? "1 turma encontrada" : `${matches.length} turmas encontradas`;

  if (!matches.length) {
    results.innerHTML = `<div class="empty">Nenhuma turma encontrada para esta pesquisa.</div>`;
    return;
  }

  for (const schoolClass of matches) {
    results.append(renderClassResult(schoolClass, day, minutes));
  }
}

function setMode(mode) {
  searchMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  searchLabel.textContent = mode === "student" ? "Nome do aluno" : "Turma";
  searchInput.placeholder = mode === "student" ? "Pesquisar por nome" : "Pesquisar por turma";
  resultTitle.textContent = mode === "student" ? "Começa a escrever um nome" : "Escreve a turma";
  render();
}

function importWordTextYear() {
  const year = importYearInput.value.trim();
  const text = importText.value.trim();

  if (!year) {
    throw new Error("Escreve o ano letivo, por exemplo 2026/2027.");
  }
  if (!text) {
    throw new Error("Cola primeiro o texto copiado do Word.");
  }

  const payload = parseWordText(text);
  if (!payload.students.length) {
    throw new Error("Não encontrei alunos no formato “1 - Nome – Processo”.");
  }
  if (!Object.keys(payload.schedules).length) {
    throw new Error("Não encontrei horários no formato “08:15 – 09:45: Disciplina (Sala)”.");
  }

  schoolData.years[year] = payload;
  saveStoredYear(year, payload);
  populateYearSelect();
  yearSelect.value = year;
  setActiveYear(year);
}

function renderStudentSummary() {
  const counts = new Map();
  for (const student of data.students) {
    const grade = String(student.classKey || "").match(/^\d+/)?.[0] || "";
    counts.set(grade, (counts.get(grade) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .sort(([a], [b]) => (Number(a) || Infinity) - (Number(b) || Infinity))
    .map(([grade, count]) => [grade ? `${Number(grade)}.º ano` : "Sem ano definido", count]);
  rows.push(["Total de alunos", data.students.length]);
  studentSummary.replaceChildren();
  rows.forEach(([label, count], index) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = label;
    value.textContent = count.toLocaleString("pt-PT");
    if (index === rows.length - 1) row.className = "summary-total";
    row.append(term, value);
    studentSummary.append(row);
  });
}

function render() {
  renderStudentSummary();
  const rawQuery = searchInput.value.trim();
  const { date, day, minutes } = selectedDayAndMinutes();
  clockLabel.textContent = `${dayNames[day]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  results.innerHTML = "";

  if (searchMode === "class") {
    renderClassSearch(rawQuery, day, minutes);
    return;
  }

  renderStudentSearch(rawQuery, day, minutes);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
yearSelect.addEventListener("change", () => setActiveYear(yearSelect.value));
importTextButton.addEventListener("click", () => {
  try {
    importWordTextYear();
    alert("Ano letivo adicionado.");
  } catch (error) {
    alert(`Não foi possível adicionar o ano: ${error.message}`);
  }
});
exportStorageButton.addEventListener("click", exportStoredData);
document.querySelector("#importStorageButton").addEventListener("click", () => {
  importStorageInput.click();
});
importStorageInput.addEventListener("change", async () => {
  const [file] = importStorageInput.files;
  if (!file) {
    return;
  }
  try {
    await importStoredData(file);
    alert("Dados importados.");
  } catch (error) {
    alert(`Não foi possível importar a cópia: ${error.message}`);
  } finally {
    importStorageInput.value = "";
  }
});
searchInput.addEventListener("input", render);
dateInput.addEventListener("change", render);
timeInput.addEventListener("change", render);
nowButton.addEventListener("click", setNow);

schoolData.years[activeYear] = normalizeYearPayload(schoolData.years[activeYear]);
data = schoolData.years[activeYear];
populateYearSelect();
setNow();
