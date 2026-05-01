import { STORAGE_KEY, MAX_EMPLOYEE_CAPACITY } from "./constants.js";

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function ensureMonth(store, key) {
  if (!store[key]) {
    store[key] = { employees: [], projects: [] };
  }
  return store[key];
}

export function sampleData() {
  const e1 = {
    id: uid(),
    name: "Alice",
    surname: "Johnson",
    dateOfBirth: "1990-05-15",
    position: "Senior",
    salary: 8000,
    assignments: [],
    vacationDays: [],
  };
  const e2 = {
    id: uid(),
    name: "Bob",
    surname: "Smith",
    dateOfBirth: "1995-11-02",
    position: "Middle",
    salary: 5500,
    assignments: [],
    vacationDays: [],
  };
  const p1 = {
    id: uid(),
    projectName: "Alpha Platform",
    companyName: "Acme Corp",
    budget: 120000,
    employeeCapacity: 3,
  };
  return {
    employees: [e1, e2],
    projects: [p1],
  };
}

export function initIfEmpty(store, key) {
  ensureMonth(store, key);
  const hasAnyMonthData = Object.keys(store).some((k) => {
    const s = store[k];
    return s && ((s.employees && s.employees.length > 0) || (s.projects && s.projects.length > 0));
  });
  const snap = store[key];
  if (!hasAnyMonthData && snap.employees.length === 0 && snap.projects.length === 0) {
    const d = sampleData();
    snap.employees = d.employees;
    snap.projects = d.projects;
    snap.employees[0].assignments = [{ projectId: snap.projects[0].id, capacity: 0.8, fit: 0.9 }];
    snap.employees[1].assignments = [{ projectId: snap.projects[0].id, capacity: 0.6, fit: 1.0 }];
  }
}

export function seedMonth(store, fromKey, toKey) {
  const src = store[fromKey];
  if (!src) return;
  const copy = deepClone(src);
  for (const e of copy.employees) {
    e.vacationDays = [];
  }
  store[toKey] = copy;
}

export function addEmployee(store, key, payload) {
  const m = ensureMonth(store, key);
  const emp = {
    id: uid(),
    name: payload.name.trim(),
    surname: payload.surname.trim(),
    dateOfBirth: payload.dateOfBirth,
    position: payload.position,
    salary: Number(payload.salary),
    assignments: [],
    vacationDays: [],
  };
  m.employees.push(emp);
}

export function addProject(store, key, payload) {
  const m = ensureMonth(store, key);
  const proj = {
    id: uid(),
    projectName: payload.projectName.trim(),
    companyName: payload.companyName.trim(),
    budget: Number(payload.budget),
    employeeCapacity: Math.floor(Number(payload.employeeCapacity)),
  };
  m.projects.push(proj);
}

export function deleteEmployee(store, key, employeeId) {
  const m = ensureMonth(store, key);
  m.employees = m.employees.filter((e) => e.id !== employeeId);
}

export function deleteProject(store, key, projectId) {
  const m = ensureMonth(store, key);
  m.projects = m.projects.filter((p) => p.id !== projectId);
  for (const e of m.employees) {
    e.assignments = (e.assignments || []).filter((a) => a.projectId !== projectId);
  }
}

export function updateEmployeeField(store, key, employeeId, field, value) {
  const m = ensureMonth(store, key);
  const e = m.employees.find((x) => x.id === employeeId);
  if (!e) return;
  if (field === "salary") e.salary = Number(value);
  else if (field === "position") e.position = value;
}

export function setVacations(store, key, employeeId, days) {
  const m = ensureMonth(store, key);
  const e = m.employees.find((x) => x.id === employeeId);
  if (!e) return;
  e.vacationDays = [...days];
}

export function assignEmployee(store, key, employeeId, projectId, capacity, fit) {
  return setAssignmentFull(store, key, employeeId, projectId, capacity, fit, null);
}

/** @param {string|null} removeProjectId — assignment to drop first (edit or change project) */
export function setAssignmentFull(store, key, employeeId, projectId, capacity, fit, removeProjectId) {
  const m = ensureMonth(store, key);
  const e = m.employees.find((x) => x.id === employeeId);
  if (!e) return false;
  let next = [...(e.assignments || [])];
  if (removeProjectId) {
    next = next.filter((a) => a.projectId !== removeProjectId);
  }
  const idx = next.findIndex((a) => a.projectId === projectId);
  const row = { projectId, capacity, fit };
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  const total = next.reduce((s, a) => s + a.capacity, 0);
  if (total > MAX_EMPLOYEE_CAPACITY + 1e-9) return false;
  e.assignments = next;
  return true;
}

export function unassign(store, key, employeeId, projectId) {
  const m = ensureMonth(store, key);
  const e = m.employees.find((x) => x.id === employeeId);
  if (!e) return;
  e.assignments = (e.assignments || []).filter((a) => a.projectId !== projectId);
}

export { uid, deepClone };
