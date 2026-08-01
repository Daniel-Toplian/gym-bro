export const TRACKER_FIELDS = ["calories", "protein", "waterMl"];
export const TRACKER_KEEP_DAYS = 14;

const MAX_TRACKER_AMOUNT = 100_000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isAmount(value) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_TRACKER_AMOUNT;
}

export function todayKey(now) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return todayKey(new Date(year, month - 1, day + days).getTime());
}

export function emptyTotals() {
  return Object.fromEntries(TRACKER_FIELDS.map((field) => [field, 0]));
}

export function trackerTotals(log, dateKey) {
  return { ...emptyTotals(), ...log[dateKey] };
}

export function addTrackerAmount(log, dateKey, field, amount) {
  if (!TRACKER_FIELDS.includes(field) || !Number.isFinite(amount)) return log;

  const totals = trackerTotals(log, dateKey);
  const next = Math.min(MAX_TRACKER_AMOUNT, Math.max(0, totals[field] + amount));
  return { ...log, [dateKey]: { ...totals, [field]: next } };
}

export function clearTrackerDay(log, dateKey) {
  const { [dateKey]: removed, ...rest } = log;
  return rest;
}

export function recentTrackerDays(log, dateKey, count) {
  return Array.from({ length: count }, (_, index) => {
    const key = shiftDateKey(dateKey, index - (count - 1));
    return { dateKey: key, ...trackerTotals(log, key) };
  });
}

export function pruneTrackerLog(log, dateKey, keepDays = TRACKER_KEEP_DAYS) {
  const oldest = shiftDateKey(dateKey, -(keepDays - 1));
  return Object.fromEntries(Object.entries(log).filter(([key]) => key >= oldest && key <= dateKey));
}

export function reconcileTrackerLog(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return {};

  return Object.fromEntries(
    Object.entries(candidate).flatMap(([key, totals]) => {
      if (
        !DATE_KEY_PATTERN.test(key) ||
        totals === null ||
        typeof totals !== "object" ||
        Array.isArray(totals) ||
        !TRACKER_FIELDS.every((field) => totals[field] === undefined || isAmount(totals[field]))
      ) {
        return [];
      }

      return [
        [
          key,
          Object.fromEntries(TRACKER_FIELDS.map((field) => [field, totals[field] ?? 0])),
        ],
      ];
    }),
  );
}

export function reconcileTrackerGoals(candidate, fallback) {
  const safeFallback = fallback ?? emptyTotals();

  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ...safeFallback };
  }

  return Object.fromEntries(
    TRACKER_FIELDS.map((field) => [
      field,
      isAmount(candidate[field]) && candidate[field] > 0 ? candidate[field] : safeFallback[field],
    ]),
  );
}
