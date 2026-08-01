import "./styles.css";
import { DAYS, loadData, parseExerciseMedia } from "./data.js";
import {
  adjustRest,
  advanceWorkout,
  appendHistoryRecord,
  completeSet,
  createFreeTimer,
  createHistoryRecord,
  createWorkout,
  endWorkout,
  lastLoggedWeight,
  freeTimerFinished,
  freeTimerRunning,
  freeTimerValueMs,
  loadDynamicState,
  newestHistoryFirst,
  pauseFreeTimer,
  pauseWorkout,
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
  workoutTimes,
} from "./workout.js";
import {
  TRACKER_FIELDS,
  addTrackerAmount,
  clearTrackerDay,
  pruneTrackerLog,
  recentTrackerDays,
  todayKey,
  trackerTotals,
} from "./trackers.js";

const app = document.querySelector("#app");

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}

function formatDay(day) {
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
}

function formatRest(seconds) {
  return seconds === 60 ? "1 min rest" : `${seconds} sec rest`;
}

function formatEntryMeta(entry) {
  const parts = [`${entry.sets} sets`, formatRest(entry.restSeconds)];
  if (entry.weightKg !== undefined) parts.push(`${entry.weightKg} kg`);
  return parts.join(" · ");
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCompletedAt(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

const FREE_TIMER_PRESETS = [30, 60, 90];

function renderFreeTimer(timer, now, open) {
  const mode = timer?.mode ?? "stopwatch";
  const running = timer ? freeTimerRunning(timer) : false;
  const finished = timer ? freeTimerFinished(timer, now) : false;
  const value = timer ? freeTimerValueMs(timer, now) : 0;
  const idle = !timer || timer.startedAt === null;
  const label = `${open ? "Close" : "Open"} timer${idle ? "" : `, ${formatDuration(value)}`}`;

  return `
    <div class="free-timer${finished ? " finished" : ""}">
      <button
        class="timer-button"
        type="button"
        data-timer-action="toggle-panel"
        aria-expanded="${open}"
        aria-controls="free-timer-panel"
        aria-label="${escapeHtml(label)}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2.5M9 2h6" />
        </svg>
      </button>
      ${
        idle
          ? ""
          : `<strong class="free-timer-value" data-timer="free" aria-hidden="true">${formatDuration(value)}</strong>`
      }

      <div class="free-timer-panel" id="free-timer-panel" role="group" aria-label="Free timer" ${open ? "" : "hidden"}>
        <p class="nav-label">Timer</p>
        <div class="free-timer-modes" role="group" aria-label="Timer mode">
          ${["stopwatch", "countdown"]
            .map(
              (option) => `
                <button
                  class="mode-button"
                  type="button"
                  data-timer-action="mode"
                  data-timer-mode="${option}"
                  aria-pressed="${option === mode}"
                >${option === "stopwatch" ? "Stopwatch" : "Countdown"}</button>
              `,
            )
            .join("")}
        </div>
        <strong class="free-timer-panel-value" data-timer="free-panel" role="timer" aria-live="off">${formatDuration(value)}</strong>
        ${
          mode === "countdown"
            ? `<div class="free-timer-presets">
                ${FREE_TIMER_PRESETS.map(
                  (seconds) => `
                    <button class="secondary-button" type="button" data-timer-action="preset" data-timer-seconds="${seconds}">
                      ${seconds}s
                    </button>
                  `,
                ).join("")}
                <label class="free-timer-custom">
                  <span class="visually-hidden">Countdown seconds</span>
                  <input
                    type="number"
                    min="1"
                    max="14400"
                    step="1"
                    inputmode="numeric"
                    placeholder="sec"
                    data-timer-input="seconds"
                  >
                </label>
                <button class="secondary-button" type="button" data-timer-action="custom">Set</button>
              </div>`
            : ""
        }
        <div class="free-timer-actions">
          <button class="primary-button" type="button" data-timer-action="${running ? "pause" : "start"}">
            ${running ? "Pause" : idle ? "Start" : "Resume"}
          </button>
          ${idle ? "" : `<button class="secondary-button" type="button" data-timer-action="reset">Reset</button>`}
        </div>
        <p class="free-timer-status" role="status">${finished ? "Countdown finished" : ""}</p>
      </div>
    </div>
  `;
}

function renderBodyParts(exercise) {
  return `
    <ul class="body-parts" aria-label="Body parts worked">
      ${exercise.bodyParts
        .map((part) => `<li class="body-part-chip">${escapeHtml(part)}</li>`)
        .join("")}
    </ul>
  `;
}

function routineBodyParts(routine, exerciseById) {
  const parts = new Set();
  routine.exercises.forEach((entry) => {
    exerciseById.get(entry.exerciseId)?.bodyParts.forEach((part) => parts.add(part));
  });
  return [...parts];
}

function renderRoutineExercises(routine, exerciseById) {
  return routine.exercises
    .map((entry, entryIndex) => {
      const exercise = exerciseById.get(entry.exerciseId);
      const members = supersetGroup(routine, entryIndex);
      const grouped = members.length > 1;
      const opensGroup = grouped && members[0] === entryIndex;
      const closesGroup = grouped && members.at(-1) === entryIndex;

      return `
        ${opensGroup ? `<li class="superset-label" aria-hidden="true">Superset · ${members.length} exercises</li>` : ""}
        <li class="exercise-row${grouped ? " superset-row" : ""}${closesGroup ? " superset-end" : ""}">
          <div class="exercise-row-main">
            <span>${escapeHtml(exercise.name)}</span>
            ${renderBodyParts(exercise)}
          </div>
          <span class="exercise-meta">${formatEntryMeta(entry)}</span>
        </li>
      `;
    })
    .join("");
}

function renderWeekDetail(day, routine, exerciseById) {
  return `
    <section class="week-detail" id="week-detail" aria-label="${escapeHtml(`${formatDay(day)} routine detail`)}">
      <div class="week-detail-heading">
        <div>
          <p class="routine-label">${formatDay(day)}</p>
          <h2>${escapeHtml(routine.name)}</h2>
        </div>
        <button class="text-button" type="button" data-expand-day="${escapeHtml(day)}">Close</button>
      </div>
      <ul class="exercise-list">
        ${renderRoutineExercises(routine, exerciseById)}
      </ul>
      <button class="start-workout-button" type="button" data-start-routine="${escapeHtml(routine.id)}">
        Start routine
      </button>
    </section>
  `;
}

function renderWeekly(data, routineById, exerciseById, expandedDay) {
  const workoutCount = DAYS.filter((day) => data.schedule.days[day] !== null).length;
  const expandedRoutineId = expandedDay ? data.schedule.days[expandedDay] : null;
  const expandedRoutine = expandedRoutineId ? routineById.get(expandedRoutineId) : null;

  return `
    <section class="view-heading" aria-labelledby="weekly-title">
      <p class="eyebrow">This week</p>
      <h1 id="weekly-title">Weekly rhythm</h1>
      <p>${workoutCount} workout${workoutCount === 1 ? "" : "s"}, ${DAYS.length - workoutCount} rest days</p>
    </section>
    <ol class="week-grid" aria-label="Sunday through Saturday workout plan">
      ${DAYS.map((day) => {
        const routineId = data.schedule.days[day];
        const routine = routineId ? routineById.get(routineId) : null;

        if (!routine) {
          return `
            <li class="day-card rest-day">
              <div class="day-head">
                <span class="day-initial" aria-hidden="true">${formatDay(day).charAt(0)}</span>
                <span class="day-dot" aria-hidden="true"></span>
                <span class="day-name">${formatDay(day)}</span>
                <span class="day-status">Rest</span>
              </div>
              <p class="day-card-body">Recovery day</p>
            </li>
          `;
        }

        const parts = routineBodyParts(routine, exerciseById);
        const shown = parts.slice(0, 3);
        const hidden = parts.length - shown.length;
        const expanded = day === expandedDay;

        return `
          <li class="day-card routine-day${expanded ? " day-expanded" : ""}">
            <button
              class="day-head"
              type="button"
              data-expand-day="${escapeHtml(day)}"
              aria-expanded="${expanded}"
              aria-controls="week-detail"
              aria-label="${escapeHtml(`${formatDay(day)}, ${routine.name}. ${expanded ? "Hide" : "Show"} exercises`)}"
            >
              <span class="day-initial" aria-hidden="true">${formatDay(day).charAt(0)}</span>
              <span class="day-dot" aria-hidden="true"></span>
              <span class="day-name" aria-hidden="true">${formatDay(day)}</span>
              <span class="day-status" aria-hidden="true">Workout</span>
            </button>
            <div class="day-card-body">
              <h3>${escapeHtml(routine.name)}</h3>
              <p class="day-card-count">${routine.exercises.length} exercise${routine.exercises.length === 1 ? "" : "s"}</p>
              <ul class="body-parts" aria-label="${escapeHtml(`Body parts worked: ${parts.join(", ")}`)}">
                ${shown.map((part) => `<li class="body-part-chip">${escapeHtml(part)}</li>`).join("")}
                ${hidden > 0 ? `<li class="body-part-chip muted-chip" aria-hidden="true">+${hidden}</li>` : ""}
              </ul>
              <div class="day-card-actions">
                <button class="start-workout-button" type="button" data-start-routine="${escapeHtml(routine.id)}">
                  Start routine
                </button>
              </div>
            </div>
          </li>
        `;
      }).join("")}
    </ol>
    ${expandedRoutine ? renderWeekDetail(expandedDay, expandedRoutine, exerciseById) : ""}
  `;
}

function renderRoutines(data, exerciseById) {
  return `
    <section class="view-heading" aria-labelledby="routines-title">
      <p class="eyebrow">Library</p>
      <h1 id="routines-title">Routines</h1>
      <p>Every configured workout, ready when you need it.</p>
    </section>
    <div class="routine-grid">
      ${data.routines
        .map(
          (routine) => `
            <article class="routine-card">
              <div class="routine-card-heading">
                <div>
                  <p class="routine-label">Routine</p>
                  <h2>${escapeHtml(routine.name)}</h2>
                </div>
                <span>${routine.exercises.length} exercise${routine.exercises.length === 1 ? "" : "s"}</span>
              </div>
              <ul class="exercise-list">
                ${renderRoutineExercises(routine, exerciseById)}
              </ul>
              <button class="start-workout-button" type="button" data-start-routine="${escapeHtml(routine.id)}">
                Start routine
              </button>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderNoMedia() {
  return `
    <div class="exercise-media-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5l14 14M7 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12M10 5h7a2 2 0 0 1 2 2v8" />
      </svg>
      <span>No instruction media</span>
    </div>
  `;
}

function renderExerciseMedia(exercise) {
  const media = parseExerciseMedia(exercise.media);

  if (media?.type === "youtube") {
    return `
      <iframe
        src="${escapeHtml(media.src)}"
        title="${escapeHtml(`${exercise.name} instruction video`)}"
        loading="lazy"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      ></iframe>
    `;
  }

  if (media?.type === "image") {
    return `
      <img
        class="exercise-image"
        src="${escapeHtml(media.src)}"
        alt="${escapeHtml(`${exercise.name} exercise demonstration`)}"
        loading="lazy"
        referrerpolicy="no-referrer"
      >
    `;
  }

  return renderNoMedia();
}

function allBodyParts(exercises) {
  return [...new Set(exercises.flatMap((exercise) => exercise.bodyParts))].sort();
}

function renderBodyPartFilters(exercises, selected) {
  return `
    <div class="body-part-filters" role="group" aria-label="Filter by body part">
      <button
        class="body-part-chip filter-chip"
        type="button"
        data-filter-body-part=""
        aria-pressed="${selected.size === 0}"
      >All</button>
      ${allBodyParts(exercises)
        .map(
          (part) => `
            <button
              class="body-part-chip filter-chip"
              type="button"
              data-filter-body-part="${escapeHtml(part)}"
              aria-pressed="${selected.has(part)}"
            >${escapeHtml(part)}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderExercises(data, selected) {
  const visible =
    selected.size === 0
      ? data.exercises
      : data.exercises.filter((exercise) => exercise.bodyParts.some((part) => selected.has(part)));

  return `
    <section class="view-heading" aria-labelledby="exercises-title">
      <p class="eyebrow">Library</p>
      <h1 id="exercises-title">Exercises</h1>
      <p role="status">
        ${
          selected.size === 0
            ? `${data.exercises.length} configured exercise${data.exercises.length === 1 ? "" : "s"}, with guidance where available.`
            : `${visible.length} of ${data.exercises.length} exercises match the selected body parts.`
        }
      </p>
    </section>
    ${renderBodyPartFilters(data.exercises, selected)}
    ${
      visible.length === 0
        ? `<section class="history-empty" aria-label="No matching exercises">
            <h2>No exercises match</h2>
            <p>Clear a body part or pick another to widen the search.</p>
          </section>`
        : `<div class="exercise-grid">
            ${visible
              .map(
                (exercise) => `
                  <article class="exercise-card">
                    <div class="exercise-card-heading">
                      <p class="routine-label">Exercise</p>
                      <h2>${escapeHtml(exercise.name)}</h2>
                      ${renderBodyParts(exercise)}
                    </div>
                    <div class="exercise-media">
                      ${renderExerciseMedia(exercise)}
                    </div>
                  </article>
                `,
              )
              .join("")}
          </div>`
    }
  `;
}

function renderSupersetTrack(routine, exerciseById, exerciseIndex) {
  const members = supersetGroup(routine, exerciseIndex);
  if (members.length === 1) return "";

  return `
    <div class="superset-track" aria-label="Superset order">
      <p class="routine-label">Superset</p>
      <ol>
        ${members
          .map(
            (index) => `
              <li class="${index === exerciseIndex ? "superset-current" : ""}">
                ${escapeHtml(exerciseById.get(routine.exercises[index].exerciseId).name)}
              </li>
            `,
          )
          .join("")}
      </ol>
    </div>
  `;
}

function renderNextExercise(routine, exerciseById, exerciseIndex, setIndex) {
  const members = supersetGroup(routine, exerciseIndex);
  const position = members.indexOf(exerciseIndex);
  const withinGroup = position < members.length - 1 ? members[position + 1] : null;
  const lastRound = setIndex === routine.exercises[members[0]].sets - 1;
  const nextRound = !lastRound ? members[0] : null;
  const nextIndex = withinGroup ?? nextRound ?? members.at(-1) + 1;
  const nextEntry = routine.exercises[nextIndex];

  if (!nextEntry) {
    return `
      <aside class="next-exercise last-exercise" aria-label="Next exercise">
        <p class="routine-label">Up next</p>
        <p class="next-exercise-empty">Last exercise</p>
      </aside>
    `;
  }

  const nextExercise = exerciseById.get(nextEntry.exerciseId);

  return `
    <aside class="next-exercise" aria-label="Next exercise">
      <p class="routine-label">Up next</p>
      <h3>${escapeHtml(nextExercise.name)}</h3>
      <p class="exercise-meta">${formatEntryMeta(nextEntry)}</p>
      ${renderBodyParts(nextExercise)}
    </aside>
  `;
}

function renderActiveWorkout(workout, routine, exerciseById, now) {
  const routineEntry = routine.exercises[workout.exerciseIndex];
  const exercise = exerciseById.get(routineEntry.exerciseId);
  const times = workoutTimes(workout, now);
  const resting = workout.phase === "rest";
  const paused = workout.pausedAt !== null;
  const completedSets = workout.setResults.filter((result) => result.status === "completed").length;
  const skippedSets = workout.setResults.filter((result) => result.status === "skipped").length;
  const prefillWeight =
    lastLoggedWeight(workout, workout.exerciseIndex) ?? routineEntry.weightKg ?? null;
  const grouped = supersetGroup(routine, workout.exerciseIndex).length > 1;
  const unit = grouped ? "round" : "set";

  return `
    <section class="active-workout" aria-labelledby="active-workout-title">
      <div class="active-workout-heading">
        <div>
          <p class="eyebrow">Active routine</p>
          <h1 id="active-workout-title">${escapeHtml(routine.name)}</h1>
          <p>Exercise ${workout.exerciseIndex + 1} of ${routine.exercises.length}</p>
        </div>
        <button class="secondary-button" type="button" data-workout-action="${paused ? "resume" : "pause"}">
          ${paused ? "Resume" : "Pause"}
        </button>
      </div>

      <div class="workout-timers" aria-label="Workout timers">
        <div>
          <span>Exercise</span>
          <strong data-timer="exercise">${formatDuration(times.exerciseMs)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong data-timer="routine">${formatDuration(times.routineMs)}</strong>
        </div>
      </div>

      <div class="active-workout-grid">
        <div class="active-workout-panel">
          <p class="routine-label">Current exercise</p>
          <h2>${escapeHtml(exercise.name)}</h2>
          ${renderBodyParts(exercise)}
          ${renderSupersetTrack(routine, exerciseById, workout.exerciseIndex)}
          <div class="set-progress" aria-label="${grouped ? "Round progress" : "Set progress"}">
            ${Array.from({ length: routineEntry.sets }, (_, setIndex) => {
              const result = workout.setResults.find(
                (item) => item.exerciseIndex === workout.exerciseIndex && item.setIndex === setIndex,
              );
              const status = result?.status ?? (setIndex === workout.setIndex ? "current" : "pending");
              return `<span class="set-marker ${status}">${setIndex + 1}</span>`;
            }).join("")}
          </div>

          ${
            resting
              ? `<div class="rest-countdown" role="timer" aria-live="polite">
                  <span>Rest before ${unit} ${workout.setIndex + 1}</span>
                  <strong data-timer="rest">${Math.ceil(restRemainingMs(workout, now) / 1000)}</strong>
                  <small>seconds</small>
                </div>
                <div class="rest-controls">
                  <button class="secondary-button" type="button" data-workout-action="rest-minus" ${paused ? "disabled" : ""}>&minus;15s</button>
                  <button class="secondary-button" type="button" data-workout-action="rest-plus" ${paused ? "disabled" : ""}>+15s</button>
                  <button class="primary-button" type="button" data-workout-action="skip-rest" ${paused ? "disabled" : ""}>Skip rest</button>
                </div>`
              : `<div class="current-set">
                  <span>Current ${unit}</span>
                  <strong>${workout.setIndex + 1}<small> / ${routineEntry.sets}</small></strong>
                </div>`
          }

          ${
            resting
              ? ""
              : `<label class="set-weight">
                  <span>Weight</span>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="0.5"
                    inputmode="decimal"
                    placeholder="kg"
                    value="${prefillWeight === null ? "" : prefillWeight}"
                    data-workout-input="weight"
                    ${paused ? "disabled" : ""}
                  >
                  <small>kg</small>
                </label>`
          }

          <div class="workout-actions">
            ${
              resting
                ? ""
                : `<button class="primary-button" type="button" data-workout-action="complete-set" ${paused ? "disabled" : ""}>Complete set</button>
                   <button class="secondary-button" type="button" data-workout-action="skip-set" ${paused ? "disabled" : ""}>Skip set</button>`
            }
            <button class="text-button" type="button" data-workout-action="skip-exercise" ${paused ? "disabled" : ""}>
              ${grouped ? "Skip superset" : "Skip exercise"}
            </button>
          </div>
          <p class="workout-result-counts">${completedSets} completed · ${skippedSets} skipped</p>
          ${renderNextExercise(routine, exerciseById, workout.exerciseIndex, workout.setIndex)}
        </div>
      </div>

      <button class="end-workout-button" type="button" data-workout-action="end">End routine</button>
    </section>
  `;
}

function renderSessionExercises(session) {
  return session.exercises
    .map(
      (exercise) => `
        <li class="history-exercise">
          <div>
            <strong>${escapeHtml(exercise.exerciseName)}</strong>
            <span>
              ${exercise.completedSets} completed · ${exercise.skippedSets} skipped${
                exercise.topWeightKg === null ? "" : ` · top ${exercise.topWeightKg} kg`
              }
            </span>
          </div>
          <time>${formatDuration(exercise.durationMs)}</time>
        </li>
      `,
    )
    .join("");
}

function renderCompletion(summary) {
  return `
    <section class="completion-summary" aria-labelledby="completion-title">
      <p class="eyebrow">${summary.reason === "completed" ? "Routine complete" : "Routine ended"}</p>
      <h1 id="completion-title">${escapeHtml(summary.routineName)}</h1>
      <p>${summary.completedSets} completed set${summary.completedSets === 1 ? "" : "s"}, ${summary.skippedSets} skipped · ${formatDuration(summary.durationMs)}</p>
      <ul class="history-exercises" aria-label="Exercise summary">
        ${renderSessionExercises(summary)}
      </ul>
      <div class="completion-actions">
        <a class="primary-button" href="#weekly">Back to weekly plan</a>
        <a class="secondary-button" href="#history">View history</a>
      </div>
    </section>
  `;
}

function renderHistory(history) {
  const sessions = newestHistoryFirst(history);

  return `
    <section class="view-heading" aria-labelledby="history-title">
      <p class="eyebrow">Your activity</p>
      <h1 id="history-title">History</h1>
      <p>Completed and intentionally ended routines saved on this device.</p>
    </section>
    ${
      sessions.length === 0
        ? `<section class="history-empty" aria-label="Empty workout history">
            <h2>No workout history yet</h2>
            <p>Finish or end a routine and its summary will appear here.</p>
            <a class="primary-button" href="#weekly">View weekly plan</a>
          </section>`
        : `<ol class="history-list">
            ${sessions
              .map(
                (session) => `
                  <li>
                    <article class="history-card">
                      <div class="history-card-heading">
                        <div>
                          <p class="routine-label">${session.reason === "completed" ? "Completed" : "Ended"}</p>
                          <h2>${escapeHtml(session.routineName)}</h2>
                          <time datetime="${new Date(session.completedAt).toISOString()}">${escapeHtml(formatCompletedAt(session.completedAt))}</time>
                        </div>
                        <div class="history-card-aside">
                          <strong>${formatDuration(session.durationMs)}</strong>
                          <button
                            class="text-button"
                            type="button"
                            data-delete-history="${escapeHtml(session.id)}"
                          >Delete</button>
                        </div>
                      </div>
                      <p class="history-counts">${session.completedSets} completed · ${session.skippedSets} skipped</p>
                      <ul class="history-exercises">
                        ${renderSessionExercises(session)}
                      </ul>
                    </article>
                  </li>
                `,
              )
              .join("")}
          </ol>`
    }
  `;
}

const TRACKER_META = {
  calories: {
    label: "Calories",
    unit: "kcal",
    quickAdds: [100, 250, 500],
    inputLabel: "Calories to add",
  },
  protein: {
    label: "Protein",
    unit: "g",
    quickAdds: [20, 30, 50],
    inputLabel: "Grams of protein to add",
  },
  waterMl: {
    label: "Water",
    unit: "ml",
    quickAdds: [250, 500, 750],
    inputLabel: "Millilitres to add",
  },
};

function renderTrackerTrend(days, field, goal) {
  return `
    <ol class="tracker-trend" aria-label="Last 7 days">
      ${days
        .map((day) => {
          const percent = Math.min(100, Math.round((day[field] / goal) * 100));
          return `
            <li>
              <span class="tracker-bar" style="--fill: ${percent}%" aria-hidden="true"></span>
              <span class="tracker-bar-label">${escapeHtml(day.dateKey.slice(8))}</span>
              <span class="visually-hidden">${day.dateKey}: ${day[field]}</span>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

function renderTrackerCard(field, total, goal, days) {
  const meta = TRACKER_META[field];
  const percent = Math.min(100, Math.round((total / goal) * 100));

  return `
    <article class="tracker-card">
      <div class="tracker-card-heading">
        <div>
          <p class="routine-label">${meta.label}</p>
          <strong>${total}<small> / ${goal} ${meta.unit}</small></strong>
        </div>
        <span class="tracker-percent">${percent}%</span>
      </div>
      <div
        class="tracker-meter"
        role="progressbar"
        aria-valuenow="${total}"
        aria-valuemin="0"
        aria-valuemax="${goal}"
        aria-label="${escapeHtml(`${meta.label} against today's goal`)}"
      >
        <span style="--fill: ${percent}%"></span>
      </div>
      <div class="tracker-actions">
        ${meta.quickAdds
          .map(
            (amount) => `
              <button
                class="secondary-button"
                type="button"
                data-tracker-action="add"
                data-tracker-field="${field}"
                data-tracker-amount="${amount}"
              >+${amount}</button>
            `,
          )
          .join("")}
      </div>
      <div class="tracker-custom">
        <label>
          <span class="visually-hidden">${meta.inputLabel}</span>
          <input
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            placeholder="${meta.unit}"
            data-tracker-input="${field}"
          >
        </label>
        <button class="text-button" type="button" data-tracker-action="add-custom" data-tracker-field="${field}">
          Add
        </button>
      </div>
      ${renderTrackerTrend(days, field, goal)}
    </article>
  `;
}

function renderTrackers(dynamicState, now) {
  const dateKey = todayKey(now);
  const totals = trackerTotals(dynamicState.dailyTotals, dateKey);
  const days = recentTrackerDays(dynamicState.dailyTotals, dateKey, 7);
  const goals = dynamicState.trackerGoals;

  return `
    <section class="view-heading" aria-labelledby="trackers-title">
      <p class="eyebrow">Today</p>
      <h1 id="trackers-title">Trackers</h1>
      <p>Calories, protein and water logged for ${escapeHtml(dateKey)}, against your daily goals.</p>
    </section>
    <div class="tracker-grid">
      ${TRACKER_FIELDS.map((field) =>
        renderTrackerCard(field, totals[field], goals[field], days),
      ).join("")}
    </div>
    <button class="text-button" type="button" data-tracker-action="reset">Reset today</button>
  `;
}

function currentView() {
  const view = window.location.hash.slice(1);
  return ["weekly", "routines", "exercises", "trackers", "history", "active"].includes(view)
    ? view
    : "weekly";
}

function renderShell(data) {
  const routineById = new Map(data.routines.map((routine) => [routine.id, routine]));
  const exerciseById = new Map(data.exercises.map((exercise) => [exercise.id, exercise]));
  let dynamicState = loadDynamicState(data.defaults, data.routines);
  let completionSummary = null;
  let expandedDay = null;
  let timerPanelOpen = false;
  const selectedBodyParts = new Set();

  function persist() {
    try {
      saveDynamicState(dynamicState);
    } catch (error) {
      console.error("Unable to persist workout state", error);
    }
  }

  if (dynamicState.activeWorkout) {
    const advanced = advanceWorkout(dynamicState.activeWorkout, Date.now());
    if (advanced !== dynamicState.activeWorkout) {
      dynamicState = { ...dynamicState, activeWorkout: advanced };
      persist();
    }
  }

  app.innerHTML = `
    <header class="site-header">
      <button
        class="menu-button"
        type="button"
        aria-label="Open navigation"
        aria-expanded="false"
        aria-controls="site-navigation"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <nav class="site-navigation" id="site-navigation" aria-label="Main navigation" hidden>
        <p class="nav-label">Navigate</p>
        <a href="#weekly" data-view="weekly">Weekly plan</a>
        <a href="#routines" data-view="routines">All routines</a>
        <a href="#exercises" data-view="exercises">Exercise library</a>
        <a href="#trackers" data-view="trackers">Trackers</a>
        <a href="#history" data-view="history">History</a>
        <a href="#active" data-view="active" data-active-workout-link>Active routine</a>
      </nav>
      <div class="free-timer-slot"></div>
    </header>
    <div class="menu-scrim" hidden></div>
    <main id="main-content" tabindex="-1"></main>
  `;

  const menuButton = app.querySelector(".menu-button");
  const navigation = app.querySelector(".site-navigation");
  const scrim = app.querySelector(".menu-scrim");
  const main = app.querySelector("main");
  const timerSlot = app.querySelector(".free-timer-slot");

  function renderTimerBar() {
    timerSlot.innerHTML = renderFreeTimer(dynamicState.freeTimer, Date.now(), timerPanelOpen);
  }

  function syncScrim() {
    scrim.hidden = navigation.hidden && !timerPanelOpen;
    document.body.classList.toggle("menu-open", !scrim.hidden);
  }

  function closeTimerPanel({ restoreFocus = false } = {}) {
    if (!timerPanelOpen) return;
    timerPanelOpen = false;
    renderTimerBar();
    syncScrim();
    if (restoreFocus) timerSlot.querySelector(".timer-button").focus();
  }

  function closeMenu({ restoreFocus = false } = {}) {
    navigation.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    syncScrim();
    if (restoreFocus) menuButton.focus();
  }

  function openMenu() {
    closeTimerPanel();
    navigation.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation");
    syncScrim();
    navigation.querySelector("a").focus();
  }

  function openTimerPanel() {
    closeMenu();
    timerPanelOpen = true;
    renderTimerBar();
    syncScrim();
    timerSlot.querySelector(".free-timer-panel button").focus();
  }

  function renderView({ focus = false } = {}) {
    let view = currentView();
    if (view === "active" && !dynamicState.activeWorkout && !completionSummary) view = "weekly";
    if (view === "routines") {
      main.innerHTML = renderRoutines(data, exerciseById);
    } else if (view === "exercises") {
      main.innerHTML = renderExercises(data, selectedBodyParts);
    } else if (view === "trackers") {
      main.innerHTML = renderTrackers(dynamicState, Date.now());
    } else if (view === "history") {
      main.innerHTML = renderHistory(dynamicState.workoutHistory);
    } else if (view === "active" && dynamicState.activeWorkout) {
      const routine = routineById.get(dynamicState.activeWorkout.routineId);
      main.innerHTML = renderActiveWorkout(dynamicState.activeWorkout, routine, exerciseById, Date.now());
    } else if (view === "active" && completionSummary) {
      main.innerHTML = renderCompletion(completionSummary);
    } else {
      main.innerHTML = renderWeekly(data, routineById, exerciseById, expandedDay);
    }

    const activeLink = app.querySelector("[data-active-workout-link]");
    activeLink.hidden = !dynamicState.activeWorkout && !completionSummary;

    app.querySelectorAll("[data-view]").forEach((link) => {
      if (link.dataset.view === view) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    closeMenu();
    if (focus) main.focus();
  }

  menuButton.addEventListener("click", () => {
    if (menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu({ restoreFocus: true });
    } else {
      openMenu();
    }
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.matches("a")) closeMenu();
  });
  scrim.addEventListener("click", () => {
    closeTimerPanel({ restoreFocus: true });
    closeMenu({ restoreFocus: true });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (timerPanelOpen) closeTimerPanel({ restoreFocus: true });
    if (menuButton.getAttribute("aria-expanded") === "true") closeMenu({ restoreFocus: true });
  });
  window.addEventListener("hashchange", () => renderView({ focus: true }));
  timerSlot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-timer-action]");
    if (!button) return;

    if (button.dataset.timerAction === "toggle-panel") {
      if (timerPanelOpen) {
        closeTimerPanel({ restoreFocus: true });
      } else {
        openTimerPanel();
      }
      return;
    }

    const now = Date.now();
    const timer = dynamicState.freeTimer ?? createFreeTimer("stopwatch");
    const action = button.dataset.timerAction;
    let next = timer;

    if (action === "mode") next = createFreeTimer(button.dataset.timerMode, timer.durationMs);
    if (action === "preset") {
      next = createFreeTimer("countdown", Number(button.dataset.timerSeconds) * 1000);
    }
    if (action === "custom") {
      const seconds = Number(timerSlot.querySelector('[data-timer-input="seconds"]').value);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      next = createFreeTimer("countdown", seconds * 1000);
    }
    if (action === "start") next = startFreeTimer(timer, now);
    if (action === "pause") next = pauseFreeTimer(timer, now);
    if (action === "reset") next = resetFreeTimer(timer);

    dynamicState = { ...dynamicState, freeTimer: next };
    persist();
    renderTimerBar();
  });
  main.addEventListener("click", (event) => {
    const filterChip = event.target.closest("[data-filter-body-part]");
    if (filterChip) {
      const part = filterChip.dataset.filterBodyPart;
      if (part === "") {
        selectedBodyParts.clear();
      } else if (selectedBodyParts.has(part)) {
        selectedBodyParts.delete(part);
      } else {
        selectedBodyParts.add(part);
      }
      renderView();
      main.querySelector(`[data-filter-body-part="${CSS.escape(part)}"]`)?.focus();
      return;
    }

    const trackerButton = event.target.closest("[data-tracker-action]");
    if (trackerButton) {
      const action = trackerButton.dataset.trackerAction;
      const field = trackerButton.dataset.trackerField;
      const dateKey = todayKey(Date.now());
      let dailyTotals = dynamicState.dailyTotals;

      if (action === "add") {
        dailyTotals = addTrackerAmount(dailyTotals, dateKey, field, Number(trackerButton.dataset.trackerAmount));
      }
      if (action === "add-custom") {
        const input = main.querySelector(`[data-tracker-input="${field}"]`);
        const amount = Number(input.value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        dailyTotals = addTrackerAmount(dailyTotals, dateKey, field, amount);
      }
      if (action === "reset") {
        if (!window.confirm("Clear today's calorie and water totals?")) return;
        dailyTotals = clearTrackerDay(dailyTotals, dateKey);
      }

      dynamicState = { ...dynamicState, dailyTotals: pruneTrackerLog(dailyTotals, dateKey) };
      persist();
      renderView();
      return;
    }

    const deleteButton = event.target.closest("[data-delete-history]");
    if (deleteButton) {
      const id = deleteButton.dataset.deleteHistory;
      const record = dynamicState.workoutHistory.find((item) => item.id === id);
      if (!record) return;
      if (
        !window.confirm(
          `Delete the ${record.routineName} session from ${formatCompletedAt(record.completedAt)}?`,
        )
      ) {
        return;
      }
      dynamicState = {
        ...dynamicState,
        workoutHistory: removeHistoryRecord(dynamicState.workoutHistory, id),
      };
      persist();
      renderView({ focus: true });
      return;
    }

    const expandButton = event.target.closest("[data-expand-day]");
    if (expandButton) {
      const day = expandButton.dataset.expandDay;
      expandedDay = expandedDay === day ? null : day;
      renderView();
      const reopened = main.querySelector(`[data-expand-day="${day}"]`);
      if (reopened) reopened.focus();
      return;
    }

    const startButton = event.target.closest("[data-start-routine]");
    if (startButton) {
      const routine = routineById.get(startButton.dataset.startRoutine);
      if (dynamicState.activeWorkout?.routineId === routine.id) {
        window.location.hash = "active";
        if (currentView() === "active") renderView({ focus: true });
        return;
      }
      if (
        dynamicState.activeWorkout &&
        !window.confirm("Replace the active routine and discard its unfinished progress?")
      ) {
        return;
      }
      dynamicState = {
        ...dynamicState,
        activeWorkout: createWorkout(routine, Date.now(), data.defaults.activeWorkout),
      };
      completionSummary = null;
      persist();
      window.location.hash = "active";
      if (currentView() === "active") renderView({ focus: true });
      return;
    }

    const actionButton = event.target.closest("[data-workout-action]");
    if (!actionButton || !dynamicState.activeWorkout) return;

    const now = Date.now();
    const workout = advanceWorkout(dynamicState.activeWorkout, now);
    const routine = routineById.get(workout.routineId);
    const action = actionButton.dataset.workoutAction;
    let result = { workout, completion: null };

    if (action === "complete-set") {
      const input = main.querySelector('[data-workout-input="weight"]');
      const weight = input && input.value !== "" ? Number(input.value) : null;
      result = completeSet(workout, routine, now, weight);
    }
    if (action === "skip-set") result = skipSet(workout, routine, now);
    if (action === "skip-exercise") result = skipExercise(workout, routine, now);
    if (action === "skip-rest") result = skipRest(workout);
    if (action === "rest-minus") result = adjustRest(workout, now, -15_000);
    if (action === "rest-plus") result = adjustRest(workout, now, 15_000);
    if (action === "pause") result.workout = pauseWorkout(workout, now);
    if (action === "resume") result.workout = resumeWorkout(workout, now);
    if (action === "end") {
      if (!window.confirm("End this routine and clear its active progress?")) return;
      result = { workout: null, completion: endWorkout(workout, routine, now) };
    }

    if (result.completion) {
      const record = createHistoryRecord(result.completion, routine, exerciseById);
      dynamicState = {
        ...dynamicState,
        activeWorkout: null,
        workoutHistory: appendHistoryRecord(dynamicState.workoutHistory, record),
      };
      completionSummary = record;
    } else {
      dynamicState = { ...dynamicState, activeWorkout: result.workout };
      completionSummary = null;
    }
    persist();
    renderView({ focus: result.completion !== null });
  });
  main.addEventListener(
    "error",
    (event) => {
      if (!event.target.matches(".exercise-image")) return;
      event.target.closest(".exercise-media").innerHTML = renderNoMedia();
    },
    true,
  );

  renderView();
  renderTimerBar();

  function updateFreeTimer() {
    const timer = dynamicState.freeTimer;
    if (!timer || timer.startedAt === null) return;

    const now = Date.now();
    const text = formatDuration(freeTimerValueMs(timer, now));
    timerSlot.querySelectorAll('[data-timer="free"], [data-timer="free-panel"]').forEach((value) => {
      if (value.textContent !== text) value.textContent = text;
    });

    const bar = timerSlot.querySelector(".free-timer");
    const finished = freeTimerFinished(timer, now);
    if (bar && bar.classList.contains("finished") !== finished) renderTimerBar();
  }

  function updateWorkoutTimers() {
    if (currentView() !== "active" || !dynamicState.activeWorkout) return;
    const now = Date.now();
    const advanced = advanceWorkout(dynamicState.activeWorkout, now);
    if (advanced !== dynamicState.activeWorkout) {
      dynamicState = { ...dynamicState, activeWorkout: advanced };
      persist();
      renderView();
      return;
    }

    const times = workoutTimes(dynamicState.activeWorkout, now);
    const exerciseTimer = main.querySelector('[data-timer="exercise"]');
    const routineTimer = main.querySelector('[data-timer="routine"]');
    const restTimer = main.querySelector('[data-timer="rest"]');
    const exerciseText = formatDuration(times.exerciseMs);
    const routineText = formatDuration(times.routineMs);
    const restText = String(Math.ceil(restRemainingMs(dynamicState.activeWorkout, now) / 1000));
    if (exerciseTimer && exerciseTimer.textContent !== exerciseText) {
      exerciseTimer.textContent = exerciseText;
    }
    if (routineTimer && routineTimer.textContent !== routineText) {
      routineTimer.textContent = routineText;
    }
    if (restTimer && restTimer.textContent !== restText) restTimer.textContent = restText;
  }

  function updateTimers() {
    updateFreeTimer();
    updateWorkoutTimers();
  }

  window.setInterval(updateTimers, 250);
  document.addEventListener("visibilitychange", updateTimers);
}

function renderError() {
  app.innerHTML = `
    <main class="error-state">
      <p class="eyebrow">Unable to load</p>
      <h1>The workout plan is unavailable.</h1>
      <p>Check the deployed data and refresh the page.</p>
      <button type="button">Try again</button>
    </main>
  `;
  app.querySelector("button").addEventListener("click", () => window.location.reload());
}

loadData().then(renderShell).catch((error) => {
  console.error(error);
  renderError();
});
