import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKOUT_STORAGE_KEY,
  advanceWorkout,
  appendHistoryRecord,
  completeSet,
  createHistoryRecord,
  createWorkout,
  endWorkout,
  loadDynamicState,
  newestHistoryFirst,
  pauseWorkout,
  reconcileWorkout,
  restRemainingMs,
  resumeWorkout,
  saveDynamicState,
  skipExercise,
  skipSet,
  workoutTimes,
} from "../src/workout.js";

const routine = {
  id: "basics",
  name: "Basics",
  exercises: [
    { exerciseId: "push-up", sets: 2, restSeconds: 10 },
    { exerciseId: "pull-up", sets: 1, restSeconds: 20 },
  ],
};

const template = {
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
};

const defaults = { storageVersion: 1, activeWorkout: template, workoutHistory: [] };
const exerciseById = new Map([
  ["push-up", { id: "push-up", name: "Push-up" }],
  ["pull-up", { id: "pull-up", name: "Pull-up" }],
]);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("completing sets starts rest, expires by timestamp, and advances exercises", () => {
  let workout = createWorkout(routine, 1_000, template);
  let result = completeSet(workout, routine, 2_000);
  workout = result.workout;

  assert.equal(workout.phase, "rest");
  assert.equal(workout.setIndex, 1);
  assert.equal(restRemainingMs(workout, 7_000), 5_000);
  assert.equal(advanceWorkout(workout, 11_999).phase, "rest");

  workout = advanceWorkout(workout, 12_000);
  assert.equal(workout.phase, "set");
  result = completeSet(workout, routine, 14_000);
  workout = result.workout;

  assert.equal(workout.exerciseIndex, 1);
  assert.equal(workout.exerciseId, "pull-up");
  assert.equal(workout.setIndex, 0);
  assert.equal(workout.exerciseStartedAt, 14_000);
  assert.deepEqual(
    workout.setResults.map(({ status }) => status),
    ["completed", "completed"],
  );
});

test("zero-rest sets activate the next set immediately", () => {
  const noRestRoutine = structuredClone(routine);
  noRestRoutine.exercises[0].restSeconds = 0;
  const result = completeSet(createWorkout(noRestRoutine, 0, template), noRestRoutine, 1_000);

  assert.equal(result.workout.phase, "set");
  assert.equal(result.workout.setIndex, 1);
  assert.equal(result.workout.rest, null);
});

test("pause and resume freeze routine, exercise, and rest clocks", () => {
  let workout = createWorkout(routine, 0, template);
  workout = completeSet(workout, routine, 1_000).workout;
  workout = pauseWorkout(workout, 3_000);

  assert.equal(restRemainingMs(workout, 30_000), 8_000);
  assert.deepEqual(workoutTimes(workout, 30_000), { routineMs: 3_000, exerciseMs: 3_000 });
  assert.equal(advanceWorkout(workout, 30_000).phase, "rest");

  workout = resumeWorkout(workout, 30_000);
  assert.equal(restRemainingMs(workout, 37_999), 1);
  assert.equal(advanceWorkout(workout, 38_000).phase, "set");
  assert.deepEqual(workoutTimes(workout, 38_000), { routineMs: 11_000, exerciseMs: 11_000 });
});

test("skipped sets and exercises remain distinct from completed sets", () => {
  let workout = createWorkout(routine, 100, template);
  workout = skipSet(workout, routine, 200).workout;
  workout = advanceWorkout(workout, 10_200);
  workout = skipExercise(workout, routine, 11_000).workout;

  assert.equal(workout.exerciseIndex, 1);
  assert.deepEqual(
    workout.setResults.map(({ setIndex, status }) => [setIndex, status]),
    [
      [0, "skipped"],
      [1, "skipped"],
    ],
  );

  const result = completeSet(workout, routine, 12_000);
  assert.equal(result.workout, null);
  assert.equal(result.completion.reason, "completed");
  assert.deepEqual(
    result.completion.setResults.map(({ status }) => status),
    ["skipped", "skipped", "completed"],
  );
});

test("active state restores exactly and advances an expired rest after suspension", () => {
  const storage = memoryStorage();
  const activeWorkout = completeSet(createWorkout(routine, 1_000, template), routine, 2_000).workout;
  const state = { storageVersion: 1, activeWorkout, workoutHistory: [] };
  saveDynamicState(state, storage);

  const serialized = storage.getItem(WORKOUT_STORAGE_KEY);
  assert.doesNotMatch(serialized, /Basics|push-up.*sets|restSeconds/);

  const restored = loadDynamicState(defaults, [routine], storage);
  assert.deepEqual(restored.activeWorkout, activeWorkout);
  assert.equal(advanceWorkout(restored.activeWorkout, 12_000).phase, "set");
});

test("restoration safely clears stale sessions and reconciles deployed set changes", () => {
  const activeWorkout = completeSet(createWorkout(routine, 1_000, template), routine, 2_000).workout;
  assert.equal(reconcileWorkout({ ...activeWorkout, exerciseId: "renamed" }, [routine]), null);
  assert.equal(reconcileWorkout(activeWorkout, []), null);

  const expandedRoutine = structuredClone(routine);
  expandedRoutine.exercises[0].sets = 3;
  const restored = reconcileWorkout(activeWorkout, [expandedRoutine]);
  assert.equal(restored.setIndex, 1);
  assert.equal(restored.setResults.length, 1);

  const changedRest = structuredClone(routine);
  changedRest.exercises[0].restSeconds = 30;
  assert.equal(reconcileWorkout(activeWorkout, [changedRest]), null);
});

test("invalid storage versions fall back to deployed dynamic defaults with no active session", () => {
  const storage = memoryStorage({
    [WORKOUT_STORAGE_KEY]: JSON.stringify({
      storageVersion: 9,
      activeWorkout: createWorkout(routine, 0, template),
      workoutHistory: ["stale"],
    }),
  });

  const fallback = {
    ...defaults,
    activeWorkout: null,
  };
  assert.deepEqual(loadDynamicState(defaults, [routine], storage), fallback);
  assert.deepEqual(JSON.parse(storage.getItem(WORKOUT_STORAGE_KEY)), fallback);
});

test("malformed serialized storage falls back safely and repairs the stored value", () => {
  const storage = memoryStorage({ [WORKOUT_STORAGE_KEY]: "{not-json" });
  const fallback = { ...defaults, activeWorkout: null };

  assert.deepEqual(loadDynamicState(defaults, [routine], storage), fallback);
  assert.deepEqual(JSON.parse(storage.getItem(WORKOUT_STORAGE_KEY)), fallback);
});

test("restoration writes a reconciled stale session back to storage", () => {
  const stale = createWorkout(routine, 0, template);
  stale.exerciseId = "removed-exercise";
  const storage = memoryStorage({
    [WORKOUT_STORAGE_KEY]: JSON.stringify({
      storageVersion: 1,
      activeWorkout: stale,
      workoutHistory: [],
    }),
  });

  const restored = loadDynamicState(defaults, [routine], storage);
  assert.equal(restored.activeWorkout, null);
  assert.equal(JSON.parse(storage.getItem(WORKOUT_STORAGE_KEY)).activeWorkout, null);
});

test("ending a paused routine returns a frozen coherent summary", () => {
  let workout = createWorkout(routine, 1_000, template, "session-paused");
  workout = pauseWorkout(workout, 5_000);
  const summary = endWorkout(workout, routine, 20_000);

  assert.equal(summary.id, "session-paused");
  assert.equal(summary.completedAt, 20_000);
  assert.equal(summary.reason, "ended");
  assert.equal(summary.routineId, routine.id);
  assert.equal(summary.durationMs, 4_000);
  assert.deepEqual(summary.exerciseDurations, [
    { exerciseId: "push-up", exerciseIndex: 0, durationMs: 4_000 },
  ]);
  assert.deepEqual(summary.setResults, []);

  const record = createHistoryRecord(summary, routine, exerciseById);
  assert.equal(appendHistoryRecord([], record)[0].reason, "ended");
  assert.deepEqual(
    record.exercises.map(({ durationMs }) => durationMs),
    [4_000, 0],
  );
});

test("skipping an exercise captures its duration before the next exercise starts", () => {
  let workout = createWorkout(routine, 1_000, template, "session-skip");
  workout = skipExercise(workout, routine, 6_000).workout;
  const summary = endWorkout(workout, routine, 9_000);
  const record = createHistoryRecord(summary, routine, exerciseById);

  assert.deepEqual(
    record.exercises.map(({ durationMs, completedSets, skippedSets }) => [
      durationMs,
      completedSets,
      skippedSets,
    ]),
    [
      [5_000, 0, 2],
      [3_000, 0, 0],
    ],
  );
});

test("finalization snapshots exercise names, timings, and counts exactly once", () => {
  let workout = createWorkout(routine, 1_000, template, "session-one");
  workout = completeSet(workout, routine, 2_000).workout;
  workout = advanceWorkout(workout, 12_000);
  workout = skipSet(workout, routine, 14_000).workout;
  workout = pauseWorkout(workout, 15_000);
  workout = resumeWorkout(workout, 20_000);

  const result = completeSet(workout, routine, 25_000);
  const record = createHistoryRecord(result.completion, routine, exerciseById);
  let history = appendHistoryRecord([], record);
  history = appendHistoryRecord(history, record);

  assert.equal(result.workout, null);
  assert.equal(history.length, 1);
  assert.deepEqual(record, {
    id: "session-one",
    completedAt: 25_000,
    reason: "completed",
    routineId: "basics",
    routineName: "Basics",
    durationMs: 19_000,
    completedSets: 2,
    skippedSets: 1,
    exercises: [
      {
        exerciseId: "push-up",
        exerciseName: "Push-up",
        durationMs: 13_000,
        completedSets: 1,
        skippedSets: 1,
      },
      {
        exerciseId: "pull-up",
        exerciseName: "Pull-up",
        durationMs: 6_000,
        completedSets: 1,
        skippedSets: 0,
      },
    ],
  });
});

test("history remains valid without its deployed routine and malformed records are removed", () => {
  const validRecord = {
    id: "session-old",
    completedAt: 10_000,
    reason: "ended",
    routineId: "removed-routine",
    routineName: "Old routine name",
    durationMs: 5_000,
    completedSets: 1,
    skippedSets: 0,
    exercises: [
      {
        exerciseId: "removed-exercise",
        exerciseName: "Old exercise name",
        durationMs: 5_000,
        completedSets: 1,
        skippedSets: 0,
      },
    ],
  };
  const storage = memoryStorage({
    [WORKOUT_STORAGE_KEY]: JSON.stringify({
      storageVersion: 1,
      activeWorkout: null,
      workoutHistory: [
        validRecord,
        { ...validRecord, id: "bad-counts", completedSets: 2 },
        { ...validRecord, id: "bad-date", completedAt: Number.MAX_VALUE },
        { ...validRecord, id: "no-exercises", exercises: [], completedSets: 0 },
        validRecord,
        "malformed",
      ],
    }),
  });

  const restored = loadDynamicState(defaults, [], storage);

  assert.deepEqual(restored.workoutHistory, [validRecord]);
  assert.deepEqual(JSON.parse(storage.getItem(WORKOUT_STORAGE_KEY)).workoutHistory, [validRecord]);
});

test("history ordering is newest first without mutating stored order", () => {
  const history = [
    { id: "older", completedAt: 1_000 },
    { id: "newest", completedAt: 3_000 },
    { id: "middle", completedAt: 2_000 },
  ];

  assert.deepEqual(
    newestHistoryFirst(history).map((record) => record.id),
    ["newest", "middle", "older"],
  );
  assert.deepEqual(
    history.map((record) => record.id),
    ["older", "newest", "middle"],
  );
});
