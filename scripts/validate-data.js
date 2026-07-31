import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateData } from "../src/data.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = ["exercises", "routines", "schedule", "defaults"];

async function readJson(name) {
  const path = resolve(projectRoot, "public", "data", `${name}.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

const [exercises, routines, schedule, defaults] = await Promise.all(names.map(readJson));
validateData({ exercises, routines, schedule, defaults });
console.log("Workout data is valid.");
