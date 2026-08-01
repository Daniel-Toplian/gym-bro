import { MAX_WEIGHT_KG } from "./data.js";
import { reconcileTrackerGoals, reconcileTrackerLog } from "./trackers.js";

export const WORKOUT_STORAGE_KEY = "gym-bro:dynamic-state";
export const MAX_REST_MS = 15 * 60 * 1000;

const SET_STATUSES = new Set(["completed", "skipped"]);
const COMPLETION_REASONS = new Set(["completed", "ended"]);
const FREE_TIMER_MODES = new Set(["stopwatch", "countdown"]);

export const MAX_FREE_TIMER_MS = 4 * 60 * 60 * 1000;

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

function isWeight(value) {
  return Number.isFinite(value) && value >= 0 && value <= MAX_WEIGHT_KG;
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

export function supersetGroup(routine, exerciseIndex) {
  const group = routine.exercises[exerciseIndex]?.supersetGroup;
  if (group === undefined) return [exerciseIndex];

  const members = [];
  routine.exercises.forEach((entry, index) => {
    if (entry.supersetGroup === group) members.push(index);
  });
  return members;
}

export function visitSequence(routine, exerciseIndex, setIndex) {
  const sequence = [];
  let index = 0;

  while (index < exerciseIndex) {
    const members = supersetGroup(routine, index);
    if (members.at(-1) >= exerciseIndex) break;
    const rounds = members.length > 1 ? routine.exercises[members[0]].sets : 1;
    for (let round = 0; round < rounds; round += 1) sequence.push(...members);
    index = members.at(-1) + 1;
  }

  const current = supersetGroup(routine, exerciseIndex);
  if (current.length > 1) {
    for (let round = 0; round < setIndex; round += 1) sequence.push(...current);
    sequence.push(...current.slice(0, current.indexOf(exerciseIndex)));
  }

  return sequence;
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

export function groupRestSeconds(routine, exerciseIndex) {
  const members = supersetGroup(routine, exerciseIndex);
  return routine.exercises[members.at(-1)].restSeconds;
}

function moveTo(workout, routine, now, exerciseIndex, setIndex, restSeconds) {
  const changedExercise = exerciseIndex !== workout.exerciseIndex;
  const exerciseDurations = changedExercise
    ? [
        ...workout.exerciseDurations,
        {
          exerciseId: workout.exerciseId,
          exerciseIndex: workout.exerciseIndex,
          durationMs: workoutTimes(workout, now).exerciseMs,
        },
      ]
    : workout.exerciseDurations;

  return {
    workout: {
      ...workout,
      exerciseId: routine.exercises[exerciseIndex].exerciseId,
      exerciseIndex,
      setIndex,
      phase: restSeconds > 0 ? "rest" : "set",
      exerciseDurations,
      exerciseStartedAt: changedExercise ? now : workout.exerciseStartedAt,
      exercisePausedMs: changedExercise ? 0 : workout.exercisePausedMs,
      rest:
        restSeconds > 0
          ? { startedAt: now, durationMs: restSeconds * 1000, pausedMs: 0, adjusted: false }
          : null,
    },
    completion: null,
  };
}

function advancePastGroup(workout, routine, now) {
  const members = supersetGroup(routine, workout.exerciseIndex);
  const rounds = members.length > 1 ? routine.exercises[members[0]].sets : 1;
  const expected = [
    ...visitSequence(routine, members[0], 0),
    ...Array.from({ length: rounds }, () => members).flat(),
  ];
  const pending = expected.slice(workout.exerciseDurations.length).map((exerciseIndex, offset) => ({
    exerciseId: routine.exercises[exerciseIndex].exerciseId,
    exerciseIndex,
    durationMs: offset === 0 ? workoutTimes(workout, now).exerciseMs : 0,
  }));
  const nextIndex = members.at(-1) + 1;

  if (nextIndex >= routine.exercises.length) {
    const settled = { ...workout, exerciseDurations: [...workout.exerciseDurations, ...pending.slice(1)] };
    return { workout: null, completion: completion(settled, routine, now, "completed") };
  }

  return {
    workout: {
      ...workout,
      exerciseId: routine.exercises[nextIndex].exerciseId,
      exerciseIndex: nextIndex,
      setIndex: 0,
      phase: "set",
      exerciseDurations: [...workout.exerciseDurations, ...pending],
      exerciseStartedAt: now,
      exercisePausedMs: 0,
      rest: null,
    },
    completion: null,
  };
}

function finishSet(workout, routine, now, status, weightKg = null) {
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
      weightKg: isWeight(weightKg) ? weightKg : null,
    },
  ];
  const updated = { ...workout, setResults };
  const members = supersetGroup(routine, workout.exerciseIndex);
  const position = members.indexOf(workout.exerciseIndex);

  if (position < members.length - 1) {
    return moveTo(updated, routine, now, members[position + 1], workout.setIndex, 0);
  }

  if (workout.setIndex === exercise.sets - 1) {
    return advancePastGroup(updated, routine, now);
  }

  return moveTo(
    updated,
    routine,
    now,
    members[0],
    workout.setIndex + 1,
    groupRestSeconds(routine, workout.exerciseIndex),
  );
}

export function completeSet(workout, routine, now, weightKg = null) {
  return finishSet(workout, routine, now, "completed", weightKg);
}

export function skipSet(workout, routine, now) {
  return finishSet(workout, routine, now, "skipped");
}

export function lastLoggedWeight(workout, exerciseIndex) {
  return (
    [...workout.setResults]
      .reverse()
      .find((result) => result.exerciseIndex === exerciseIndex && isWeight(result.weightKg))
      ?.weightKg ?? null
  );
}

export function skipExercise(workout, routine, now) {
  if (workout.pausedAt !== null) return { workout, completion: null };

  const members = supersetGroup(routine, workout.exerciseIndex);
  const completedKeys = new Set(workout.setResults.map(resultKey));
  const skipped = [];

  members.forEach((exerciseIndex) => {
    const entry = routine.exercises[exerciseIndex];
    for (let setIndex = 0; setIndex < entry.sets; setIndex += 1) {
      const candidate = {
        exerciseId: entry.exerciseId,
        exerciseIndex,
        setIndex,
        status: "skipped",
        weightKg: null,
      };
      if (!completedKeys.has(resultKey(candidate))) skipped.push(candidate);
    }
  });

  return advancePastGroup(
    { ...workout, setResults: [...workout.setResults, ...skipped], phase: "set", rest: null },
    routine,
    now,
  );
}

export function skipRest(workout) {
  if (workout.pausedAt !== null || workout.phase !== "rest") {
    return { workout, completion: null };
  }
  return { workout: { ...workout, phase: "set", rest: null }, completion: null };
}

export function adjustRest(workout, now, deltaMs) {
  if (workout.pausedAt !== null || workout.phase !== "rest" || !workout.rest) {
    return { workout, completion: null };
  }

  const durationMs = Math.min(MAX_REST_MS, Math.max(0, workout.rest.durationMs + deltaMs));
  const adjusted = { ...workout, rest: { ...workout.rest, durationMs, adjusted: true } };
  return restRemainingMs(adjusted, now) === 0 ? skipRest(adjusted) : { workout: adjusted, completion: null };
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

export function createFreeTimer(mode, durationMs = 0) {
  return {
    mode,
    durationMs: Math.min(MAX_FREE_TIMER_MS, Math.max(0, durationMs)),
    startedAt: null,
    pausedMs: 0,
    pausedAt: null,
  };
}

export function startFreeTimer(timer, now) {
  if (timer.startedAt === null) return { ...timer, startedAt: now, pausedMs: 0, pausedAt: null };
  if (timer.pausedAt === null) return timer;
  return { ...timer, pausedMs: timer.pausedMs + Math.max(0, now - timer.pausedAt), pausedAt: null };
}

export function pauseFreeTimer(timer, now) {
  if (timer.startedAt === null || timer.pausedAt !== null) return timer;
  return { ...timer, pausedAt: now };
}

export function resetFreeTimer(timer) {
  return createFreeTimer(timer.mode, timer.durationMs);
}

export function freeTimerElapsedMs(timer, now) {
  if (timer.startedAt === null) return 0;
  return activeTime(now, timer.startedAt, timer.pausedMs, timer.pausedAt);
}

export function freeTimerValueMs(timer, now) {
  const elapsed = freeTimerElapsedMs(timer, now);
  return timer.mode === "countdown" ? Math.max(0, timer.durationMs - elapsed) : elapsed;
}

export function freeTimerRunning(timer) {
  return timer.startedAt !== null && timer.pausedAt === null;
}

export function freeTimerFinished(timer, now) {
  return timer.mode === "countdown" && timer.startedAt !== null && freeTimerValueMs(timer, now) === 0;
}

export function reconcileFreeTimer(candidate) {
  if (!isObject(candidate) || !FREE_TIMER_MODES.has(candidate.mode)) return null;
  if (
    !isTimestamp(candidate.durationMs) ||
    candidate.durationMs > MAX_FREE_TIMER_MS ||
    !isTimestamp(candidate.pausedMs) ||
    !(candidate.startedAt === null || isTimestamp(candidate.startedAt)) ||
    !(candidate.pausedAt === null || isTimestamp(candidate.pausedAt)) ||
    (candidate.startedAt === null && candidate.pausedAt !== null)
  ) {
    return null;
  }

  return {
    mode: candidate.mode,
    durationMs: candidate.durationMs,
    startedAt: candidate.startedAt,
    pausedMs: candidate.pausedMs,
    pausedAt: candidate.pausedAt,
  };
}

export function createHistoryRecord(summary, routine, exerciseById) {
  const durations = new Map();
  summary.exerciseDurations.forEach((entry) => {
    durations.set(entry.exerciseIndex, (durations.get(entry.exerciseIndex) ?? 0) + entry.durationMs);
  });
  const exercises = routine.exercises.map((entry, exerciseIndex) => {
    const exercise = exerciseById.get(entry.exerciseId);
    const results = summary.setResults.filter((result) => result.exerciseIndex === exerciseIndex);

    const weights = results.map((result) => result.weightKg).filter(isWeight);

    return {
      exerciseId: entry.exerciseId,
      exerciseName: exercise?.name ?? entry.exerciseId,
      durationMs: durations.get(exerciseIndex) ?? 0,
      completedSets: results.filter((result) => result.status === "completed").length,
      skippedSets: results.filter((result) => result.status === "skipped").length,
      topWeightKg: weights.length === 0 ? null : Math.max(...weights),
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

export function removeHistoryRecord(history, id) {
  return history.filter((item) => item.id !== id);
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
      topWeightKg: isWeight(exercise.topWeightKg) ? exercise.topWeightKg : null,
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

  const currentRank = visitSequence(routine, candidate.exerciseIndex, candidate.setIndex).length;
  const seen = new Set();
  const setResults = candidate.setResults.flatMap((result) => {
    if (!isObject(result) || !SET_STATUSES.has(result.status)) return [];
    const integerIndexes = Number.isInteger(result.exerciseIndex) && Number.isInteger(result.setIndex);
    const entry = integerIndexes ? routine.exercises[result.exerciseIndex] : null;
    const inRange = entry && result.setIndex >= 0 && result.setIndex < entry.sets;
    const resultRank = inRange
      ? visitSequence(routine, result.exerciseIndex, result.setIndex).length
      : Number.POSITIVE_INFINITY;
    const precedesCurrentSet =
      resultRank < currentRank ||
      (resultRank === currentRank && result.setIndex < candidate.setIndex);
    const valid =
      integerIndexes &&
      entry?.exerciseId === result.exerciseId &&
      result.setIndex >= 0 &&
      result.setIndex < entry.sets &&
      precedesCurrentSet;
    const key = resultKey(result);
    if (!valid || seen.has(key)) return [];
    seen.add(key);
    return [
      {
        exerciseId: result.exerciseId,
        exerciseIndex: result.exerciseIndex,
        setIndex: result.setIndex,
        status: result.status,
        weightKg: isWeight(result.weightKg) ? result.weightKg : null,
      },
    ];
  });

  const exerciseDurations = candidate.exerciseDurations.filter(
    (duration) =>
      isObject(duration) &&
      Number.isInteger(duration.exerciseIndex) &&
      routine.exercises[duration.exerciseIndex]?.exerciseId === duration.exerciseId &&
      isTimestamp(duration.durationMs),
  );

  const expectedVisits = visitSequence(routine, candidate.exerciseIndex, candidate.setIndex);
  if (
    exerciseDurations.length !== expectedVisits.length ||
    exerciseDurations.some((duration, index) => duration.exerciseIndex !== expectedVisits[index])
  ) {
    return null;
  }

  let rest = null;
  if (candidate.phase === "rest") {
    const adjusted = candidate.rest?.adjusted === true;
    const durationAllowed = adjusted
      ? candidate.rest.durationMs <= MAX_REST_MS
      : candidate.rest?.durationMs === groupRestSeconds(routine, candidate.exerciseIndex) * 1000;

    if (
      !isObject(candidate.rest) ||
      !isTimestamp(candidate.rest.startedAt) ||
      !isTimestamp(candidate.rest.durationMs) ||
      !durationAllowed ||
      !isTimestamp(candidate.rest.pausedMs)
    ) {
      return null;
    }
    rest = {
      startedAt: candidate.rest.startedAt,
      durationMs: candidate.rest.durationMs,
      pausedMs: candidate.rest.pausedMs,
      adjusted,
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
  const fallback = { ...clone(defaults), activeWorkout: null, freeTimer: null };
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
    freeTimer: reconcileFreeTimer(parsed.freeTimer),
    dailyTotals: reconcileTrackerLog(parsed.dailyTotals),
    trackerGoals: reconcileTrackerGoals(parsed.trackerGoals, defaults.trackerGoals),
  };
  if (JSON.stringify(restored) !== serialized) persistReconciled(restored);
  return restored;
}

export function saveDynamicState(state, storage = localStorage) {
  storage.setItem(WORKOUT_STORAGE_KEY, JSON.stringify(state));
}
