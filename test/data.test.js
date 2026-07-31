import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAYS, parseExerciseMedia, validateData } from "../src/data.js";

const seed = {
  exercises: [
    { id: "push-up", name: "Push-up" },
    { id: "pull-up", name: "Pull-up" },
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
  },
};

function clone(value) {
  return structuredClone(value);
}

test("accepts a complete workout data set", () => {
  assert.equal(validateData(clone(seed)).routines[0].name, "Basics");
});

test("rejects routine exercise references that do not exist", () => {
  const data = clone(seed);
  data.routines[0].exercises[0].exerciseId = "missing";
  assert.throws(() => validateData(data), /reference an existing exercise/);
});

test("rejects invalid set and rest values", () => {
  const invalidSets = clone(seed);
  invalidSets.routines[0].exercises[0].sets = 0;
  assert.throws(() => validateData(invalidSets), /sets must be a positive integer/);

  const invalidRest = clone(seed);
  invalidRest.routines[0].exercises[0].restSeconds = -1;
  assert.throws(() => validateData(invalidRest), /restSeconds must be a non-negative integer/);
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
  assert.doesNotMatch(source, /data-(?:weight|reps|notes|delete|export)/i);
});
