export const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTUBE_EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const IMAGE_PATH_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;

export const MAX_WEIGHT_KG = 1000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseExerciseMedia(value) {
  if (!isNonEmptyString(value)) return null;

  let url;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  let videoId = null;

  if (url.hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    videoId = pathParts[0] === "embed" || pathParts[0] === "shorts" ? pathParts[1] : url.searchParams.get("v");
  } else if (YOUTUBE_EMBED_HOSTS.has(url.hostname)) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    videoId = pathParts[0] === "embed" ? pathParts[1] : null;
  }

  if (YOUTUBE_ID_PATTERN.test(videoId ?? "")) {
    return {
      type: "youtube",
      src: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
    };
  }

  if (IMAGE_PATH_PATTERN.test(url.pathname)) {
    return { type: "image", src: url.href };
  }

  return null;
}

function assertUniqueIds(items, label) {
  const ids = new Set();

  items.forEach((item, index) => {
    assert(isPlainObject(item), `${label}[${index}] must be an object`);
    assert(isNonEmptyString(item.id), `${label}[${index}].id must be a non-empty string`);
    assert(!ids.has(item.id), `${label} contains duplicate id "${item.id}"`);
    ids.add(item.id);
  });

  return ids;
}

export function validateData({ exercises, routines, schedule, defaults }) {
  assert(Array.isArray(exercises), "exercises must be an array");
  assert(Array.isArray(routines), "routines must be an array");
  assert(isPlainObject(schedule), "schedule must be an object");
  assert(isPlainObject(defaults), "defaults must be an object");

  const exerciseIds = assertUniqueIds(exercises, "exercises");
  const routineIds = assertUniqueIds(routines, "routines");

  exercises.forEach((exercise, index) => {
    assert(isNonEmptyString(exercise.name), `exercises[${index}].name must be a non-empty string`);
    assert(
      Array.isArray(exercise.bodyParts) && exercise.bodyParts.length > 0,
      `exercises[${index}].bodyParts must be a non-empty array`,
    );
    assert(
      exercise.bodyParts.every(isNonEmptyString),
      `exercises[${index}].bodyParts must contain only non-empty strings`,
    );
    assert(
      new Set(exercise.bodyParts).size === exercise.bodyParts.length,
      `exercises[${index}].bodyParts must not repeat a body part`,
    );
  });

  routines.forEach((routine, routineIndex) => {
    assert(isNonEmptyString(routine.name), `routines[${routineIndex}].name must be a non-empty string`);
    assert(
      Array.isArray(routine.exercises) && routine.exercises.length > 0,
      `routines[${routineIndex}].exercises must be a non-empty array`,
    );

    routine.exercises.forEach((entry, entryIndex) => {
      const path = `routines[${routineIndex}].exercises[${entryIndex}]`;
      assert(isPlainObject(entry), `${path} must be an object`);
      assert(
        isNonEmptyString(entry.exerciseId) && exerciseIds.has(entry.exerciseId),
        `${path}.exerciseId must reference an existing exercise`,
      );
      assert(Number.isInteger(entry.sets) && entry.sets > 0, `${path}.sets must be a positive integer`);
      assert(
        Number.isInteger(entry.restSeconds) && entry.restSeconds >= 0,
        `${path}.restSeconds must be a non-negative integer`,
      );
      assert(
        entry.weightKg === undefined ||
          (Number.isFinite(entry.weightKg) && entry.weightKg >= 0 && entry.weightKg <= MAX_WEIGHT_KG),
        `${path}.weightKg must be a number between 0 and ${MAX_WEIGHT_KG}`,
      );
      assert(
        entry.supersetGroup === undefined || isNonEmptyString(entry.supersetGroup),
        `${path}.supersetGroup must be a non-empty string`,
      );
    });

    const groups = new Map();
    routine.exercises.forEach((entry, entryIndex) => {
      if (entry.supersetGroup === undefined) return;
      if (!groups.has(entry.supersetGroup)) groups.set(entry.supersetGroup, []);
      groups.get(entry.supersetGroup).push(entryIndex);
    });

    groups.forEach((indexes, group) => {
      const path = `routines[${routineIndex}] superset "${group}"`;
      assert(indexes.length > 1, `${path} must contain at least two exercises`);
      assert(
        indexes.every((entryIndex, position) => entryIndex === indexes[0] + position),
        `${path} must group consecutive exercises`,
      );
      assert(
        indexes.every((entryIndex) => routine.exercises[entryIndex].sets === routine.exercises[indexes[0]].sets),
        `${path} must declare the same number of sets for every exercise`,
      );
    });
  });

  assert(isPlainObject(schedule.days), "schedule.days must be an object");
  assert(
    Object.keys(schedule.days).length === DAYS.length,
    "schedule.days must contain only Sunday through Saturday",
  );

  DAYS.forEach((day) => {
    assert(Object.hasOwn(schedule.days, day), `schedule.days.${day} is required`);
    const routineId = schedule.days[day];
    assert(
      routineId === null || (isNonEmptyString(routineId) && routineIds.has(routineId)),
      `schedule.days.${day} must be null or reference an existing routine`,
    );
  });

  assert(
    Number.isInteger(defaults.storageVersion) && defaults.storageVersion > 0,
    "defaults.storageVersion must be a positive integer",
  );
  assert(isPlainObject(defaults.activeWorkout), "defaults.activeWorkout must declare an object shape");
  const activeWorkoutFields = [
    "sessionId",
    "routineId",
    "exerciseId",
    "exerciseIndex",
    "setIndex",
    "phase",
    "setResults",
    "exerciseDurations",
    "startedAt",
    "exerciseStartedAt",
    "routinePausedMs",
    "exercisePausedMs",
    "pausedAt",
    "rest",
  ];
  assert(
    activeWorkoutFields.every((field) => Object.hasOwn(defaults.activeWorkout, field)),
    "defaults.activeWorkout must declare the complete active workout shape",
  );
  assert(defaults.activeWorkout.routineId === null, "defaults.activeWorkout.routineId must be null");
  assert(defaults.activeWorkout.sessionId === null, "defaults.activeWorkout.sessionId must be null");
  assert(Array.isArray(defaults.activeWorkout.setResults), "defaults.activeWorkout.setResults must be an array");
  assert(
    Array.isArray(defaults.activeWorkout.exerciseDurations),
    "defaults.activeWorkout.exerciseDurations must be an array",
  );
  assert(Array.isArray(defaults.workoutHistory), "defaults.workoutHistory must be an array");
  assert(
    Object.hasOwn(defaults, "freeTimer") && defaults.freeTimer === null,
    "defaults.freeTimer must be null",
  );
  assert(
    isPlainObject(defaults.dailyTotals) && Object.keys(defaults.dailyTotals).length === 0,
    "defaults.dailyTotals must be an empty object",
  );
  assert(isPlainObject(defaults.trackerGoals), "defaults.trackerGoals must be an object");
  ["calories", "protein", "waterMl"].forEach((field) => {
    assert(
      Number.isFinite(defaults.trackerGoals[field]) && defaults.trackerGoals[field] > 0,
      `defaults.trackerGoals.${field} must be a positive number`,
    );
  });

  return { exercises, routines, schedule, defaults };
}

export async function loadData(fetcher = fetch) {
  const paths = ["exercises", "routines", "schedule", "defaults"];
  const responses = await Promise.all(paths.map((name) => fetcher(`data/${name}.json`)));

  responses.forEach((response, index) => {
    if (!response.ok) {
      throw new Error(`Unable to load ${paths[index]} data`);
    }
  });

  const [exercises, routines, schedule, defaults] = await Promise.all(
    responses.map((response) => response.json()),
  );

  return validateData({ exercises, routines, schedule, defaults });
}
