import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  getDatabase,
  initDatabase,
  openDatabase,
  type Db,
} from "../../src/main/db/index.js";
import {
  addProject,
  getProject,
  getProjectByPath,
  listProjects,
  normalizeProjectPath,
  projectNameFor,
  removeProject,
  touchProject,
} from "../../src/main/services/projects.js";
import { getSetting, setSetting } from "../../src/main/services/settings.js";

let dir: string;
let db: Db;

/** A real folder on disk — the service resolves and stats every path it takes. */
function folder(name: string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "amos-projects-")));
  db = openDatabase(path.join(dir, "amos.db"));
});

afterEach(() => {
  db.close();
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("normalizeProjectPath", () => {
  it("resolves relative paths and symlinks", () => {
    const target = folder("real");
    const link = path.join(dir, "link");
    fs.symlinkSync(target, link);
    expect(normalizeProjectPath(link)).toBe(target);
    expect(normalizeProjectPath(`${target}/.`)).toBe(target);
  });

  it("rejects a missing folder", () => {
    expect(() => normalizeProjectPath(path.join(dir, "nope"))).toThrow(/does not exist/);
  });

  it("rejects a file", () => {
    const file = path.join(dir, "a-file.txt");
    fs.writeFileSync(file, "x");
    expect(() => normalizeProjectPath(file)).toThrow(/not a folder/);
  });

  it("rejects an empty path", () => {
    expect(() => normalizeProjectPath("   ")).toThrow(/required/);
  });
});

describe("projectNameFor", () => {
  it("uses the folder basename", () => {
    expect(projectNameFor("/home/user/amos")).toBe("amos");
  });
  it("falls back to the path itself for a root", () => {
    expect(projectNameFor("/")).toBe("/");
  });
});

describe("projects service", () => {
  it("adds a project with a uuid, a basename and timestamps", () => {
    const p = addProject({ path: folder("alpha") }, db);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.name).toBe("alpha");
    expect(p.path).toBe(path.join(dir, "alpha"));
    expect(p.createdAt).toBe(p.lastOpenedAt);
    expect(new Date(p.createdAt).toISOString()).toBe(p.createdAt);
  });

  it("is idempotent on the same folder — re-adding touches instead of duplicating", async () => {
    const first = addProject({ path: folder("alpha") }, db);
    await new Promise((r) => setTimeout(r, 5));
    const again = addProject({ path: path.join(dir, "alpha", ".") }, db);

    expect(again.id).toBe(first.id);
    expect(listProjects(db)).toHaveLength(1);
    expect(new Date(again.lastOpenedAt!).getTime()).toBeGreaterThan(
      new Date(first.lastOpenedAt!).getTime(),
    );
  });

  it("refuses a folder that does not exist", () => {
    expect(() => addProject({ path: path.join(dir, "ghost") }, db)).toThrow(/does not exist/);
    expect(listProjects(db)).toEqual([]);
  });

  it("lists the most recently opened project first", async () => {
    const a = addProject({ path: folder("alpha") }, db);
    await new Promise((r) => setTimeout(r, 5));
    const b = addProject({ path: folder("beta") }, db);
    expect(listProjects(db).map((p) => p.id)).toEqual([b.id, a.id]);

    await new Promise((r) => setTimeout(r, 5));
    touchProject(a.id, db);
    expect(listProjects(db).map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it("looks projects up by id and by path", () => {
    const p = addProject({ path: folder("alpha") }, db);
    expect(getProject(p.id, db)).toEqual(p);
    expect(getProjectByPath(p.path, db)?.id).toBe(p.id);
    expect(getProject("nope", db)).toBeNull();
    expect(getProjectByPath("/nope", db)).toBeNull();
  });

  it("removes a project without touching the folder", () => {
    const p = addProject({ path: folder("alpha") }, db);
    expect(removeProject(p.id, db)).toEqual({ ok: true });
    expect(listProjects(db)).toEqual([]);
    expect(fs.existsSync(p.path)).toBe(true);
    // removing an unknown id is a no-op, not an error
    expect(removeProject("ghost", db)).toEqual({ ok: true });
  });

  it("refuses to touch an unknown project", () => {
    expect(() => touchProject("ghost", db)).toThrow(/Unknown project/);
  });

  it("survives a restart of the process", () => {
    const file = path.join(dir, "restart.db");
    const first = openDatabase(file);
    const p = addProject({ path: folder("alpha") }, first);
    first.close();

    const second = openDatabase(file);
    expect(listProjects(second).map((x) => x.id)).toEqual([p.id]);
    second.close();
  });
});

describe("settings service", () => {
  it("reads a missing key as null, then round-trips a value", () => {
    expect(getSetting("language", db)).toEqual({ key: "language", value: null });
    expect(setSetting("language", "fr", db)).toEqual({ key: "language", value: "fr" });
    expect(getSetting("language", db).value).toBe("fr");
    setSetting("language", "en", db);
    expect(getSetting("language", db).value).toBe("en");
  });
});

describe("process-wide database handle", () => {
  it("throws before init, then serves the singleton", () => {
    closeDatabase();
    expect(() => getDatabase()).toThrow(/not initialised/);
    initDatabase(path.join(dir, "singleton.db"));
    const p = addProject({ path: folder("alpha") });
    expect(listProjects()).toEqual([p]);
    closeDatabase();
    expect(() => getDatabase()).toThrow(/not initialised/);
  });
});
