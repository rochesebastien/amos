// @vitest-environment jsdom
//
// The composer is where a prompt acquires everything except its words — the
// folder, the branch, the CLI, the model. Each of those is a promise the UI
// makes about what the next turn will do, so what is asserted here is that the
// controls tell the truth: that they are present when they mean something, and
// absent when the backend has no such knob.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { chatModelSetting } from "@shared/chat";
import type { Project } from "@shared/ipc";
import { ChatComposer } from "@/components/ChatComposer";
import { dict } from "@/lib/dictionaries";
import { installBridge, PROJECTS, renderInApp } from "./helpers";

/** Radix opens a menu on pointerdown, not on click. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

const HEAD = { branch: "main", detachedAt: null };

async function setup(
  props: Partial<React.ComponentProps<typeof ChatComposer>> = {},
  settings = {},
) {
  installBridge({ branches: ["develop", "main"], settings });
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  const onStop = vi.fn();
  const rendered = renderInApp(
    <ChatComposer
      project={PROJECTS[0] as Project}
      projects={PROJECTS}
      head={HEAD}
      backend="claude"
      available={["claude", "codex"]}
      backendLocked={false}
      onBackendChange={vi.fn()}
      value="hello"
      onChange={onChange}
      onSubmit={onSubmit}
      onStop={onStop}
      streaming={false}
      error={null}
      textareaRef={{ current: null }}
      {...props}
    />,
  );
  // The router mounts asynchronously; nothing exists until it has.
  await screen.findByRole("textbox", { name: dict.en["chat.messageLabel"] });
  return { ...rendered, onSubmit, onChange, onStop };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("<ChatComposer /> context strip", () => {
  it("names the folder and the branch the turn will run in", async () => {
    await setup();

    expect(screen.getByText(PROJECTS[0]!.name)).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText(dict.en["composer.local"])).toBeTruthy();
  });

  it("offers the other branches once the picker is opened", async () => {
    await setup();

    openMenu(screen.getByText("main").closest("button")!);

    // Listed lazily: the refs are only read when someone asks to see them.
    expect(await screen.findByRole("menuitem", { name: /develop/ })).toBeTruthy();
  });

  it("shows no branch control outside a git working tree", async () => {
    await setup({ head: null });

    expect(screen.queryByText("main")).toBeNull();
    expect(screen.getByText(PROJECTS[0]!.name)).toBeTruthy();
  });
});

describe("<ChatComposer /> controls", () => {
  it("sends on Enter and leaves Shift+Enter to the newline", async () => {
    const { onSubmit } = await setup();
    const box = screen.getByRole("textbox", { name: dict.en["chat.messageLabel"] });

    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps the send button round and solid, and dead while empty", async () => {
    await setup({ value: "  " });
    const send = screen.getByRole("button", { name: dict.en["chat.send"] });

    expect(send.className).toContain("rounded-full");
    expect(send.className).toContain("bg-foreground");
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("turns into a stop button mid-turn", async () => {
    const { onStop } = await setup({ streaming: true });

    fireEvent.click(screen.getByRole("button", { name: dict.en["chat.stop"] }));

    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: dict.en["chat.send"] })).toBeNull();
  });

  it("remembers the model per backend", async () => {
    const settings: Record<string, string> = {};
    await setup({}, settings);

    openMenu(screen.getByRole("button", { name: dict.en["composer.modelLabel"] }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Opus/ }));

    // Keyed by backend, so switching CLI cannot hand Codex a Claude model id.
    await waitFor(() => {
      expect(settings[chatModelSetting("claude")]).toBe("opus");
    });
  });

  it("hides the effort control for a backend that has no such knob", async () => {
    await setup();

    openMenu(screen.getByRole("button", { name: dict.en["composer.modelLabel"] }));

    // Claude's SDK takes no effort level; showing one would be a lie.
    expect(await screen.findByRole("menuitem", { name: /Opus/ })).toBeTruthy();
    expect(screen.queryByText(dict.en["composer.effortLabel"])).toBeNull();
  });

  it("offers the effort control for Codex, which does take one", async () => {
    await setup({ backend: "codex" });

    openMenu(screen.getByRole("button", { name: dict.en["composer.modelLabel"] }));

    expect(await screen.findByText(dict.en["composer.effortLabel"])).toBeTruthy();
  });

  it("locks the CLI to the one the conversation started on", async () => {
    await setup({ backendLocked: true });

    expect(screen.queryByRole("button", { name: dict.en["chat.backendLabel"] })).toBeNull();
  });
});
