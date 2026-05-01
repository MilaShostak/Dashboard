import { MAX_EMPLOYEE_CAPACITY } from "./constants.js";

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Weekdays Mon–Fri in month */
export function workingDaysInMonth(year, monthIndex) {
  const last = daysInMonth(year, monthIndex);
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const wd = new Date(year, monthIndex, d).getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export function isWeekend(year, monthIndex, day) {
  const wd = new Date(year, monthIndex, day).getDay();
  return wd === 0 || wd === 6;
}

/** Vacation weekdays count for coefficient */
export function vacationWeekdays(employee, year, monthIndex) {
  const days = employee.vacationDays || [];
  const maxD = daysInMonth(year, monthIndex);
  let n = 0;
  for (const day of days) {
    if (day < 1 || day > maxD) continue;
    if (!isWeekend(year, monthIndex, day)) n++;
  }
  return n;
}

export function vacationCoefficient(employee, year, monthIndex) {
  const wd = workingDaysInMonth(year, monthIndex);
  if (wd === 0) return 1;
  const vw = vacationWeekdays(employee, year, monthIndex);
  return (wd - vw) / wd;
}

export function effectiveAssignmentCapacity(assignment, employee, year, monthIndex) {
  const vc = vacationCoefficient(employee, year, monthIndex);
  return assignment.capacity * assignment.fit * vc;
}

export function employeeTotalAssignedCapacity(employee) {
  const list = employee.assignments || [];
  return list.reduce((s, a) => s + a.capacity, 0);
}

export function assignmentCost(employee, capacity) {
  return employee.salary * Math.max(0.5, capacity);
}

/** Per-assignment revenue, cost, profit for employee on project */
export function assignmentFinancials(project, employee, assignment, year, monthIndex, allAssignees) {
  const assignees = allAssignees.filter((x) => x.assignment.projectId === project.id);
  let usedEff = 0;
  for (const { assignment: as, employee: emp } of assignees) {
    usedEff += effectiveAssignmentCapacity(as, emp, year, monthIndex);
  }
  const capRev = Math.max(project.employeeCapacity, usedEff);
  const revPer = capRev > 0 ? project.budget / capRev : 0;
  const eff = effectiveAssignmentCapacity(assignment, employee, year, monthIndex);
  const revenue = revPer * eff;
  const cost = assignmentCost(employee, assignment.capacity);
  const profit = revenue - cost;
  return { revenue, cost, profit, usedEffective: usedEff, capacityForRevenue: capRev, revPer, effective: eff };
}

export function projectFinancialBundle(project, employees, year, monthIndex) {
  const emap = Object.fromEntries(employees.map((e) => [e.id, e]));
  const assignees = [];
  for (const emp of employees) {
    for (const a of emp.assignments || []) {
      if (a.projectId === project.id) assignees.push({ employee: emp, assignment: a });
    }
  }
  let usedEff = 0;
  for (const { assignment: as, employee: emp } of assignees) {
    usedEff += effectiveAssignmentCapacity(as, emp, year, monthIndex);
  }
  const capRev = Math.max(project.employeeCapacity, usedEff);
  const revPer = capRev > 0 ? project.budget / capRev : 0;
  let totalRev = 0;
  let totalCost = 0;
  const rows = [];
  for (const { assignment: as, employee: emp } of assignees) {
    const eff = effectiveAssignmentCapacity(as, emp, year, monthIndex);
    const revenue = revPer * eff;
    const cost = assignmentCost(emp, as.capacity);
    totalRev += revenue;
    totalCost += cost;
    rows.push({
      employee: emp,
      assignment: as,
      revenue,
      cost,
      profit: revenue - cost,
      effective: eff,
    });
  }
  rows.sort((a, b) => {
    const na = `${a.employee.name} ${a.employee.surname}`;
    const nb = `${b.employee.name} ${b.employee.surname}`;
    return na.localeCompare(nb);
  });
  const income = totalRev - totalCost;
  return {
    usedEffective: usedEff,
    totalRevenue: totalRev,
    totalCost,
    income,
    rows,
    capacityForRevenue: capRev,
    revPer,
  };
}

export function employeeMetricsFull(employee, projects, year, monthIndex, allEmployees) {
  const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const assigns = employee.assignments || [];
  let estimatedPayment = 0;
  let projectedIncome = 0;
  if (assigns.length === 0) {
    estimatedPayment = employee.salary * 0.5;
  } else {
    for (const a of assigns) {
      estimatedPayment += assignmentCost(employee, a.capacity);
      const proj = pmap[a.projectId];
      if (!proj) continue;
      const allAssignees = [];
      for (const emp of allEmployees) {
        for (const as of emp.assignments || []) {
          if (as.projectId === proj.id) allAssignees.push({ employee: emp, assignment: as });
        }
      }
      const fin = assignmentFinancials(proj, employee, a, year, monthIndex, allAssignees);
      projectedIncome += fin.profit;
    }
  }
  const cap = employeeTotalAssignedCapacity(employee);
  return { estimatedPayment, projectedIncome, totalCap: cap };
}

export function totalEstimatedIncome(projects, employees, year, monthIndex) {
  let sum = 0;
  for (const p of projects) {
    sum += projectFinancialBundle(p, employees, year, monthIndex).income;
  }
  for (const e of employees) {
    if (!e.assignments || e.assignments.length === 0) {
      sum -= e.salary * 0.5;
    }
  }
  return sum;
}

export function projectIncomeBeforeAfterUnassign(project, employees, year, monthIndex, omitEmployeeId, omitProjectId) {
  const virtual = employees.map((emp) => {
    if (emp.id !== omitEmployeeId) return emp;
    return {
      ...emp,
      assignments: (emp.assignments || []).filter((a) => a.projectId !== omitProjectId),
    };
  });
  return projectFinancialBundle(project, virtual, year, monthIndex).income;
}

export function usedEffectiveOnProject(project, employees, year, monthIndex) {
  return projectFinancialBundle(project, employees, year, monthIndex).usedEffective;
}

/** Format vacation day ranges DD.MM */
export function formatVacationRanges(days, year, monthIndex) {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= daysInMonth(year, monthIndex)).sort((a, b) => a - b);
  if (sorted.length === 0) return "—";

  function onlyWeekendsBetween(y, m, fromDay, toDay) {
    for (let d = fromDay + 1; d < toDay; d++) {
      if (!isWeekend(y, m, d)) return false;
    }
    return true;
  }

  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${pad(d)}.${pad(monthIndex + 1)}`;

  for (let i = 1; i <= sorted.length; i++) {
    const next = sorted[i];
    if (next !== undefined && onlyWeekendsBetween(year, monthIndex, prev, next)) {
      prev = next;
      continue;
    }
    if (start === prev) parts.push(fmt(start));
    else parts.push(`${fmt(start)}-${fmt(prev)}`);
    if (next !== undefined) {
      start = next;
      prev = next;
    }
  }
  return parts.join(", ");
}

export function ageFromDob(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 0;
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
  return age;
}
