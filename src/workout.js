export const WORKOUT_STORAGE_KEY = "gym-bro:dynamic-state";

const SET_STATUSES = new Set(["completed", "skipped"]);
const COMPLETION_REASONS = new Set(["completed", "ended"]);

function clone(value) {
  return structuredClone(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function activeTime(now, startedAt, pausedMs, pausedAt) {
  const end = pausedAt ?? now;
  return Math.max(0, end - startedAt - pausedMs);
}

function resultKey(result) {
  return `${result.exerciseIndex}:${result.setIndex}`;
}

function createSessionId(now) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createWorkout(routine, now, template = {}, sessionId = createSessionId(now)) {
  return {
    ...clone(template),
    sessionId,
    routineId: routine.id,
    exerciseId: routine.exercises[0].exerciseId,
    exerciseIndex: 0,
    setIndex: 0,
    phase: "set",
    setResults: [],
    exerciseDurations: [],
    startedAt: now,
    exerciseStartedAt: now,
    routinePausedMs: 0,
    exercisePausedMs: 0,
    pausedAt: null,
    rest: null,
  };
}

export function workoutTimes(workout, now) {
  return {
    routineMs: activeTime(now, workout.startedAt, workout.routinePausedMs, workout.pausedAt),
    exerciseMs: activeTime(
      now,
      workout.exerciseStartedAt,
      workout.exercisePausedMs,
      workout.pausedAt,
    ),
  };
}

export function restRemainingMs(workout, now) {
  if (workout.phase !== "rest" || !workout.rest) return 0;
  const elapsed = activeTime(now, workout.rest.startedAt, workout.rest.pausedMs, workout.pausedAt);
  return Math.max(0, workout.rest.durationMs - elapsed);
}

function completion(workout, routine, now, reason) {
  const currentDuration = {
    exerciseId: workout.exerciseId,
    exerciseIndex: workout.exerciseIndex,
    durationMs: workoutTimes(workout, now).exerciseMs,
  };

  return {
    id: workout.sessionId,
    completedAt: now,
    reason,
    routineId: routine.id,
    routineName: routine.name,
    durationMs: workoutTimes(workout, now).routineMs,
    exerciseDurations: [...clone(workout.exerciseDurations), currentDuration],
    setResults: clone(workout.setResults),
  };
}

function advanceExercise(workout, routine, now) {
  if (workout.exerciseIndex === routine.exercises.length - 1) {
    return { workout: null, completion: completion(workout, routine, now, "completed") };
  }

  const exerciseIndex = workout.exerciseIndex + 1;
  const exerciseDurations = [
    ...workout.exerciseDurations,
    {
      exerciseId: workout.exerciseId,
      exerciseIndex: workout.exerciseIndex,
      durationMs: workoutTimes(workout, now).exerciseMs,
    },
  ];
  return {
    workout: {
      ...workout,
      exerciseId: routine.exercises[exerciseIndex].exerciseId,
      exerciseIndex,
      setIndex: 0,
      phase: "set",
      exerciseDurations,
      exerciseStartedAt: now,
      exercisePausedMs: 0,
      rest: null,
    },
    completion: null,
  };
}

function finishSet(workout, routine, now, status) {
  if (workout.pausedAt !== null || workout.phase !== "set") {
    return { workout, completion: null };
  }

  const exercise = routine.exercises[workout.exerciseIndex];
  const setResults = [
    ...workout.setResults,
    {
      exerciseId: exercise.exerciseId,
      exerciseIndex: workout.exerciseIndex,
      setIndex: workout.setIndex,
      status,
    },
  ];
  const updated = { ...workout, setResults };

  if (workout.setIndex === exercise.sets - 1) {
    return advanceExercise(updated, routine, now);
  }

  const nextSet = workout.setIndex + 1;
  if (exercise.restSeconds === 0) {
    return {
      workout: { ...updated, setIndex: nextSet },
      completion: null,
    };
  }

  return {
    workout: {
      ...updated,
      setIndex: nextSet,
      phase: "rest",
      rest: {
        startedAt: now,
        durationMs: exercise.restSeconds * 1000,
        pausedMs: 0,
      },
    },
    completion: null,
  };
}

export function completeSet(workout, routine, now) {
  return finishSet(workout, routine, now, "completed");
}

export function skipSet(workout, routine, now) {
  return finishSet(workout, routine, now, "skipped");
}

export function skipExercise(workout, routine, now) {
  if (workout.pausedAt !== null) return { workout, completion: null };

  const exercise = routine.exercises[workout.exerciseIndex];
  const completedKeys = new Set(workout.setResults.map(resultKey));
  const skipped = [];

  for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
    const candidate = {
      exerciseId: exercise.exerciseId,
      exerciseIndex: workout.exerciseIndex,
      setIndex,
      status: "skipped",
    };
    if (!completedKeys.has(resultKey(candidate))) skipped.push(candidate);
  }

  return advanceExercise(
    { ...workout, setResults: [...workout.setResults, ...skipped], phase: "set", rest: null },
    routine,
    now,
  );
}

export function pauseWorkout(workout, now) {
  if (workout.pausedAt !== null) return workout;
  return { ...workout, pausedAt: now };
}

export function resumeWorkout(workout, now) {
  if (workout.pausedAt === null) return workout;
  const pauseDuration = Math.max(0, now - workout.pausedAt);

  return {
    ...workout,
    routinePausedMs: workout.routinePausedMs + pauseDuration,
    exercisePausedMs: workout.exercisePausedMs + pauseDuration,
    pausedAt: null,
    rest: workout.rest
      ? { ...workout.rest, pausedMs: workout.rest.pausedMs + pauseDuration }
      : null,
  };
}

export function advanceWorkout(workout, now) {
  if (
    workout.pausedAt === null &&
    workout.phase === "rest" &&
    restRemainingMs(workout, now) === 0
  ) {
    return { ...workout, phase: "set", rest: null };
  }
  return workout;
}

export function endWorkout(workout, routine, now) {
  return completion(workout, routine, now, "ended");
}

export function createHistoryRecord(summary, routine, exerciseById) {
  const durations = new Map(
    summary.exerciseDurations.map((entry) => [entry.exerciseIndex, entry.durationMs]),
  );
  const exercises = routine.exercises.map((entry, exerciseIndex) => {
    const exercise = exerciseById.get(entry.exerciseId);
    const results = summary.setResults.filter((result) => result.exerciseIndex === exerciseIndex);

    return {
      exerciseId: entry.exerciseId,
      exerciseName: exercise?.name ?? entry.exerciseId,
      durationMs: durations.get(exerciseIndex) ?? 0,
      completedSets: results.filter((result) => result.status === "completed").length,
      skippedSets: results.filter((result) => result.status === "skipped").length,
    };
  });

  return {
    id: summary.id,
    completedAt: summary.completedAt,
    reason: summary.reason,
    routineId: summary.routineId,
    routineName: summary.routineName,
    durationMs: summary.durationMs,
    completedSets: exercises.reduce((total, exercise) => total + exercise.completedSets, 0),
    skippedSets: exercises.reduce((total, exercise) => total + exercise.skippedSets, 0),
    exercises,
  };
}

export function appendHistoryRecord(history, record) {
  return history.some((item) => item.id === record.id) ? history : [...history, record];
}

export function newestHistoryFirst(history) {
  return [...history].sort((left, right) => right.completedAt - left.completedAt);
}

function reconcileHistoryRecord(candidate) {
  if (
    !isObject(candidate) ||
    !isNonEmptyString(candidate.id) ||
    !isTimestamp(candidate.completedAt) ||
    !COMPLETION_REASONS.has(candidate.reason) ||
    !isNonEmptyString(candidate.routineId) ||
    !isNonEmptyString(candidate.routineName) ||
    !isTimestamp(candidate.durationMs) ||
    !isCount(candidate.completedSets) ||
    !isCount(candidate.skippedSets) ||
    (!Array.isArray(candidate.exercises) || candidate.exercises.length === 0)
  ) {
    return null;
  }

  const exercises = candidate.exercises.map((exercise) => {
    if (
      !isObject(exercise) ||
      !isNonEmptyString(exercise.exerciseId) ||
      !isNonEmptyString(exercise.exerciseName) ||
      !isTimestamp(exercise.durationMs) ||
      !isCount(exercise.completedSets) ||
      !isCount(exercise.skippedSets)
    ) {
      return null;
    }

    return {
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      durationMs: exercise.durationMs,
      completedSets: exercise.completedSets,
      skippedSets: exercise.skippedSets,
    };
  });

  if (
    exercises.some((exercise) => exercise === null) ||
    exercises.reduce((total, exercise) => total + exercise.completedSets, 0) !==
      candidate.completedSets ||
    exercises.reduce((total, exercise) => total + exercise.skippedSets, 0) !== candidate.skippedSets
  ) {
    return null;
  }

  return {
    id: candidate.id,
    completedAt: candidate.completedAt,
    reason: candidate.reason,
    routineId: candidate.routineId,
    routineName: candidate.routineName,
    durationMs: candidate.durationMs,
    completedSets: candidate.completedSets,
    skippedSets: candidate.skippedSets,
    exercises,
  };
}

export function reconcileWorkoutHistory(candidate) {
  if (!Array.isArray(candidate)) return [];

  const seen = new Set();
  return candidate.flatMap((entry) => {
    const record = reconcileHistoryRecord(entry);
    if (!record || seen.has(record.id)) return [];
    seen.add(record.id);
    return [record];
  });
}

export function reconcileWorkout(candidate, routines) {
  if (!isObject(candidate) || candidate.routineId === null) return null;
  const routine = routines.find((item) => item.id === candidate.routineId);
  if (!routine) return null;

  const validIndex =
    Number.isInteger(candidate.exerciseIndex) &&
    candidate.exerciseIndex >= 0 &&
    candidate.exerciseIndex < routine.exercises.length;
  if (!validIndex) return null;

  const exercise = routine.exercises[candidate.exerciseIndex];
  if (
    !isNonEmptyString(candidate.sessionId) ||
    candidate.exerciseId !== exercise.exerciseId ||
    !Number.isInteger(candidate.setIndex) ||
    candidate.setIndex < 0 ||
    candidate.setIndex >= exercise.sets ||
    !["set", "rest"].includes(candidate.phase) ||
    !Array.isArray(candidate.setResults) ||
    !Array.isArray(candidate.exerciseDurations) ||
    !isTimestamp(candidate.startedAt) ||
    !isTimestamp(candidate.exerciseStartedAt) ||
    !isTimestamp(candidate.routinePausedMs) ||
    !isTimestamp(candidate.exercisePausedMs) ||
    !(candidate.pausedAt === null || isTimestamp(candidate.pausedAt))
  ) {
    return null;
  }

  const seen = new Set();
  const setResults = candidate.setResults.filter((result) => {
    if (!isObject(result) || !SET_STATUSES.has(result.status)) return false;
    const integerIndexes = Number.isInteger(result.exerciseIndex) && Number.isInteger(result.setIndex);
    const entry = integerIndexes ? routine.exercises[result.exerciseIndex] : null;
    const precedesCurrentSet =
      result.exerciseIndex < candidate.exerciseIndex ||
      (result.exerciseIndex === candidate.exerciseIndex && result.setIndex < candidate.setIndex);
    const valid =
      integerIndexes &&
      entry?.exerciseId === result.exerciseId &&
      result.setIndex >= 0 &&
      result.setIndex < entry.sets &&
      precedesCurrentSet;
    const key = resultKey(result);
    if (!valid || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const durationIndexes = new Set();
  const exerciseDurations = candidate.exerciseDurations.filter((duration) => {
    if (
      !isObject(duration) ||
      !Number.isInteger(duration.exerciseIndex) ||
      duration.exerciseIndex < 0 ||
      duration.exerciseIndex >= candidate.exerciseIndex ||
      routine.exercises[duration.exerciseIndex]?.exerciseId !== duration.exerciseId ||
      !isTimestamp(duration.durationMs) ||
      durationIndexes.has(duration.exerciseIndex)
    ) {
      return false;
    }
    durationIndexes.add(duration.exerciseIndex);
    return true;
  });

  if (
    exerciseDurations.length !== candidate.exerciseIndex ||
    exerciseDurations.some((duration, index) => duration.exerciseIndex !== index)
  ) {
    return null;
  }

  let rest = null;
  if (candidate.phase === "rest") {
    if (
      !isObject(candidate.rest) ||
      !isTimestamp(candidate.rest.startedAt) ||
      !isTimestamp(candidate.rest.durationMs) ||
      candidate.rest.durationMs !== exercise.restSeconds * 1000 ||
      !isTimestamp(candidate.rest.pausedMs)
    ) {
      return null;
    }
    rest = {
      startedAt: candidate.rest.startedAt,
      durationMs: candidate.rest.durationMs,
      pausedMs: candidate.rest.pausedMs,
    };
  }

  return {
    sessionId: candidate.sessionId,
    routineId: candidate.routineId,
    exerciseId: candidate.exerciseId,
    exerciseIndex: candidate.exerciseIndex,
    setIndex: candidate.setIndex,
    phase: candidate.phase,
    setResults,
    exerciseDurations,
    startedAt: candidate.startedAt,
    exerciseStartedAt: candidate.exerciseStartedAt,
    routinePausedMs: candidate.routinePausedMs,
    exercisePausedMs: candidate.exercisePausedMs,
    pausedAt: candidate.pausedAt,
    rest,
  };
}

export function loadDynamicState(defaults, routines, storage = localStorage) {
  const fallback = { ...clone(defaults), activeWorkout: null };
  const persistReconciled = (state) => {
    try {
      saveDynamicState(state, storage);
    } catch {
      // The in-memory state remains usable when storage is unavailable.
    }
  };
  let serialized;
  let parsed;

  try {
    serialized = storage.getItem(WORKOUT_STORAGE_KEY);
  } catch {
    return fallback;
  }

  if (serialized === null) return fallback;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    persistReconciled(fallback);
    return fallback;
  }

  if (!isObject(parsed) || parsed.storageVersion !== defaults.storageVersion) {
    persistReconciled(fallback);
    return fallback;
  }

  const restored = {
    ...fallback,
    workoutHistory: reconcileWorkoutHistory(parsed.workoutHistory),
    activeWorkout: reconcileWorkout(parsed.activeWorkout, routines),
  };
  if (JSON.stringify(restored) !== serialized) persistReconciled(restored);
  return restored;
}

export function saveDynamicState(state, storage = localStorage) {
  storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(state));
}
