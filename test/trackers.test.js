import assert from "node:assert/strict";
import test from "node:test";
import {
  addTrackerAmount,
  clearTrackerDay,
  emptyTotals,
  pruneTrackerLog,
  recentTrackerDays,
  reconcileTrackerGoals,
  reconcileTrackerLog,
  shiftDateKey,
  todayKey,
  trackerTotals,
} from "../src/trackers.js";

const goals = { calories: 2200, protein: 150, waterMl: 3000 };

test("day keys follow the local calendar and shift by whole days", () => {
  const noon = new Date(2026, 7, 1, 12, 0, 0).getTime();
  const lateEvening = new Date(2026, 7, 1, 23, 59, 59).getTime();

  assert.equal(todayKey(noon), "2026-08-01");
  assert.equal(todayKey(lateEvening), "2026-08-01");
  assert.equal(shiftDateKey("2026-08-01", -1), "2026-07-31");
  assert.equal(shiftDateKey("2026-12-31", 1), "2027-01-01");
});

test("amounts accumulate per day and per field without touching other days", () => {
  let log = {};
  log = addTrackerAmount(log, "2026-08-01", "waterMl", 250);
  log = addTrackerAmount(log, "2026-08-01", "waterMl", 500);
  log = addTrackerAmount(log, "2026-08-01", "calories", 320);
  log = addTrackerAmount(log, "2026-08-01", "protein", 45);
  log = addTrackerAmount(log, "2026-08-02", "waterMl", 100);

  assert.deepEqual(trackerTotals(log, "2026-08-01"), { calories: 320, protein: 45, waterMl: 750 });
  assert.deepEqual(trackerTotals(log, "2026-08-02"), { calories: 0, protein: 0, waterMl: 100 });
  assert.deepEqual(trackerTotals(log, "2026-08-03"), emptyTotals());
});

test("amounts never fall below zero, exceed the cap, or accept unknown fields", () => {
  const log = addTrackerAmount({}, "2026-08-01", "calories", 200);

  assert.equal(addTrackerAmount(log, "2026-08-01", "calories", -500).calories, undefined);
  assert.equal(trackerTotals(addTrackerAmount(log, "2026-08-01", "calories", -500), "2026-08-01").calories, 0);
  assert.equal(
    trackerTotals(addTrackerAmount(log, "2026-08-01", "calories", 1_000_000), "2026-08-01").calories,
    100_000,
  );
  assert.equal(addTrackerAmount(log, "2026-08-01", "carbs", 10), log);
  assert.equal(addTrackerAmount(log, "2026-08-01", "calories", Number.NaN), log);
});

test("clearing a day leaves the rest of the log intact", () => {
  const kept = { calories: 0, protein: 0, waterMl: 250 };
  const log = { "2026-08-01": { calories: 100, protein: 0, waterMl: 0 }, "2026-08-02": kept };

  assert.deepEqual(clearTrackerDay(log, "2026-08-01"), { "2026-08-02": kept });
  assert.deepEqual(clearTrackerDay(log, "2026-08-09"), log);
});

test("the recent trend ends on today and fills missing days with zeroes", () => {
  const log = { "2026-08-01": { calories: 500, protein: 40, waterMl: 250 } };
  const days = recentTrackerDays(log, "2026-08-03", 7);

  assert.equal(days.length, 7);
  assert.equal(days.at(-1).dateKey, "2026-08-03");
  assert.equal(days.at(0).dateKey, "2026-07-28");
  assert.deepEqual(days.find((day) => day.dateKey === "2026-08-01"), {
    dateKey: "2026-08-01",
    calories: 500,
    protein: 40,
    waterMl: 250,
  });
  assert.deepEqual(days.at(-1), { dateKey: "2026-08-03", calories: 0, protein: 0, waterMl: 0 });
});

test("pruning keeps the retention window and drops future or expired days", () => {
  const totals = { calories: 1, protein: 1, waterMl: 1 };
  const log = {
    "2026-07-01": totals,
    "2026-08-01": totals,
    "2026-08-10": totals,
    "2026-09-01": totals,
  };

  assert.deepEqual(Object.keys(pruneTrackerLog(log, "2026-08-10", 14)), ["2026-08-01", "2026-08-10"]);
});

test("malformed persisted tracker data is discarded rather than trusted", () => {
  assert.deepEqual(reconcileTrackerLog(null), {});
  assert.deepEqual(reconcileTrackerLog([1, 2]), {});
  assert.deepEqual(
    reconcileTrackerLog({
      "2026-08-01": { calories: 100, protein: 30, waterMl: 250 },
      "not-a-date": { calories: 1, protein: 1, waterMl: 1 },
      "2026-08-02": { calories: -5, protein: 1, waterMl: 1 },
      "2026-08-04": null,
      "2026-08-05": { calories: Number.POSITIVE_INFINITY, protein: 1, waterMl: 1 },
      "2026-08-06": { calories: 10, protein: "lots", waterMl: 1 },
    }),
    { "2026-08-01": { calories: 100, protein: 30, waterMl: 250 } },
  );
});

test("days logged before a tracker field existed survive with a zero total", () => {
  assert.deepEqual(reconcileTrackerLog({ "2026-08-01": { calories: 640, waterMl: 750 } }), {
    "2026-08-01": { calories: 640, protein: 0, waterMl: 750 },
  });
  assert.deepEqual(reconcileTrackerLog({ "2026-08-01": {} }), {
    "2026-08-01": { calories: 0, protein: 0, waterMl: 0 },
  });
});

test("tracker goals fall back to deployed values when stored goals are unusable", () => {
  assert.deepEqual(reconcileTrackerGoals(null, goals), goals);
  assert.deepEqual(reconcileTrackerGoals({ calories: 0, protein: 180, waterMl: 2000 }, goals), {
    calories: 2200,
    protein: 180,
    waterMl: 2000,
  });
  assert.deepEqual(reconcileTrackerGoals({ calories: 1800, waterMl: "lots" }, goals), {
    calories: 1800,
    protein: 150,
    waterMl: 3000,
  });
});
