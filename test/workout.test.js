import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FREE_TIMER_MS,
  MAX_REST_MS,
  WORKOUT_STORAGE_KEY,
  adjustRest,
  advanceWorkout,
  appendHistoryRecord,
  completeSet,
  createFreeTimer,
  createHistoryRecord,
  createWorkout,
  endWorkout,
  freeTimerFinished,
  freeTimerRunning,
  freeTimerValueMs,
  lastLoggedWeight,
  loadDynamicState,
  newestHistoryFirst,
  pauseFreeTimer,
  pauseWorkout,
  reconcileFreeTimer,
  reconcileWorkout,
  reconcileWorkoutHistory,
  removeHistoryRecord,
  resetFreeTimer,
  restRemainingMs,
  resumeWorkout,
  saveDynamicState,
  skipExercise,
  skipRest,
  skipSet,
  startFreeTimer,
  supersetGroup,
  visitSequence,
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

const defaults = {
  storageVersion: 1,
  activeWorkout: template,
  workoutHistory: [],
  freeTimer: null,
  dailyTotals: {},
  trackerGoals: { calories: 2200, protein: 150, waterMl: 3000 },
};
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

test("rest can be skipped outright, but not from a set phase or while paused", () => {
  let workout = createWorkout(routine, 0, template);
  assert.equal(skipRest(workout).workout, workout);

  workout = completeSet(workout, routine, 1_000).workout;
  assert.equal(workout.phase, "rest");
  assert.equal(skipRest(pauseWorkout(workout, 2_000)).workout.phase, "rest");

  const skipped = skipRest(workout);
  assert.equal(skipped.workout.phase, "set");
  assert.equal(skipped.workout.rest, null);
  assert.equal(skipped.workout.setIndex, 1);
  assert.equal(skipped.completion, null);
});

test("rest length adjusts within bounds and ends once it is used up", () => {
  const resting = completeSet(createWorkout(routine, 0, template), routine, 1_000).workout;

  const extended = adjustRest(resting, 1_000, 15_000).workout;
  assert.equal(extended.rest.durationMs, 25_000);
  assert.equal(extended.rest.adjusted, true);
  assert.equal(restRemainingMs(extended, 1_000), 25_000);

  const shortened = adjustRest(extended, 1_000, -15_000).workout;
  assert.equal(shortened.rest.durationMs, 10_000);

  assert.equal(adjustRest(resting, 1_000, -MAX_REST_MS).workout.phase, "set");
  assert.equal(adjustRest(resting, 5_000, -6_000).workout.phase, "set");
  assert.equal(adjustRest(resting, 1_000, MAX_REST_MS * 2).workout.rest.durationMs, MAX_REST_MS);

  assert.equal(adjustRest(pauseWorkout(resting, 2_000), 2_000, 15_000).workout.rest.durationMs, 10_000);
  const setPhase = createWorkout(routine, 0, template);
  assert.equal(adjustRest(setPhase, 1_000, 15_000).workout, setPhase);
});

test("an adjusted rest survives restoration while deployed rest changes still invalidate it", () => {
  const resting = completeSet(createWorkout(routine, 1_000, template), routine, 2_000).workout;
  const adjusted = adjustRest(resting, 2_000, 15_000).workout;

  assert.deepEqual(reconcileWorkout(adjusted, [routine]), adjusted);

  const changedRest = structuredClone(routine);
  changedRest.exercises[0].restSeconds = 30;
  assert.deepEqual(reconcileWorkout(adjusted, [changedRest]), adjusted);

  const overlong = structuredClone(adjusted);
  overlong.rest.durationMs = MAX_REST_MS + 1;
  assert.equal(reconcileWorkout(overlong, [routine]), null);
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
        topWeightKg: null,
      },
      {
        exerciseId: "pull-up",
        exerciseName: "Pull-up",
        durationMs: 6_000,
        completedSets: 1,
        skippedSets: 0,
        topWeightKg: null,
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
        topWeightKg: null,
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

test("the free stopwatch counts up and freezes while paused", () => {
  let timer = createFreeTimer("stopwatch");
  assert.equal(freeTimerValueMs(timer, 5_000), 0);
  assert.equal(freeTimerRunning(timer), false);

  timer = startFreeTimer(timer, 1_000);
  assert.equal(freeTimerRunning(timer), true);
  assert.equal(freeTimerValueMs(timer, 4_000), 3_000);

  timer = pauseFreeTimer(timer, 4_000);
  assert.equal(freeTimerRunning(timer), false);
  assert.equal(freeTimerValueMs(timer, 60_000), 3_000);
  assert.equal(pauseFreeTimer(timer, 70_000), timer);

  timer = startFreeTimer(timer, 60_000);
  assert.equal(freeTimerValueMs(timer, 61_000), 4_000);
  assert.equal(startFreeTimer(timer, 62_000), timer);

  assert.deepEqual(resetFreeTimer(timer), createFreeTimer("stopwatch"));
});

test("the free countdown clamps at zero and reports finishing", () => {
  let timer = createFreeTimer("countdown", 30_000);
  assert.equal(freeTimerValueMs(timer, 99_000), 30_000);
  assert.equal(freeTimerFinished(timer, 99_000), false);

  timer = startFreeTimer(timer, 1_000);
  assert.equal(freeTimerValueMs(timer, 11_000), 20_000);
  assert.equal(freeTimerFinished(timer, 11_000), false);
  assert.equal(freeTimerValueMs(timer, 31_000), 0);
  assert.equal(freeTimerFinished(timer, 31_000), true);
  assert.equal(freeTimerValueMs(timer, 900_000), 0);

  assert.equal(createFreeTimer("countdown", -5).durationMs, 0);
  assert.equal(createFreeTimer("countdown", MAX_FREE_TIMER_MS * 3).durationMs, MAX_FREE_TIMER_MS);
  assert.deepEqual(resetFreeTimer(timer), createFreeTimer("countdown", 30_000));
});

test("a running free timer survives restoration and malformed timers are dropped", () => {
  const storage = memoryStorage();
  const freeTimer = startFreeTimer(createFreeTimer("countdown", 60_000), 1_000);
  saveDynamicState({ ...defaults, activeWorkout: null, freeTimer }, storage);

  const restored = loadDynamicState(defaults, [routine], storage);
  assert.deepEqual(restored.freeTimer, freeTimer);
  assert.equal(freeTimerValueMs(restored.freeTimer, 21_000), 40_000);

  assert.equal(reconcileFreeTimer(null), null);
  assert.equal(reconcileFreeTimer({ ...freeTimer, mode: "hourglass" }), null);
  assert.equal(reconcileFreeTimer({ ...freeTimer, durationMs: MAX_FREE_TIMER_MS + 1 }), null);
  assert.equal(reconcileFreeTimer({ ...freeTimer, startedAt: null, pausedAt: 5 }), null);
});

const supersetRoutine = {
  id: "circuit",
  name: "Circuit",
  exercises: [
    { exerciseId: "push-up", sets: 1, restSeconds: 10 },
    { exerciseId: "dips", sets: 2, restSeconds: 30, supersetGroup: "finisher" },
    { exerciseId: "squats", sets: 2, restSeconds: 40, supersetGroup: "finisher" },
  ],
};

const supersetExercises = new Map([
  ["push-up", { id: "push-up", name: "Push-up" }],
  ["dips", { id: "dips", name: "Dips" }],
  ["squats", { id: "squats", name: "Squats" }],
]);

function position(workout) {
  return [workout.exerciseIndex, workout.setIndex, workout.phase];
}

test("a superset alternates its members each round and rests only between rounds", () => {
  let workout = createWorkout(supersetRoutine, 0, template);
  workout = completeSet(workout, supersetRoutine, 1_000).workout;
  assert.deepEqual(position(workout), [1, 0, "set"]);

  workout = completeSet(workout, supersetRoutine, 2_000).workout;
  assert.deepEqual(position(workout), [2, 0, "set"]);
  assert.equal(workout.rest, null);

  workout = completeSet(workout, supersetRoutine, 3_000).workout;
  assert.deepEqual(position(workout), [1, 1, "rest"]);
  assert.equal(workout.rest.durationMs, 40_000);

  workout = advanceWorkout(workout, 43_000);
  workout = completeSet(workout, supersetRoutine, 44_000).workout;
  assert.deepEqual(position(workout), [2, 1, "set"]);

  const finished = completeSet(workout, supersetRoutine, 45_000);
  assert.equal(finished.workout, null);
  assert.equal(finished.completion.reason, "completed");

  const record = createHistoryRecord(finished.completion, supersetRoutine, supersetExercises);
  assert.deepEqual(
    record.exercises.map((exercise) => [exercise.exerciseName, exercise.completedSets]),
    [
      ["Push-up", 1],
      ["Dips", 2],
      ["Squats", 2],
    ],
  );
});

test("a session mid-superset restores at the same member and round", () => {
  let workout = createWorkout(supersetRoutine, 0, template);
  workout = completeSet(workout, supersetRoutine, 1_000).workout;
  workout = completeSet(workout, supersetRoutine, 2_000).workout;
  workout = completeSet(workout, supersetRoutine, 3_000).workout;

  assert.deepEqual(visitSequence(supersetRoutine, 1, 1), [0, 1, 2]);
  assert.deepEqual(
    workout.exerciseDurations.map((duration) => duration.exerciseIndex),
    [0, 1, 2],
  );
  assert.deepEqual(reconcileWorkout(workout, [supersetRoutine]), workout);

  const storage = memoryStorage();
  saveDynamicState({ ...defaults, activeWorkout: workout }, storage);
  const restored = loadDynamicState(defaults, [supersetRoutine], storage);
  assert.deepEqual(position(restored.activeWorkout), [1, 1, "rest"]);
  assert.deepEqual(restored.activeWorkout.setResults.map((r) => r.exerciseIndex), [0, 1, 2]);
});

test("skipping a superset drops the whole group and keeps the visit sequence intact", () => {
  let workout = createWorkout(supersetRoutine, 0, template);
  workout = completeSet(workout, supersetRoutine, 1_000).workout;
  const skipped = skipExercise(workout, supersetRoutine, 2_000);

  assert.equal(skipped.workout, null);
  assert.equal(skipped.completion.reason, "completed");
  assert.equal(
    skipped.completion.setResults.filter((result) => result.status === "skipped").length,
    4,
  );
});

test("a routine without supersets keeps its original one-visit-per-exercise sequence", () => {
  assert.deepEqual(visitSequence(routine, 0, 0), []);
  assert.deepEqual(visitSequence(routine, 1, 0), [0]);
  assert.deepEqual(supersetGroup(routine, 1), [1]);
  assert.deepEqual(supersetGroup(supersetRoutine, 2), [1, 2]);
});

test("weight logged on a set is kept, prefilled forward, and survives restoration", () => {
  let workout = createWorkout(routine, 0, template);
  workout = completeSet(workout, routine, 1_000, 40).workout;

  assert.equal(workout.setResults[0].weightKg, 40);
  assert.equal(lastLoggedWeight(workout, 0), 40);
  assert.equal(lastLoggedWeight(workout, 1), null);

  assert.deepEqual(reconcileWorkout(workout, [routine]), workout);

  const nonsense = structuredClone(workout);
  nonsense.setResults[0].weightKg = "heavy";
  assert.equal(reconcileWorkout(nonsense, [routine]).setResults[0].weightKg, null);

  const absurd = structuredClone(workout);
  absurd.setResults[0].weightKg = 5_000;
  assert.equal(reconcileWorkout(absurd, [routine]).setResults[0].weightKg, null);

  assert.equal(completeSet(createWorkout(routine, 0, template), routine, 1, -5).workout.setResults[0].weightKg, null);
  assert.equal(skipSet(createWorkout(routine, 0, template), routine, 1).workout.setResults[0].weightKg, null);
});

test("history records the top weight lifted per exercise", () => {
  let workout = createWorkout(routine, 0, template);
  workout = completeSet(workout, routine, 1_000, 40).workout;
  workout = advanceWorkout(workout, 11_000);
  workout = completeSet(workout, routine, 12_000, 55).workout;
  const completion = completeSet(workout, routine, 13_000).completion;
  const record = createHistoryRecord(completion, routine, exerciseById);

  assert.equal(record.exercises[0].topWeightKg, 55);
  assert.equal(record.exercises[1].topWeightKg, null);
  assert.deepEqual(reconcileWorkoutHistory([record]), [record]);

  const malformed = structuredClone(record);
  malformed.exercises[0].topWeightKg = "heavy";
  assert.equal(reconcileWorkoutHistory([malformed])[0].exercises[0].topWeightKg, null);
});

test("an unwanted history session is removed without disturbing the rest", () => {
  const history = [
    { id: "older", completedAt: 1_000 },
    { id: "newest", completedAt: 3_000 },
    { id: "middle", completedAt: 2_000 },
  ];

  assert.deepEqual(
    removeHistoryRecord(history, "newest").map((record) => record.id),
    ["older", "middle"],
  );
  assert.deepEqual(removeHistoryRecord(history, "absent"), history);
  assert.deepEqual(
    history.map((record) => record.id),
    ["older", "newest", "middle"],
  );
  assert.deepEqual(removeHistoryRecord([], "older"), []);
});
