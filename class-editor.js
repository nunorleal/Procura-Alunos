function editorIconButton(icon, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "editor-icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(lucide.createElement(lucide[icon]));
  button.addEventListener("click", action);
  return button;
}

function openClassEditor(schoolClass) {
  const year = activeYear;
  let draft = data.students.filter(s => s.classKey === schoolClass.key)
    .sort((a, b) => (a.order ?? a.number) - (b.order ?? b.number))
    .map(s => ({ ...s }));
  const dialog = document.createElement("dialog");
  dialog.className = "class-editor";
  dialog.setAttribute("aria-labelledby", "classEditorTitle");
  dialog.innerHTML = `<form><header class="editor-head"><h2 id="classEditorTitle"></h2></header><div class="editor-rows"></div><p class="editor-error" role="alert"></p><footer class="editor-footer"><div class="class-actions editor-add"></div><div class="class-actions"><button type="button" class="editor-cancel">Cancelar</button><button type="submit">Guardar</button></div></footer></form>`;
  dialog.querySelector("h2").textContent = `Editar turma ${schoolClass.name} · ${year}`;
  const form = dialog.querySelector("form");
  const rows = dialog.querySelector(".editor-rows");
  const error = dialog.querySelector(".editor-error");
  const close = () => dialog.close();
  dialog.querySelector(".editor-head").append(editorIconButton("X", "Fechar edição", close));
  dialog.querySelector(".editor-cancel").addEventListener("click", close);
  dialog.addEventListener("close", () => dialog.remove());

  function draw(focusIndex, focusAction = "input") {
    rows.replaceChildren();
    if (!draft.length) {
      const empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "Sem alunos nesta turma.";
      rows.append(empty);
    }
    draft.forEach((student, index) => {
      const row = document.createElement("div");
      row.className = "editor-row";
      for (const [key, label, type] of [["name", "Nome do aluno", "text"], ["number", "Número", "number"], ["process", "Processo", "text"]]) {
        const field = document.createElement("label");
        field.className = "field";
        const caption = document.createElement("span");
        caption.textContent = label;
        const input = document.createElement("input");
        input.type = type;
        input.required = true;
        input.value = student[key] ?? "";
        input.setAttribute("aria-label", `${label}, aluno ${index + 1}`);
        if (key === "number") { input.min = "1"; input.step = "1"; }
        if (key === "process") { input.inputMode = "numeric"; input.pattern = "[0-9]+"; }
        input.addEventListener("input", () => { student[key] = input.value; error.textContent = ""; });
        field.append(caption, input);
        row.append(field);
      }
      const actions = document.createElement("div");
      actions.className = "editor-row-actions";
      for (const [direction, icon, label] of [[-1, "ArrowUp", "Subir aluno"], [1, "ArrowDown", "Descer aluno"]]) {
        const button = editorIconButton(icon, label, () => {
          const target = index + direction;
          [draft[index], draft[target]] = [draft[target], draft[index]];
          draw(target, direction === -1 ? "up" : "down");
        });
        button.dataset.action = direction === -1 ? "up" : "down";
        button.disabled = index + direction < 0 || index + direction >= draft.length;
        actions.append(button);
      }
      const remove = editorIconButton("Trash2", "Apagar aluno", () => {
        draft.splice(index, 1);
        draw(Math.min(index, draft.length - 1));
      });
      remove.classList.add("editor-delete");
      actions.append(remove);
      row.append(actions);
      rows.append(row);
    });
    if (focusIndex >= 0) {
      const row = rows.querySelectorAll(".editor-row")[focusIndex];
      const target = focusAction === "input" ? row?.querySelector("input") : row?.querySelector(`[data-action="${focusAction}"]`);
      (target && !target.disabled ? target : row?.querySelector("input"))?.focus();
    }
  }

  dialog.querySelector(".editor-add").append(editorIconButton("Plus", "Adicionar aluno", () => {
    draft.push({ name: "", number: Math.max(0, ...draft.map(s => Number(s.number) || 0)) + 1, process: "" });
    draw(draft.length - 1);
  }));

  form.addEventListener("submit", event => {
    event.preventDefault();
    const current = schoolData.years[year];
    const others = current.students.filter(s => s.classKey !== schoolClass.key);
    const numbers = new Set();
    const processes = new Set(others.map(s => String(s.process).replace(/^0+/, "")));
    const updated = [];
    for (const [index, student] of draft.entries()) {
      const name = student.name.trim();
      const number = Number(student.number);
      const process = String(student.process).trim();
      if (!name || !Number.isSafeInteger(number) || number < 1 || !/^\d+$/.test(process)) {
        error.textContent = "Preenche o nome, um número inteiro positivo e o número de processo de cada aluno.";
        return;
      }
      if (numbers.has(number) || processes.has(process.replace(/^0+/, ""))) {
        error.textContent = "Existe um número repetido na turma ou um processo repetido neste ano letivo.";
        return;
      }
      numbers.add(number);
      processes.add(process.replace(/^0+/, ""));
      updated.push({ ...student, id: `${schoolClass.key}-${number}`, name, number, process,
        searchName: normalize(name), classKey: schoolClass.key, className: schoolClass.name, order: index + 1 });
    }
    const payload = { ...current, students: [...others, ...updated] };
    try {
      const stored = loadStoredYears();
      stored[year] = payload;
      localStorage.setItem("schoolImportedYears", JSON.stringify(stored));
    } catch {
      error.textContent = "Não foi possível guardar no navegador. A edição continua aberta para tentares novamente.";
      return;
    }
    schoolData.years[year] = payload;
    if (activeYear === year) data = payload;
    render();
    close();
  });
  document.body.append(dialog);
  draw();
  dialog.showModal();
}
