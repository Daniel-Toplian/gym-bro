import "./styles.css";
import { DAYS, loadData, parseExerciseMedia } from "./data.js";
import {
  advanceWorkout,
  appendHistoryRecord,
  completeSet,
  createHistoryRecord,
  createWorkout,
  endWorkout,
  loadDynamicState,
  newestHistoryFirst,
  pauseWorkout,
  restRemainingMs,
  resumeWorkout,
  saveDynamicState,
  skipExercise,
  skipSet,
  workoutTimes,
} from "./workout.js";

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

function renderRoutineExercises(routine, exerciseById) {
  return routine.exercises
    .map((entry) => {
      const exercise = exerciseById.get(entry.exerciseId);

      return `
        <li class="exercise-row">
          <span>${escapeHtml(exercise.name)}</span>
          <span class="exercise-meta">${entry.sets} sets · ${formatRest(entry.restSeconds)}</span>
        </li>
      `;
    })
    .join("");
}

function renderWeekly(data, routineById, exerciseById) {
  const workoutCount = DAYS.filter((day) => data.schedule.days[day] !== null).length;

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
              <div class="day-card-heading">
                <h2>${formatDay(day)}</h2>
                <span class="day-status">Rest</span>
              </div>
              <p>Recovery day</p>
            </li>
          `;
        }

        return `
          <li class="day-card routine-day">
            <div class="day-card-heading">
              <h2>${formatDay(day)}</h2>
              <span class="day-status">Workout</span>
            </div>
            <h3>${escapeHtml(routine.name)}</h3>
            <ul class="exercise-list">
              ${renderRoutineExercises(routine, exerciseById)}
            </ul>
            <button class="start-workout-button" type="button" data-start-routine="${escapeHtml(routine.id)}">
              Start routine
            </button>
          </li>
        `;
      }).join("")}
    </ol>
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

function renderExercises(data) {
  return `
    <section class="view-heading" aria-labelledby="exercises-title">
      <p class="eyebrow">Library</p>
      <h1 id="exercises-title">Exercises</h1>
      <p>${data.exercises.length} configured exercise${data.exercises.length === 1 ? "" : "s"}, with guidance where available.</p>
    </section>
    <div class="exercise-grid">
      ${data.exercises
        .map(
          (exercise) => `
            <article class="exercise-card">
              <div class="exercise-card-heading">
                <p class="routine-label">Exercise</p>
                <h2>${escapeHtml(exercise.name)}</h2>
              </div>
              <div class="exercise-media">
                ${renderExerciseMedia(exercise)}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
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
          <div class="set-progress" aria-label="Set progress">
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
                  <span>Rest before set ${workout.setIndex + 1}</span>
                  <strong data-timer="rest">${Math.ceil(restRemainingMs(workout, now) / 1000)}</strong>
                  <small>seconds</small>
                </div>`
              : `<div class="current-set">
                  <span>Current set</span>
                  <strong>${workout.setIndex + 1}<small> / ${routineEntry.sets}</small></strong>
                </div>`
          }

          <div class="workout-actions">
            ${
              resting
                ? ""
                : `<button class="primary-button" type="button" data-workout-action="complete-set" ${paused ? "disabled" : ""}>Complete set</button>
                   <button class="secondary-button" type="button" data-workout-action="skip-set" ${paused ? "disabled" : ""}>Skip set</button>`
            }
            <button class="text-button" type="button" data-workout-action="skip-exercise" ${paused ? "disabled" : ""}>Skip exercise</button>
          </div>
          <p class="workout-result-counts">${completedSets} completed · ${skippedSets} skipped</p>
        </div>

        <div class="exercise-media active-exercise-media">
          ${renderExerciseMedia(exercise)}
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
            <span>${exercise.completedSets} completed · ${exercise.skippedSets} skipped</span>
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
                        <strong>${formatDuration(session.durationMs)}</strong>
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

function currentView() {
  const view = window.location.hash.slice(1);
  return ["weekly", "routines", "exercises", "history", "active"].includes(view)
    ? view
    : "weekly";
}

function renderShell(data) {
  const routineById = new Map(data.routines.map((routine) => [routine.id, routine]));
  const exerciseById = new Map(data.exercises.map((exercise) => [exercise.id, exercise]));
  let dynamicState = loadDynamicState(data.defaults, data.routines);
  let completionSummary = null;

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
        <a href="#history" data-view="history">History</a>
        <a href="#active" data-view="active" data-active-workout-link>Active routine</a>
      </nav>
    </header>
    <div class="menu-scrim" hidden></div>
    <main id="main-content" tabindex="-1"></main>
  `;

  const menuButton = app.querySelector(".menu-button");
  const navigation = app.querySelector(".site-navigation");
  const scrim = app.querySelector(".menu-scrim");
  const main = app.querySelector("main");

  function closeMenu({ restoreFocus = false } = {}) {
    navigation.hidden = true;
    scrim.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    document.body.classList.remove("menu-open");
    if (restoreFocus) menuButton.focus();
  }

  function openMenu() {
    navigation.hidden = false;
    scrim.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation");
    document.body.classList.add("menu-open");
    navigation.querySelector("a").focus();
  }

  function renderView({ focus = false } = {}) {
    let view = currentView();
    if (view === "active" && !dynamicState.activeWorkout && !completionSummary) view = "weekly";
    if (view === "routines") {
      main.innerHTML = renderRoutines(data, exerciseById);
    } else if (view === "exercises") {
      main.innerHTML = renderExercises(data);
    } else if (view === "history") {
      main.innerHTML = renderHistory(dynamicState.workoutHistory);
    } else if (view === "active" && dynamicState.activeWorkout) {
      const routine = routineById.get(dynamicState.activeWorkout.routineId);
      main.innerHTML = renderActiveWorkout(dynamicState.activeWorkout, routine, exerciseById, Date.now());
    } else if (view === "active" && completionSummary) {
      main.innerHTML = renderCompletion(completionSummary);
    } else {
      main.innerHTML = renderWeekly(data, routineById, exerciseById);
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
  scrim.addEventListener("click", () => closeMenu({ restoreFocus: true }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu({ restoreFocus: true });
    }
  });
  window.addEventListener("hashchange", () => renderView({ focus: true }));
  main.addEventListener("click", (event) => {
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

    if (action === "complete-set") result = completeSet(workout, routine, now);
    if (action === "skip-set") result = skipSet(workout, routine, now);
    if (action === "skip-exercise") result = skipExercise(workout, routine, now);
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

  function updateTimers() {
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
