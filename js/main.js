import { MONTH_NAMES, YEARS, POSITIONS, monthKey, MAX_EMPLOYEE_CAPACITY } from "./constants.js";
import {
  projectFinancialBundle,
  employeeMetricsFull,
  totalEstimatedIncome,
  assignmentFinancials,
  effectiveAssignmentCapacity,
  usedEffectiveOnProject,
  projectIncomeBeforeAfterUnassign,
  vacationCoefficient,
  daysInMonth,
  isWeekend,
  workingDaysInMonth,
  vacationWeekdays,
  formatVacationRanges,
  ageFromDob,
  employeeTotalAssignedCapacity,
} from "./calc.js";
import {
  loadAll,
  saveAll,
  ensureMonth,
  initIfEmpty,
  seedMonth,
  addEmployee,
  addProject,
  deleteEmployee,
  deleteProject,
  updateEmployeeField,
  setVacations,
  setAssignmentFull,
  unassign,
} from "./storage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  tab: "projects",
  sidebarCollapsed: false,
  store: loadAll(),
  projectSort: { col: null, dir: "asc" },
  employeeSort: { col: null, dir: "asc" },
  projectFilters: {},
  employeeFilters: {},
  filterTarget: null,
  calendarDraft: [],
  calendarEmployeeId: null,
  assignContext: null,
  unassignContext: null,
  actionMenuCtx: null,
};

function currentKey() {
  return monthKey(state.year, state.month);
}

function persist() {
  saveAll(state.store);
}

function getMonthSnapshot() {
  const key = currentKey();
  initIfEmpty(state.store, key);
  return ensureMonth(state.store, key);
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function moneyClass(n) {
  if (n > 0) return "money--pos";
  if (n < 0) return "money--neg";
  return "";
}

function refresh() {
  const { employees, projects } = getMonthSnapshot();
  renderProjectsTable(projects, employees);
  renderEmployeesTable(employees, projects);
  updateTotalIncome(projects, employees);
  updateSortIcons();
}

function updateTotalIncome(projects, employees) {
  const t = totalEstimatedIncome(projects, employees, state.year, state.month);
  const el = $("#total-income-value");
  el.textContent = money(t);
  el.className = moneyClass(t);
}

function sortRows(rows, col, dir, getter) {
  const m = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * m;
    return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * m;
  });
}

function passesProjectFilters(p) {
  const f = state.projectFilters;
  if (f.companyName && !p.companyName.toLowerCase().includes(f.companyName.toLowerCase())) return false;
  if (f.projectName && !p.projectName.toLowerCase().includes(f.projectName.toLowerCase())) return false;
  return true;
}

function passesEmployeeFilters(e) {
  const f = state.employeeFilters;
  if (f.name && !e.name.toLowerCase().includes(f.name.toLowerCase())) return false;
  if (f.surname && !e.surname.toLowerCase().includes(f.surname.toLowerCase())) return false;
  if (f.position && e.position !== f.position) return false;
  if (f.project) {
    const pmap = Object.fromEntries(getMonthSnapshot().projects.map((x) => [x.id, x]));
    const names = (e.assignments || []).map((a) => pmap[a.projectId]?.projectName || "").join(" ");
    if (!names.toLowerCase().includes(f.project.toLowerCase())) return false;
  }
  return true;
}

function renderFilterChips(containerId, filters, onRemove, onClear) {
  const el = $(`#${containerId}`);
  el.innerHTML = "";
  const entries = Object.entries(filters).filter(([, v]) => v);
  for (const [k, v] of entries) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${labelForFilter(k)}: ${v} `;
    const x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Remove filter");
    x.textContent = "×";
    x.addEventListener("click", () => onRemove(k));
    chip.appendChild(x);
    el.appendChild(chip);
  }
  if (entries.length >= 2) {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "chip chip--clear";
    c.textContent = "Clear Filters";
    c.addEventListener("click", onClear);
    el.appendChild(c);
  }
}

function labelForFilter(k) {
  const map = {
    companyName: "Company Name",
    projectName: "Project Name",
    name: "Name",
    surname: "Surname",
    position: "Position",
    project: "Project",
  };
  return map[k] || k;
}

function renderProjectsTable(projects, employees) {
  let rows = projects.filter(passesProjectFilters);
  const s = state.projectSort;
  if (s.col) {
    const g = projectSortGetter(s.col, employees);
    rows = sortRows(rows, s.col, s.dir, g);
  }
  const tb = $("#projects-tbody");
  tb.innerHTML = "";
  for (const p of rows) {
    const fin = projectFinancialBundle(p, employees, state.year, state.month);
    const used = fin.usedEffective;
    const total = p.employeeCapacity;
    const capClass = used > total ? "cap-over" : "";
    const assignCount = fin.rows.length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.companyName)}</td>
      <td>${escapeHtml(p.projectName)}</td>
      <td>${money(p.budget)}</td>
      <td class="${capClass}">${used.toFixed(2)}/${total}</td>
      <td><button type="button" class="btn btn--sm link-btn" data-show-employees="${p.id}">Show Employees (${assignCount})</button></td>
      <td class="${moneyClass(fin.income)}">${money(fin.income)}</td>
      <td class="cell-actions"><button type="button" class="btn btn--sm btn--danger" data-del-project="${p.id}">Delete</button></td>
    `;
    tb.appendChild(tr);
  }
  renderFilterChips(
    "projects-filter-chips",
    state.projectFilters,
    (k) => {
      delete state.projectFilters[k];
      refresh();
    },
    () => {
      state.projectFilters = {};
      refresh();
    },
  );
}

function projectSortGetter(col, employees) {
  return (p) => {
    if (col === "companyName") return p.companyName;
    if (col === "projectName") return p.projectName;
    if (col === "budget") return p.budget;
    if (col === "capacity") {
      const fin = projectFinancialBundle(p, employees, state.year, state.month);
      return fin.usedEffective;
    }
    if (col === "income") {
      return projectFinancialBundle(p, employees, state.year, state.month).income;
    }
    return "";
  };
}

function renderEmployeesTable(employees, projects) {
  let rows = employees.filter(passesEmployeeFilters);
  const s = state.employeeSort;
  if (s.col) {
    rows = sortRows(rows, s.col, s.dir, (e) => employeeSortGetter(e, projects, s.col));
  }
  const tb = $("#employees-tbody");
  tb.innerHTML = "";
  for (const e of rows) {
    const m = employeeMetricsFull(e, projects, state.year, state.month, employees);
    const nAssign = (e.assignments || []).length;
    const capTxt = `${m.totalCap.toFixed(1)}/${MAX_EMPLOYEE_CAPACITY}`;
    const age = ageFromDob(e.dateOfBirth);
    const tr = document.createElement("tr");
    tr.dataset.employeeId = e.id;
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.surname)}</td>
      <td>${age}</td>
      <td class="cell-position" data-emp="${e.id}">${escapeHtml(e.position)}</td>
      <td class="cell-salary" data-emp="${e.id}">${money(e.salary)}</td>
      <td>${money(m.estimatedPayment)}</td>
      <td><button type="button" class="btn btn--sm link-btn" data-show-assignments="${e.id}">Show Assignments (${nAssign}) ${capTxt}</button></td>
      <td class="${moneyClass(m.projectedIncome)}">${money(m.projectedIncome)}</td>
      <td class="cell-actions">
        <button type="button" class="btn btn--sm" data-cal="${e.id}">Availability</button>
        <button type="button" class="btn btn--sm" data-assign="${e.id}" ${m.totalCap >= MAX_EMPLOYEE_CAPACITY ? "disabled" : ""}>Assign</button>
        <button type="button" class="btn btn--sm btn--danger" data-del-emp="${e.id}">Delete</button>
      </td>
    `;
    tb.appendChild(tr);
  }
  renderFilterChips(
    "employees-filter-chips",
    state.employeeFilters,
    (k) => {
      delete state.employeeFilters[k];
      refresh();
    },
    () => {
      state.employeeFilters = {};
      refresh();
    },
  );
}

function employeeSortGetter(e, projects, col) {
  const all = getMonthSnapshot().employees;
  const m = employeeMetricsFull(e, projects, state.year, state.month, all);
  if (col === "name") return e.name;
  if (col === "surname") return e.surname;
  if (col === "age") return ageFromDob(e.dateOfBirth);
  if (col === "position") return e.position;
  if (col === "salary") return e.salary;
  if (col === "estimatedPayment") return m.estimatedPayment;
  if (col === "projectedIncome") return m.projectedIncome;
  return "";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateSortIcons() {
  $$("#projects-table [data-sort-icon]").forEach((el) => {
    el.textContent = "⇅";
    el.closest("button")?.classList.remove("is-sorted");
  });
  $$("#employees-table [data-sort-icon]").forEach((el) => {
    el.textContent = "⇅";
    el.closest("button")?.classList.remove("is-sorted");
  });
  const ps = state.projectSort;
  if (ps.col) {
    const btn = $(`#projects-table [data-col="${ps.col}"][data-sort]`);
    const icon = btn?.querySelector("[data-sort-icon]");
    if (icon) {
      icon.textContent = ps.dir === "asc" ? "↑" : "↓";
      btn.classList.add("is-sorted");
    }
  }
  const es = state.employeeSort;
  if (es.col) {
    const btn = $(`#employees-table [data-col="${es.col}"][data-sort]`);
    const icon = btn?.querySelector("[data-sort-icon]");
    if (icon) {
      icon.textContent = es.dir === "asc" ? "↑" : "↓";
      btn.classList.add("is-sorted");
    }
  }
}

function openPanel(id) {
  $("#overlay-panels").hidden = false;
  $(id).classList.add("is-open");
  $(id).setAttribute("aria-hidden", "false");
}

function closePanels() {
  $$(".panel.is-open").forEach((p) => {
    p.classList.remove("is-open");
    p.setAttribute("aria-hidden", "true");
  });
  $("#overlay-panels").hidden = true;
}

function openModal(id) {
  $("#modal-backdrop").hidden = false;
  const m = $(id);
  m.hidden = false;
}

function closeModals() {
  $("#modal-backdrop").hidden = true;
  $$(".modal").forEach((m) => {
    m.hidden = true;
  });
}

function populatePeriodSelectors() {
  const sm = $("#select-month");
  const sy = $("#select-year");
  sm.innerHTML = MONTH_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
  sy.innerHTML = YEARS.map((y) => `<option value="${y}">${y}</option>`).join("");
  sm.value = String(state.month);
  sy.value = String(state.year);
}

function populatePositionSelects() {
  const sel = $("#emp-position");
  const opts = ['<option value="">Select position</option>', ...POSITIONS.map((p) => `<option value="${p}">${p}</option>`)];
  sel.innerHTML = opts.join("");
}

function validateEmployeeForm() {
  const name = $("#emp-name").value.trim();
  const surname = $("#emp-surname").value.trim();
  const dob = $("#emp-dob").value;
  const position = $("#emp-position").value;
  const salary = $("#emp-salary").value;

  const err = { name: "", surname: "", dob: "", position: "", salary: "" };
  if (!/^[A-Za-z]{3,}$/.test(name)) err.name = "Name must be at least 3 characters and contain only letters";
  if (!/^[A-Za-z]{3,}$/.test(surname)) err.surname = "Surname must be at least 3 characters and contain only letters";
  if (!dob) err.dob = "Required";
  else if (ageFromDob(dob) < 18) err.dob = "You must be at least 18 years old";
  if (!position) err.position = "Please select a position";
  const saln = Number(salary);
  if (!salary || Number.isNaN(saln) || saln <= 0) err.salary = "Salary must be greater than 0";

  for (const k of Object.keys(err)) {
    const span = $(`[data-error-for="${k}"]`);
    if (span) span.textContent = err[k];
  }
  const ok = !Object.values(err).some(Boolean);
  $("#emp-submit").disabled = !ok;
  return ok;
}

function validateProjectForm() {
  const projectName = $("#proj-name").value.trim();
  const companyName = $("#proj-company").value.trim();
  const budget = $("#proj-budget").value;
  const cap = $("#proj-capacity").value;
  const err = { projectName: "", companyName: "", budget: "", employeeCapacity: "" };
  if (!/^[A-Za-z0-9 ]{3,}$/.test(projectName)) err.projectName = "Project name must be at least 3 characters";
  if (!/^[A-Za-z0-9 ]{2,}$/.test(companyName)) err.companyName = "Company name must be at least 2 characters";
  const bn = Number(budget);
  if (!budget || Number.isNaN(bn) || bn <= 0) err.budget = "Budget must be greater than 0";
  const cn = Number(cap);
  if (!cap || Number.isNaN(cn) || cn < 1 || !Number.isInteger(cn)) err.employeeCapacity = "Employee capacity must be at least 1";

  for (const k of Object.keys(err)) {
    const span = $(`[data-error-for="${k}"]`);
    if (span) span.textContent = err[k];
  }
  const ok = !Object.values(err).some(Boolean);
  $("#proj-submit").disabled = !ok;
  return ok;
}

function bindForms() {
  const empForm = $("#form-employee");
  ["input", "blur", "change"].forEach((ev) => {
    empForm.addEventListener(ev, () => validateEmployeeForm());
  });
  empForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateEmployeeForm()) return;
    addEmployee(state.store, currentKey(), {
      name: $("#emp-name").value,
      surname: $("#emp-surname").value,
      dateOfBirth: $("#emp-dob").value,
      position: $("#emp-position").value,
      salary: $("#emp-salary").value,
    });
    persist();
    empForm.reset();
    validateEmployeeForm();
    closePanels();
    refresh();
  });
  $("#emp-cancel").addEventListener("click", () => {
    closePanels();
    empForm.reset();
    validateEmployeeForm();
  });

  const projForm = $("#form-project");
  ["input", "blur", "change"].forEach((ev) => {
    projForm.addEventListener(ev, () => validateProjectForm());
  });
  projForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateProjectForm()) return;
    addProject(state.store, currentKey(), {
      projectName: $("#proj-name").value,
      companyName: $("#proj-company").value,
      budget: $("#proj-budget").value,
      employeeCapacity: $("#proj-capacity").value,
    });
    persist();
    projForm.reset();
    validateProjectForm();
    closePanels();
    refresh();
  });
  $("#proj-cancel").addEventListener("click", () => {
    closePanels();
    projForm.reset();
    validateProjectForm();
  });
}

function bindSidebar() {
  $("#sidebar-toggle").addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    $("#sidebar").classList.toggle("is-collapsed", state.sidebarCollapsed);
    $("#sidebar-open").hidden = !state.sidebarCollapsed;
  });
  $("#sidebar-open").addEventListener("click", () => {
    state.sidebarCollapsed = false;
    $("#sidebar").classList.remove("is-collapsed");
    $("#sidebar-open").hidden = true;
  });

  $("#select-month").addEventListener("change", (e) => {
    state.month = Number(e.target.value);
    getMonthSnapshot();
    persist();
    refresh();
  });
  $("#select-year").addEventListener("change", (e) => {
    state.year = Number(e.target.value);
    getMonthSnapshot();
    persist();
    refresh();
  });

  $$(".nav-tabs__btn").forEach((b) => {
    b.addEventListener("click", () => {
      const tab = b.dataset.tab;
      state.tab = tab;
      $$(".nav-tabs__btn").forEach((x) => x.classList.toggle("is-active", x === b));
      $("#view-projects").classList.toggle("is-active", tab === "projects");
      $("#view-employees").classList.toggle("is-active", tab === "employees");
    });
  });
}

function cycleSort(table, col) {
  const key = table === "projects" ? "projectSort" : "employeeSort";
  const s = state[key];
  if (s.col !== col) {
    s.col = col;
    s.dir = "asc";
  } else if (s.dir === "asc") {
    s.dir = "desc";
  } else {
    s.col = null;
    s.dir = "asc";
  }
  refresh();
}

function bindTableHeaders() {
  $("#projects-table").addEventListener("click", (e) => {
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn && !e.target.closest(".filter-icon")) {
      cycleSort("projects", sortBtn.dataset.col);
    }
    const filt = e.target.closest("[data-filter]");
    if (filt && e.target.closest(".filter-icon")) {
      openFilterPopup(filt, "projects", filt.dataset.col);
    }
  });
  $("#employees-table").addEventListener("click", (e) => {
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn && !e.target.closest(".filter-icon")) {
      cycleSort("employees", sortBtn.dataset.col);
    }
    const filt = e.target.closest("[data-filter]");
    if (filt && e.target.closest(".filter-icon")) {
      openFilterPopup(filt, "employees", filt.dataset.col);
    }
  });
}

function openFilterPopup(anchorBtn, table, col) {
  const popup = $("#filter-popup");
  const rect = anchorBtn.getBoundingClientRect();
  popup.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  const textWrap = $("#filter-popup-text-wrap");
  const selWrap = $("#filter-popup-select-wrap");
  state.filterTarget = { table, col };
  if (col === "position") {
    textWrap.hidden = true;
    selWrap.hidden = false;
    const fs = $("#filter-select");
    fs.innerHTML = ['<option value="">Any</option>', ...POSITIONS.map((p) => `<option value="${p}">${p}</option>`)].join("");
    fs.value = state.employeeFilters.position || "";
    fs.onchange = () => {
      if (fs.value) state.employeeFilters.position = fs.value;
      else delete state.employeeFilters.position;
      refresh();
      closeFilterPopup();
    };
  } else {
    textWrap.hidden = false;
    selWrap.hidden = true;
    $("#filter-input").value =
      table === "projects"
        ? state.projectFilters[col] || ""
        : state.employeeFilters[col] || "";
  }
  popup.hidden = false;
}

function closeFilterPopup() {
  $("#filter-popup").hidden = true;
  state.filterTarget = null;
}

$("#filter-apply")?.addEventListener("click", () => {
  if (!state.filterTarget) return;
  const { table, col } = state.filterTarget;
  const v = $("#filter-input").value.trim();
  if (table === "projects") {
    if (v) state.projectFilters[col] = v;
    else delete state.projectFilters[col];
  } else {
    if (v) state.employeeFilters[col] = v;
    else delete state.employeeFilters[col];
  }
  refresh();
  closeFilterPopup();
});
$("#filter-popup-cancel")?.addEventListener("click", closeFilterPopup);

function bindTableBodyClicks() {
  document.body.addEventListener("click", (e) => {
    if (e.target.closest("#filter-popup")) return;
    if (!e.target.closest(".th-btn")) closeFilterPopup();
    if (
      !e.target.closest("#action-menu") &&
      !e.target.closest("[data-emp-menu]") &&
      !e.target.closest("[data-proj-menu]")
    ) {
      closeActionMenu();
    }
  });

  $("#projects-tbody").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del-project]");
    if (del) {
      const id = del.dataset.delProject;
      const p = getMonthSnapshot().projects.find((x) => x.id === id);
      if (p && confirm(`Delete project "${p.projectName}"?`)) {
        deleteProject(state.store, currentKey(), id);
        persist();
        refresh();
      }
      return;
    }
    const sh = e.target.closest("[data-show-employees]");
    if (sh) openProjectEmployeesModal(sh.dataset.showEmployees);
  });

  $("#employees-tbody").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del-emp]");
    if (del) {
      const id = del.dataset.delEmp;
      const emp = getMonthSnapshot().employees.find((x) => x.id === id);
      if (emp && confirm(`Delete employee ${emp.name} ${emp.surname}?`)) {
        deleteEmployee(state.store, currentKey(), id);
        persist();
        refresh();
      }
      return;
    }
    const cal = e.target.closest("[data-cal]");
    if (cal) openCalendar(cal.dataset.cal);
    const asn = e.target.closest("[data-assign]");
    if (asn) openAssignPopover(asn, asn.dataset.assign, "new");
    const sa = e.target.closest("[data-show-assignments]");
    if (sa) openEmployeeAssignmentsModal(sa.dataset.showAssignments);
  });
}

function openProjectEmployeesModal(projectId) {
  const { employees, projects } = getMonthSnapshot();
  const p = projects.find((x) => x.id === projectId);
  if (!p) return;
  const fin = projectFinancialBundle(p, employees, state.year, state.month);
  $("#project-employees-title").textContent = `${p.projectName} — employees`;
  const body = $("#project-employees-body");
  if (fin.rows.length === 0) {
    body.innerHTML = "<p>No employees assigned.</p>";
  } else {
    const rows = fin.rows
      .map((r) => {
        const e = r.employee;
        const a = r.assignment;
        const vc = vacationCoefficient(e, state.year, state.month);
        const vfmt = formatVacationRanges(e.vacationDays || [], state.year, state.month);
        const name = `${escapeHtml(e.name)} ${escapeHtml(e.surname)}`;
        return `<tr>
          <td><button type="button" class="link-btn" data-emp-menu="${e.id}" data-from-project="${p.id}">${name}</button></td>
          <td>${a.capacity.toFixed(2)}</td>
          <td>${a.fit.toFixed(2)}</td>
          <td>${escapeHtml(vfmt)} (coeff ${vc.toFixed(3)})</td>
          <td>${r.effective.toFixed(3)}</td>
          <td>${money(r.revenue)}</td>
          <td>${money(r.cost)}</td>
          <td class="${moneyClass(r.profit)}">${money(r.profit)}</td>
          <td class="cell-actions">
            <button type="button" class="btn btn--sm" data-edit-asg="${e.id}" data-proj="${p.id}">Edit</button>
            <button type="button" class="btn btn--sm" data-unassign="${e.id}" data-proj="${p.id}">Unassign</button>
          </td>
        </tr>`;
      })
      .join("");
    body.innerHTML = `<table class="detail-table"><thead><tr>
      <th>Employee</th><th>Capacity</th><th>Fit</th><th>Vacation</th><th>Eff. cap.</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Actions</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }
  openModal("#modal-project-employees");
}

function openEmployeeAssignmentsModal(employeeId) {
  const { employees, projects } = getMonthSnapshot();
  const e = employees.find((x) => x.id === employeeId);
  if (!e) return;
  const pmap = Object.fromEntries(projects.map((x) => [x.id, x]));
  $("#employee-assignments-title").textContent = `${e.name} ${e.surname} — assignments`;
  const body = $("#employee-assignments-body");
  const assigns = e.assignments || [];
  if (assigns.length === 0) {
    body.innerHTML = "<p>No assignments.</p>";
  } else {
    const allAssigneesFor = (proj) => {
      const list = [];
      for (const emp of employees) {
        for (const as of emp.assignments || []) {
          if (as.projectId === proj.id) list.push({ employee: emp, assignment: as });
        }
      }
      return list;
    };
    const rows = assigns
      .map((a) => {
        const proj = pmap[a.projectId];
        if (!proj) return "";
        const fin = assignmentFinancials(proj, e, a, state.year, state.month, allAssigneesFor(proj));
        const vfmt = formatVacationRanges(e.vacationDays || [], state.year, state.month);
        const pname = escapeHtml(proj.projectName);
        return `<tr>
          <td><button type="button" class="link-btn" data-proj-menu="${proj.id}" data-from-emp="${e.id}">${pname}</button></td>
          <td>${a.capacity.toFixed(2)}</td>
          <td>${a.fit.toFixed(2)}</td>
          <td>${escapeHtml(vfmt)}</td>
          <td>${fin.effective.toFixed(3)}</td>
          <td>${money(fin.revenue)}</td>
          <td>${money(fin.cost)}</td>
          <td class="${moneyClass(fin.profit)}">${money(fin.profit)}</td>
          <td class="cell-actions">
            <button type="button" class="btn btn--sm" data-edit-asg="${e.id}" data-proj="${proj.id}">Edit</button>
            <button type="button" class="btn btn--sm" data-unassign="${e.id}" data-proj="${proj.id}">Unassign</button>
          </td>
        </tr>`;
      })
      .join("");
    body.innerHTML = `<table class="detail-table"><thead><tr>
      <th>Project</th><th>Capacity</th><th>Fit</th><th>Vacation days</th><th>Eff. cap.</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Actions</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }
  openModal("#modal-employee-assignments");
}

function bindDetailModals() {
  $("#modal-project-employees").addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]") || e.target === $("#modal-project-employees")) {
      $("#modal-project-employees").hidden = true;
      $("#modal-backdrop").hidden = true;
    }
    const menuBtn = e.target.closest("[data-emp-menu]");
    if (menuBtn) {
      e.stopPropagation();
      openEmployeeNameMenu(menuBtn, menuBtn.dataset.empMenu, menuBtn.dataset.fromProject);
      return;
    }
    const edit = e.target.closest("[data-edit-asg]");
    if (edit) {
      openAssignPopover(edit, edit.dataset.editAsg, "edit", edit.dataset.proj);
    }
    const un = e.target.closest("[data-unassign]");
    if (un) openUnassignModal(un.dataset.unassign, un.dataset.proj);
  });

  $("#modal-employee-assignments").addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]") || e.target === $("#modal-employee-assignments")) {
      $("#modal-employee-assignments").hidden = true;
      $("#modal-backdrop").hidden = true;
    }
    const menuBtn = e.target.closest("[data-proj-menu]");
    if (menuBtn) {
      e.stopPropagation();
      openProjectNameMenu(menuBtn, menuBtn.dataset.projMenu, menuBtn.dataset.fromEmp);
      return;
    }
    const edit = e.target.closest("[data-edit-asg]");
    if (edit) {
      openAssignPopover(edit, edit.dataset.editAsg, "edit", edit.dataset.proj);
    }
    const un = e.target.closest("[data-unassign]");
    if (un) openUnassignModal(un.dataset.unassign, un.dataset.proj);
  });
}

function hideAllModals() {
  $$(".modal").forEach((m) => {
    m.hidden = true;
  });
  $("#modal-backdrop").hidden = true;
}

function closeActionMenu() {
  const m = $("#action-menu");
  if (m) m.hidden = true;
}

function navigateToEmployee(empId) {
  const emp = getMonthSnapshot().employees.find((x) => x.id === empId);
  hideAllModals();
  state.tab = "employees";
  $$(".nav-tabs__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "employees"));
  $("#view-projects").classList.remove("is-active");
  $("#view-employees").classList.add("is-active");
  state.employeeFilters = { name: emp?.name || "", surname: emp?.surname || "" };
  refresh();
}

function navigateToProject(projId) {
  const p = getMonthSnapshot().projects.find((x) => x.id === projId);
  hideAllModals();
  state.tab = "projects";
  $$(".nav-tabs__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === "projects"));
  $("#view-employees").classList.remove("is-active");
  $("#view-projects").classList.add("is-active");
  state.projectFilters = { projectName: p?.projectName || "" };
  refresh();
}

function positionActionMenu(anchor, menu) {
  const r = anchor.getBoundingClientRect();
  let top = r.bottom + 4;
  let left = r.left;
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 80;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openEmployeeNameMenu(anchor, employeeId, projectId) {
  const menu = $("#action-menu");
  menu.innerHTML = "";
  const b1 = document.createElement("button");
  b1.type = "button";
  b1.textContent = "See at Employees";
  b1.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeActionMenu();
    navigateToEmployee(employeeId);
  });
  const b2 = document.createElement("button");
  b2.type = "button";
  b2.textContent = "Unassign";
  b2.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeActionMenu();
    hideAllModals();
    openUnassignModal(employeeId, projectId);
  });
  menu.appendChild(b1);
  menu.appendChild(b2);
  menu.hidden = false;
  positionActionMenu(anchor, menu);
}

function openProjectNameMenu(anchor, projectId, employeeId) {
  const menu = $("#action-menu");
  menu.innerHTML = "";
  const b1 = document.createElement("button");
  b1.type = "button";
  b1.textContent = "See at Projects";
  b1.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeActionMenu();
    navigateToProject(projectId);
  });
  const b2 = document.createElement("button");
  b2.type = "button";
  b2.textContent = "Unassign";
  b2.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeActionMenu();
    hideAllModals();
    openUnassignModal(employeeId, projectId);
  });
  menu.appendChild(b1);
  menu.appendChild(b2);
  menu.hidden = false;
  positionActionMenu(anchor, menu);
}

$("#modal-backdrop").addEventListener("click", () => {
  hideAllModals();
  closeAssignPopover();
});

function openUnassignModal(employeeId, projectId) {
  const { employees, projects } = getMonthSnapshot();
  const e = employees.find((x) => x.id === employeeId);
  const p = projects.find((x) => x.id === projectId);
  if (!e || !p) return;
  const asg = (e.assignments || []).find((a) => a.projectId === projectId);
  if (!asg) return;
  const allAssignees = [];
  for (const emp of employees) {
    for (const a of emp.assignments || []) {
      if (a.projectId === p.id) allAssignees.push({ employee: emp, assignment: a });
    }
  }
  const fin = assignmentFinancials(p, e, asg, state.year, state.month, allAssignees);
  const bundle = projectFinancialBundle(p, employees, state.year, state.month);
  const incomeAfter = projectIncomeBeforeAfterUnassign(p, employees, state.year, state.month, employeeId, projectId);
  const employeesAfter = employees.map((emp) => {
    if (emp.id !== employeeId) return emp;
    return { ...emp, assignments: (emp.assignments || []).filter((x) => x.projectId !== projectId) };
  });
  const usedAfter = projectFinancialBundle(p, employeesAfter, state.year, state.month).usedEffective;
  const usedBefore = bundle.usedEffective;
  const capRev = fin.capacityForRevenue;
  const budgetShare = capRev > 0 ? (p.budget * fin.effective) / capRev : 0;
  const salaryShare = e.salary * asg.capacity;

  state.unassignContext = { employeeId, projectId };
  $("#unassign-body").innerHTML = `
    <dl class="unassign-grid">
      <dt>Employee</dt><dd>${escapeHtml(e.name)} ${escapeHtml(e.surname)}</dd>
      <dt>Project</dt><dd>${escapeHtml(p.projectName)}</dd>
      <dt>Assigned capacity</dt><dd>${asg.capacity.toFixed(2)}</dd>
      <dt>Salary share</dt><dd>${money(salaryShare)}</dd>
      <dt>Budget share (eff. slot)</dt><dd>${money(budgetShare)}</dd>
      <dt>Assignment profit</dt><dd class="${moneyClass(fin.profit)}">${money(fin.profit)}</dd>
      <dt>Project used eff. (before → after)</dt><dd>${usedBefore.toFixed(2)} → ${usedAfter.toFixed(2)} / ${p.employeeCapacity}</dd>
      <dt>Project income (before → after)</dt><dd><span class="${moneyClass(bundle.income)}">${money(bundle.income)}</span> → <span class="${moneyClass(incomeAfter)}">${money(incomeAfter)}</span></dd>
    </dl>`;
  openModal("#modal-unassign");
}

$("#unassign-close").addEventListener("click", hideAllModals);
$("#unassign-cancel").addEventListener("click", hideAllModals);
$("#unassign-confirm").addEventListener("click", () => {
  const c = state.unassignContext;
  if (!c) return;
  unassign(state.store, currentKey(), c.employeeId, c.projectId);
  persist();
  hideAllModals();
  refresh();
});

function openAssignPopover(anchorEl, employeeId, mode, projectIdOpt) {
  const { employees, projects } = getMonthSnapshot();
  const e = employees.find((x) => x.id === employeeId);
  if (!e) return;
  if (projects.length === 0) {
    alert("Add a project first.");
    return;
  }
  const pop = $("#assign-popover");
  const capSlider = $("#assign-capacity");
  const fitSlider = $("#assign-fit");
  const projSel = $("#assign-project");

  let otherCap = employeeTotalAssignedCapacity(e);
  if (mode === "edit" && projectIdOpt) {
    const ex = (e.assignments || []).find((a) => a.projectId === projectIdOpt);
    if (ex) otherCap -= ex.capacity;
  }

  projSel.innerHTML = projects
    .map((p) => {
      const used = usedEffectiveOnProject(p, employees, state.year, state.month);
      return `<option value="${p.id}">${escapeHtml(p.projectName)} (${used.toFixed(2)}/${p.employeeCapacity})</option>`;
    })
    .join("");

  let initialProj = projectIdOpt || (projects[0]?.id ?? "");
  if (mode === "edit" && projectIdOpt) initialProj = projectIdOpt;
  projSel.value = initialProj;

  let initialCap = 0.5;
  let initialFit = 0.8;
  if (mode === "edit" && projectIdOpt) {
    const ex = (e.assignments || []).find((a) => a.projectId === projectIdOpt);
    if (ex) {
      initialCap = ex.capacity;
      initialFit = ex.fit;
    }
  }
  capSlider.value = String(Math.round(initialCap * 10));
  fitSlider.value = String(Math.round(initialFit * 10));

  state.assignContext = { employeeId, mode, projectIdOpt, otherCap, anchorEl };

  const updateHint = () => {
    const cap = Number(capSlider.value) / 10;
    const fit = Number(fitSlider.value) / 10;
    const pid = projSel.value;
    const p = projects.find((x) => x.id === pid);
    $("#assign-cap-label").textContent = `(${cap.toFixed(1)})`;
    $("#assign-fit-label").textContent = `(${fit.toFixed(1)})`;
    $("#assign-meta").textContent = `Other assignments: ${otherCap.toFixed(1)} / ${MAX_EMPLOYEE_CAPACITY} · Room: ${(MAX_EMPLOYEE_CAPACITY - otherCap).toFixed(1)}`;
    const eff = cap * fit * vacationCoefficient(e, state.year, state.month);
    let hint = `Effective (× vacation): ${eff.toFixed(3)}`;
    if (p) {
      const curUsed = usedEffectiveOnProject(p, employees, state.year, state.month);
      const oldAsg = (e.assignments || []).find((a) => a.projectId === pid);
      const prevEff = oldAsg ? effectiveAssignmentCapacity(oldAsg, e, state.year, state.month) : 0;
      const newUsed = curUsed - prevEff + eff;
      hint += ` · Project eff. used would be ${newUsed.toFixed(2)}/${p.employeeCapacity}`;
      if (newUsed > p.employeeCapacity) hint += " (over capacity)";
    }
    $("#assign-hint").textContent = hint;
  };

  projSel.onchange = updateHint;
  capSlider.oninput = updateHint;
  fitSlider.oninput = updateHint;
  updateHint();

  $("#assign-title").textContent = mode === "edit" ? "Edit assignment" : "Assign to project";

  positionAssignPopover(anchorEl);
  $("#popover-backdrop").hidden = false;
  pop.hidden = false;

  const onScroll = () => positionAssignPopover(anchorEl);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  state.assignScrollCleanup = () => {
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
  };
}

function positionAssignPopover(anchorEl) {
  const pop = $("#assign-popover");
  const rect = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth || 320;
  const ph = pop.offsetHeight || 400;
  let left = rect.right + 8;
  let top = rect.top;
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8;
  if (left < 8) left = 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  if (top < 8) top = 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function closeAssignPopover() {
  $("#assign-popover").hidden = true;
  $("#popover-backdrop").hidden = true;
  if (state.assignScrollCleanup) state.assignScrollCleanup();
  state.assignScrollCleanup = null;
  state.assignContext = null;
}

$("#popover-backdrop").addEventListener("click", closeAssignPopover);
$("#assign-cancel").addEventListener("click", closeAssignPopover);
$("#assign-save").addEventListener("click", () => {
  const ctx = state.assignContext;
  if (!ctx) return;
  const cap = Number($("#assign-capacity").value) / 10;
  const fit = Number($("#assign-fit").value) / 10;
  const pid = $("#assign-project").value;
  const removeId = ctx.mode === "edit" ? ctx.projectIdOpt : null;
  const ok = setAssignmentFull(state.store, currentKey(), ctx.employeeId, pid, cap, fit, removeId);
  if (!ok) {
    alert("Employee capacity cannot exceed 1.5");
    return;
  }
  persist();
  closeAssignPopover();
  refresh();
});

function openCalendar(employeeId) {
  const { employees } = getMonthSnapshot();
  const e = employees.find((x) => x.id === employeeId);
  if (!e) return;
  state.calendarEmployeeId = employeeId;
  state.calendarDraft = [...(e.vacationDays || [])];
  $("#calendar-title").textContent = `Availability — ${e.name} ${e.surname}`;
  renderCalendarGrid();
  updateCalendarMeta();
  openModal("#modal-calendar");
}

function renderCalendarGrid() {
  const grid = $("#calendar-grid");
  grid.innerHTML = "";
  const y = state.year;
  const m = state.month;
  const firstWd = new Date(y, m, 1).getDay();
  const dim = daysInMonth(y, m);
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  dows.forEach((d) => {
    const c = document.createElement("div");
    c.className = "calendar__dow";
    c.textContent = d;
    grid.appendChild(c);
  });
  for (let i = 0; i < firstWd; i++) {
    const pad = document.createElement("div");
    pad.className = "calendar__day calendar__day--muted";
    grid.appendChild(pad);
  }
  const today = new Date();
  for (let d = 1; d <= dim; d++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar__day";
    cell.textContent = String(d);
    if (isWeekend(y, m, d)) cell.classList.add("calendar__day--weekend");
    if (y === today.getFullYear() && m === today.getMonth() && d === today.getDate()) cell.classList.add("calendar__day--today");
    if (state.calendarDraft.includes(d)) cell.classList.add("calendar__day--vacation");
    cell.addEventListener("click", () => {
      if (state.calendarDraft.includes(d)) state.calendarDraft = state.calendarDraft.filter((x) => x !== d);
      else state.calendarDraft.push(d);
      state.calendarDraft.sort((a, b) => a - b);
      renderCalendarGrid();
      updateCalendarMeta();
    });
    grid.appendChild(cell);
  }
}

function updateCalendarMeta() {
  const y = state.year;
  const m = state.month;
  const wd = workingDaysInMonth(y, m);
  const vw = vacationWeekdays({ vacationDays: state.calendarDraft }, y, m);
  const actual = wd - vw;
  $("#calendar-working").textContent = `Working Days: ${actual}/${wd} days`;
  $("#calendar-ranges").textContent = `Vacation: ${formatVacationRanges(state.calendarDraft, y, m)}`;
}

$("#calendar-save").addEventListener("click", () => {
  if (!state.calendarEmployeeId) return;
  setVacations(state.store, currentKey(), state.calendarEmployeeId, state.calendarDraft);
  persist();
  hideAllModals();
  refresh();
});
$$("[data-close-calendar]").forEach((b) => b.addEventListener("click", hideAllModals));

function bindSeed() {
  $("#btn-seed-data").addEventListener("click", () => {
    const key = currentKey();
    const rows = [];
    for (const k of Object.keys(state.store)) {
      if (k === key) continue;
      const snap = state.store[k];
      if (!snap || (!snap.employees?.length && !snap.projects?.length)) continue;
      const [ys, ms] = k.split("-").map(Number);
      const inc = totalEstimatedIncome(snap.projects || [], snap.employees || [], ys, ms);
      rows.push({ key: k, ys, ms, snap, inc });
    }
    const tb = $("#seed-tbody");
    tb.innerHTML = rows
      .map((r) => {
        const cls = moneyClass(r.inc);
        return `<tr>
          <td>${r.ys}</td>
          <td>${MONTH_NAMES[r.ms]}</td>
          <td>${r.snap.projects?.length || 0}</td>
          <td>${r.snap.employees?.length || 0}</td>
          <td class="${cls}">${money(r.inc)}</td>
          <td><button type="button" class="btn btn--sm btn--primary" data-seed="${r.key}">Seed</button></td>
        </tr>`;
      })
      .join("");
    $("#seed-hint").textContent = `Select a month to copy its data to the current month (${MONTH_NAMES[state.month]} ${state.year}).`;
    openModal("#modal-seed");
  });
  $("#seed-close").addEventListener("click", hideAllModals);
  $("#seed-tbody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seed]");
    if (!b) return;
    const from = b.dataset.seed;
    const [ys, ms] = from.split("-").map(Number);
    if (
      confirm(
        `Copy data from ${MONTH_NAMES[ms]} ${ys} to ${MONTH_NAMES[state.month]} ${state.year}? Vacation days will be cleared.`,
      )
    ) {
      seedMonth(state.store, from, currentKey());
      persist();
      hideAllModals();
      refresh();
    }
  });
}

function bindInlineEdit() {
  $("#employees-tbody").addEventListener("click", (e) => {
    const posCell = e.target.closest(".cell-position");
    if (posCell && !posCell.querySelector("select")) {
      const id = posCell.dataset.emp;
      const emp = getMonthSnapshot().employees.find((x) => x.id === id);
      if (!emp) return;
      const cur = emp.position;
      const sel = document.createElement("select");
      sel.className = "inline-edit";
      sel.innerHTML = POSITIONS.map((p) => `<option value="${p}" ${p === cur ? "selected" : ""}>${p}</option>`).join("");
      posCell.textContent = "";
      posCell.appendChild(sel);
      sel.focus();
      const done = () => {
        updateEmployeeField(state.store, currentKey(), id, "position", sel.value);
        persist();
        refresh();
      };
      sel.addEventListener("change", done);
    }
    const salCell = e.target.closest(".cell-salary");
    if (salCell && !salCell.querySelector("input")) {
      const id = salCell.dataset.emp;
      const emp = getMonthSnapshot().employees.find((x) => x.id === id);
      if (!emp) return;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "0.01";
      inp.min = "0.01";
      inp.className = "inline-edit";
      inp.value = String(emp.salary);
      salCell.textContent = "";
      salCell.appendChild(inp);
      inp.focus();
      inp.select();
      const save = () => {
        const n = Number(inp.value);
        if (!Number.isNaN(n) && n > 0) {
          updateEmployeeField(state.store, currentKey(), id, "salary", n);
          persist();
        }
        refresh();
      };
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") save();
        if (ev.key === "Escape") refresh();
      });
      inp.addEventListener("blur", save);
    }
  });
}

function bindAddButtons() {
  $("#btn-add-employee").addEventListener("click", () => {
    $("#form-employee").reset();
    validateEmployeeForm();
    openPanel("#panel-employee");
  });
  $("#btn-add-project").addEventListener("click", () => {
    $("#form-project").reset();
    validateProjectForm();
    openPanel("#panel-project");
  });
  $("#overlay-panels").addEventListener("click", closePanels);
}

function init() {
  if (!YEARS.includes(state.year)) state.year = 2026;
  populatePeriodSelectors();
  populatePositionSelects();
  getMonthSnapshot();
  persist();
  bindSidebar();
  bindForms();
  bindTableHeaders();
  bindTableBodyClicks();
  bindDetailModals();
  bindSeed();
  bindInlineEdit();
  bindAddButtons();
  $("#filter-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#filter-apply").click();
    }
  });
  $$(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m) hideAllModals();
    });
  });
  validateEmployeeForm();
  validateProjectForm();
  refresh();
}

init();
