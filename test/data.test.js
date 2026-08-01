import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAYS, parseExerciseMedia, validateData } from "../src/data.js";

const seed = {
  exercises: [
    { id: "push-up", name: "Push-up", bodyParts: ["chest", "shoulders", "triceps"] },
    { id: "pull-up", name: "Pull-up", bodyParts: ["back", "biceps"] },
  ],
  routines: [
    {
      id: "basics",
      name: "Basics",
      exercises: [
        { exerciseId: "push-up", sets: 3, restSeconds: 60 },
        { exerciseId: "pull-up", sets: 3, restSeconds: 60 },
      ],
    },
  ],
  schedule: { days: Object.fromEntries(DAYS.map((day) => [day, day === "sunday" ? "basics" : null])) },
  defaults: {
    storageVersion: 1,
    activeWorkout: {
      sessionId: null,
      routineId: null,
      exerciseId: null,
      exerciseIndex: 0,
      setIndex: 0,
      phase: "set",
      setResults: [],
      exerciseDurations: [],
      startedAt: null,
      exerciseStartedAt: null,
      routinePausedMs: 0,
      exercisePausedMs: 0,
      pausedAt: null,
      rest: null,
    },
    workoutHistory: [],
    freeTimer: null,
    dailyTotals: {},
    trackerGoals: { calories: 2200, protein: 150, waterMl: 3000 },
  },
};

function clone(value) {
  return structuredClone(value);
}

test("accepts a complete workout data set", () => {
  assert.equal(validateData(clone(seed)).routines[0].name, "Basics");
});

test("requires every exercise to declare the body parts it works", () => {
  const missing = clone(seed);
  delete missing.exercises[0].bodyParts;
  assert.throws(() => validateData(missing), /bodyParts must be a non-empty array/);

  const empty = clone(seed);
  empty.exercises[0].bodyParts = [];
  assert.throws(() => validateData(empty), /bodyParts must be a non-empty array/);

  const blank = clone(seed);
  blank.exercises[0].bodyParts = ["chest", " "];
  assert.throws(() => validateData(blank), /bodyParts must contain only non-empty strings/);

  const duplicated = clone(seed);
  duplicated.exercises[0].bodyParts = ["chest", "chest"];
  assert.throws(() => validateData(duplicated), /bodyParts must not repeat a body part/);
});

test("rejects routine exercise references that do not exist", () => {
  const data = clone(seed);
  data.routines[0].exercises[0].exerciseId = "missing";
  assert.throws(() => validateData(data), /reference an existing exercise/);
});

test("target weight is optional but must be a sane number when present", () => {
  const withWeight = clone(seed);
  withWeight.routines[0].exercises[0].weightKg = 42.5;
  assert.equal(validateData(withWeight).routines[0].exercises[0].weightKg, 42.5);

  const negative = clone(seed);
  negative.routines[0].exercises[0].weightKg = -1;
  assert.throws(() => validateData(negative), /weightKg must be a number between 0 and 1000/);

  const absurd = clone(seed);
  absurd.routines[0].exercises[0].weightKg = 5000;
  assert.throws(() => validateData(absurd), /weightKg must be a number between 0 and 1000/);

  const notANumber = clone(seed);
  notANumber.routines[0].exercises[0].weightKg = "heavy";
  assert.throws(() => validateData(notANumber), /weightKg must be a number between 0 and 1000/);
});

test("rejects invalid set and rest values", () => {
  const invalidSets = clone(seed);
  invalidSets.routines[0].exercises[0].sets = 0;
  assert.throws(() => validateData(invalidSets), /sets must be a positive integer/);

  const invalidRest = clone(seed);
  invalidRest.routines[0].exercises[0].restSeconds = -1;
  assert.throws(() => validateData(invalidRest), /restSeconds must be a non-negative integer/);
});

test("superset groups must be consecutive, plural, and share a set count", () => {
  const valid = clone(seed);
  valid.routines[0].exercises[0].supersetGroup = "a";
  valid.routines[0].exercises[1].supersetGroup = "a";
  assert.equal(validateData(valid).routines[0].exercises[0].supersetGroup, "a");

  const lonely = clone(seed);
  lonely.routines[0].exercises[0].supersetGroup = "a";
  assert.throws(() => validateData(lonely), /must contain at least two exercises/);

  const mismatched = clone(valid);
  mismatched.routines[0].exercises[1].sets = 5;
  assert.throws(() => validateData(mismatched), /same number of sets/);

  const split = clone(seed);
  split.exercises.push({ id: "dips", name: "Dips", bodyParts: ["triceps"] });
  split.routines[0].exercises = [
    { exerciseId: "push-up", sets: 3, restSeconds: 60, supersetGroup: "a" },
    { exerciseId: "dips", sets: 3, restSeconds: 60 },
    { exerciseId: "pull-up", sets: 3, restSeconds: 60, supersetGroup: "a" },
  ];
  assert.throws(() => validateData(split), /must group consecutive exercises/);

  const blank = clone(seed);
  blank.routines[0].exercises[0].supersetGroup = "";
  assert.throws(() => validateData(blank), /supersetGroup must be a non-empty string/);
});

test("requires exactly Sunday through Saturday in the schedule", () => {
  const data = clone(seed);
  delete data.schedule.days.wednesday;
  assert.throws(() => validateData(data), /Sunday through Saturday/);
});

test("rejects schedule references that do not exist", () => {
  const data = clone(seed);
  data.schedule.days.sunday = "missing";
  assert.throws(() => validateData(data), /reference an existing routine/);
});

test("declares valid dynamic-state defaults", () => {
  const data = clone(seed);
  data.defaults.workoutHistory = {};
  assert.throws(() => validateData(data), /workoutHistory must be an array/);
});

test("normalizes supported YouTube media to a privacy-enhanced embed", () => {
  assert.deepEqual(parseExerciseMedia("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    type: "youtube",
    src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  });
  assert.deepEqual(parseExerciseMedia("https://youtu.be/dQw4w9WgXcQ"), {
    type: "youtube",
    src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
  });
});

test("accepts inline image media URLs", () => {
  assert.deepEqual(parseExerciseMedia("https://example.com/push-up.webp?size=large"), {
    type: "image",
    src: "https://example.com/push-up.webp?size=large",
  });
});

test("optional malformed and unsupported media fails safely", () => {
  assert.equal(parseExerciseMedia(undefined), null);
  assert.equal(parseExerciseMedia({ url: "https://example.com/demo.jpg" }), null);
  assert.equal(parseExerciseMedia("not a URL"), null);
  assert.equal(parseExerciseMedia("javascript:alert(1)"), null);
  assert.equal(parseExerciseMedia("https://example.com/instructions"), null);

  const data = clone(seed);
  data.exercises[0].media = "not a URL";
  assert.equal(validateData(data).exercises.length, 2);
});

test("visible shell does not render the app name", async () => {
  const [markup, source] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
  ]);

  assert.match(markup, /<title>Gym Bro<\/title>/);
  assert.doesNotMatch(source, />\s*Gym Bro\s*</);
});

test("history is reachable and renders snapshots without tracking disallowed details", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

  assert.match(source, /href="#history"[^>]*>History<\/a>/);
  assert.match(source, /No workout history yet/);
  assert.match(source, /newestHistoryFirst\(history\)/);
  assert.match(source, /exercise\.exerciseName/);
  assert.doesNotMatch(source, /data-(?:reps|notes|export)/i);
});

test("weight is logged per set and surfaced in history", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

  assert.match(source, /data-workout-input="weight"/);
  assert.match(source, /completeSet\(workout, routine, now, weight\)/);
  assert.match(source, /exercise\.topWeightKg/);
});

test("the exercise library can be filtered by body part", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

  assert.match(source, /data-filter-body-part=/);
  assert.match(source, /bodyParts\.some\(\(part\) => selected\.has\(part\)\)/);
  assert.match(source, /No exercises match/);
});

test("history sessions can be removed individually", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

  assert.match(source, /data-delete-history=/);
  assert.match(source, /removeHistoryRecord\(dynamicState\.workoutHistory, id\)/);
  assert.match(source, /window\.confirm\(/);
});
