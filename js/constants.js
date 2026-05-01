export const STORAGE_KEY = "monthlyData";

export const POSITIONS = ["Junior", "Middle", "Senior", "Lead", "Architect", "BO"];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const YEARS = [2025, 2026, 2027];

export const MAX_EMPLOYEE_CAPACITY = 1.5;

export function monthKey(year, monthIndex) {
  return `${year}-${monthIndex}`;
}
