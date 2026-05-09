import {
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { KeyConfig } from "./types";

const STORAGE_KEY = "keyviewer-config";
const OVERLAY_STATE_KEY = "keyviewer-overlay-state";

const defaultKeyConfig = (id: string, label: string): KeyConfig => ({
  id,
  label,
  x: 50,
  y: 50,
  width: 64,
  height: 64,
  outlineWidth: 2,
  outlineColor: "#00e5ff",
  bgColor: "rgba(15, 15, 15, 0.85)",
  pressedOutlineColor: "#00e5ff",
  pressedBgColor: "rgba(0, 229, 255, 0.35)",
  rounded: 10,
  fontSize: 20,
  fontColor: "#ffffff",
  pressedFontColor: "#ffffff",
  rainDirection: "up",
  rainWidth: 0,
  rainColor: "#00e5ff",
  rainSpeed: 0.15,
  rainMaxHeight: 400,
});

function loadConfig(): KeyConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const keyArray = parsed.keys || parsed;
      return keyArray.map((k: Partial<KeyConfig>) => ({
        ...defaultKeyConfig(k.id || "Key", k.label || "Key"),
        ...k,
      }));
    }
  } catch {}
  return [];
}

function saveConfig(keys: KeyConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys }));
}

function loadOverlayState() {
  try {
    const raw = localStorage.getItem(OVERLAY_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveOverlayState(state: { x: number; y: number; width: number; height: number }) {
  localStorage.setItem(OVERLAY_STATE_KEY, JSON.stringify(state));
}

function ColorField(props: {
  label: string;
  value: string | undefined;
  onInput: (v: string) => void;
}) {
  const safeValue = () => props.value || "#ffffff";
  return (
    <div class="field color-field">
      <label>{props.label}</label>
      <div class="color-row">
        <input
          type="color"
          value={safeValue().startsWith("#") ? safeValue() : "#00e5ff"}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
        <input
          type="text"
          class="color-text"
          value={safeValue()}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onInput: (v: number) => void;
}) {
  return (
    <div class="field">
      <label>{props.label}</label>
      <input
        type="number"
        min={props.min ?? 0}
        max={props.max ?? 9999}
        step={props.step ?? 1}
        value={props.value}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))}
      />
    </div>
  );
}

function DraggableKey(props: {
  config: KeyConfig;
  selected: boolean;
  onSelect: (e: MouseEvent) => void;
  onDragEnd: (dx: number, dy: number) => void;
}) {
  let el!: HTMLDivElement;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    el.setPointerCapture(e.pointerId);
    props.onSelect(e as unknown as MouseEvent);
  };

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const SNAP = 8;
    const rawX = Math.max(0, props.config.x + dx);
    const rawY = Math.max(0, props.config.y + dy);
    const nx = Math.round(rawX / SNAP) * SNAP;
    const ny = Math.round(rawY / SNAP) * SNAP;
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  };

  const onPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    const dx = parseInt(el.style.left, 10) - props.config.x;
    const dy = parseInt(el.style.top, 10) - props.config.y;
    el.style.left = `${props.config.x}px`;
    el.style.top = `${props.config.y}px`;
    props.onDragEnd(dx, dy);
  };

  return (
    <div
      ref={el}
      class="preview-key"
      classList={{ selected: props.selected }}
      style={{
        left: `${props.config.x}px`,
        top: `${props.config.y}px`,
        width: `${props.config.width}px`,
        height: `${props.config.height}px`,
        "outline-width": `${props.config.outlineWidth}px`,
        "outline-color": props.selected ? props.config.pressedOutlineColor : props.config.outlineColor,
        "outline-style": "solid",
        "background-color": props.selected ? props.config.pressedBgColor : props.config.bgColor,
        "border-radius": `${props.config.rounded}px`,
        "font-size": `${props.config.fontSize}px`,
        color: props.selected ? props.config.pressedFontColor : props.config.fontColor,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {props.config.label}
    </div>
  );
}

export default function Config() {
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set());
  const [lastSelectedIdx, setLastSelectedIdx] = createSignal<number | null>(null);
  const [overlayActive, setOverlayActive] = createSignal(false);
  const [clickThrough, setClickThrough] = createSignal(
    localStorage.getItem("keyviewer-clickthrough") !== "false"
  );
  const [isCapturing, setIsCapturing] = createSignal(false);
  const [addId, setAddId] = createSignal("");
  const [addLabel, setAddLabel] = createSignal("");
  const [isCapturingExisting, setIsCapturingExisting] = createSignal(false);

  createEffect(() => {
    saveConfig(keys());
  });

  onMount(() => {
    let unlisten: () => void;
    listen<{ key: string; event_type: string }>("global-key-event", (event) => {
      if (event.payload.event_type === "keydown") {
        if (isCapturing() || isCapturingExisting()) {
          const keyId = event.payload.key;
          let label = keyId.replace(/^Key([A-Z])$/, "$1").replace(/^Num(\d)$/, "$1").replace(/^Kp(\d)$/, "$1");
          const isMac = navigator.userAgent.toLowerCase().includes("mac");

          if (label === "Return" || label === "KpReturn") label = "Enter";
          if (label === "Space") label = "␣";
          if (label.startsWith("Control")) label = "Ctrl";
          if (label.startsWith("Shift")) label = "Shift";
          if (label.startsWith("Alt")) label = isMac && label.includes("Gr") ? "Option" : "Alt";
          if (label.startsWith("Meta")) label = isMac ? "Cmd" : "Win";
          if (label === "UpArrow") label = "↑";
          if (label === "DownArrow") label = "↓";
          if (label === "LeftArrow") label = "←";
          if (label === "RightArrow") label = "→";
          if (label === "Escape") label = "Esc";
          if (label === "Backspace") label = "⌫";
          if (label === "Tab") label = "⇥";
          if (label === "Delete") label = "Del";
          if (label === "Minus" || label === "KpMinus") label = "-";
          if (label === "Equal" || label === "KpPlus") label = "=";
          if (label === "Comma") label = ",";
          if (label === "Dot") label = ".";
          if (label === "Slash" || label === "KpDivide") label = "/";
          if (label === "BackSlash") label = "\\";
          if (label === "SemiColon") label = ";";
          if (label === "Quote") label = "'";
          if (label === "BackQuote") label = "`";
          if (label === "LeftBracket") label = "[";
          if (label === "RightBracket") label = "]";
          if (label === "CapsLock") label = "Caps";
          if (label === "PrintScreen") label = "PrtSc";

          if (isCapturing()) {
            setAddId(keyId);
            setAddLabel(label);
            setIsCapturing(false);
          } else if (isCapturingExisting()) {
            const firstSelected = Array.from(selectedIndices())[0];
            if (firstSelected !== undefined) {
              updateKey(firstSelected, { id: keyId, label });
            }
            setIsCapturingExisting(false);
          }
        }
      }
    }).then((f) => (unlisten = f));

    onCleanup(() => {
      if (unlisten) unlisten();
    });
  });

  function updateKey(idx: number, patch: Partial<KeyConfig>) {
    setKeys((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function updateSelectedKeys(patch: Partial<KeyConfig>) {
    setKeys((prev) => {
      const next = [...prev];
      for (const idx of selectedIndices()) {
        next[idx] = { ...next[idx], ...patch };
      }
      return next;
    });
  }

  function addKey() {
    const id = addId().trim();
    const label = addLabel().trim() || id;
    if (!id) return;
    setKeys((prev) => [...prev, defaultKeyConfig(id, label)]);
    setAddId("");
    setAddLabel("");
    setSelectedIndices(new Set([keys().length]));
    setLastSelectedIdx(keys().length);
  }

  function removeKey(idx: number) {
    setKeys((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIndices((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
    setLastSelectedIdx((prev) => {
      if (prev === idx) return null;
      if (prev !== null && prev > idx) return prev - 1;
      return prev;
    });
  }

  function removeSelectedKeys() {
    const selected = selectedIndices();
    if (selected.size === 0) return;
    setKeys((prev) => prev.filter((_, i) => !selected.has(i)));
    setSelectedIndices(new Set());
    setLastSelectedIdx(null);
  }

  function duplicateKey(idx: number) {
    const k = keys()[idx];
    setKeys((prev) => [
      ...prev,
      { ...k, x: k.x + 20, y: k.y + 20 },
    ]);
    const newIdx = keys().length;
    setSelectedIndices(new Set([newIdx]));
    setLastSelectedIdx(newIdx);
  }

  function handleSelect(idx: number, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setSelectedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
      setLastSelectedIdx(idx);
    } else if (e.shiftKey && lastSelectedIdx() !== null) {
      const start = Math.min(lastSelectedIdx()!, idx);
      const end = Math.max(lastSelectedIdx()!, idx);
      const range = new Set<number>();
      for (let i = start; i <= end; i++) range.add(i);
      setSelectedIndices(range);
    } else {
      setSelectedIndices(new Set([idx]));
      setLastSelectedIdx(idx);
    }
  }

  function handleDragEnd(idx: number, dx: number, dy: number) {
    const selected = selectedIndices();
    if (selected.has(idx) && selected.size > 1) {
      setKeys((prev) => {
        const next = [...prev];
        for (const i of selected) {
          const SNAP = 8;
          const nx = Math.round((next[i].x + dx) / SNAP) * SNAP;
          const ny = Math.round((next[i].y + dy) / SNAP) * SNAP;
          next[i] = { ...next[i], x: Math.max(0, nx), y: Math.max(0, ny) };
        }
        return next;
      });
    } else {
      updateKey(idx, { x: Math.max(0, keys()[idx].x + dx), y: Math.max(0, keys()[idx].y + dy) });
    }
  }

  async function toggleOverlay() {
    const next = !overlayActive();
    if (!next) {
      try {
        const pos = await invoke<Option<[number, number]>>("get_overlay_position");
        const size = await invoke<Option<[number, number]>>("get_overlay_size");
        if (pos && size) {
          saveOverlayState({ x: pos[0], y: pos[1], width: size[0], height: size[1] });
        }
      } catch (err) {
        console.error("Failed to save overlay state:", err);
      }
    }
    setOverlayActive(next);
    try {
      const state = loadOverlayState();
      await invoke("toggle_overlay", {
        active: next,
        x: state?.x,
        y: state?.y,
        width: state?.width,
        height: state?.height,
      });
    } catch (err) {
      console.error("toggle_overlay invoke failed:", err);
    }
  }

  async function toggleClickThrough() {
    const next = !clickThrough();
    setClickThrough(next);
    localStorage.setItem("keyviewer-clickthrough", String(next));
    try {
      await invoke("set_ignore_cursor_events", { ignore: next });
    } catch (err) {
      console.error("set_ignore_cursor_events failed:", err);
    }
  }

  const selectedKeys = () => {
    const selected = selectedIndices();
    if (selected.size === 0) return null;
    const firstIdx = Array.from(selected)[0];
    return keys()[firstIdx];
  };

  const hasSelection = () => selectedIndices().size > 0;
  const selectionCount = () => selectedIndices().size;

  return (
    <div class="config-root">
      <header class="config-header">
        <div class="header-left">
          <span class="logo-mark">⌨</span>
          <h1>KeyViewer</h1>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            class="btn-overlay"
            classList={{ active: clickThrough() }}
            onClick={toggleClickThrough}
          >
            <span class="pulse-dot" />
            {clickThrough() ? "Click-Through ON" : "Click-Through OFF"}
          </button>

          <button
            class="btn-overlay"
            classList={{ active: overlayActive() }}
            onClick={toggleOverlay}
          >
            <span class="pulse-dot" />
            {overlayActive() ? "Overlay ON" : "Overlay OFF"}
          </button>
        </div>
      </header>

      <div class="config-body">
        <aside class="sidebar">
          <div class="sidebar-header">
            <h2>Keys</h2>
            <span class="key-count">{keys().length}</span>
          </div>

          <div class="key-list">
            <For each={keys()}>
              {(k, i) => (
                <div
                  class="key-item"
                  classList={{ selected: selectedIndices().has(i()) }}
                  onClick={(e) => handleSelect(i(), e)}
                >
                  <span class="key-item-label">{k.label}</span>
                  <span class="key-item-id">{k.id}</span>
                  <div class="key-item-actions">
                    <button
                      class="btn-icon"
                      title="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateKey(i());
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      class="btn-icon danger"
                      title="Remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeKey(i());
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="add-key-form">
            <button
              class="btn-capture"
              classList={{ active: isCapturing() }}
              onClick={() => setIsCapturing(!isCapturing())}
            >
              {isCapturing() ? "Press any key to capture..." : "Auto Capture Key"}
            </button>
            <input
              type="text"
              placeholder="Key ID (e.g. KeyW)"
              value={addId()}
              onInput={(e) => setAddId(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addKey()}
            />
            <input
              type="text"
              placeholder="Label (e.g. W)"
              value={addLabel()}
              onInput={(e) => setAddLabel(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addKey()}
            />
            <button class="btn-add" onClick={addKey}>
              + Add Key
            </button>
          </div>
        </aside>

        <section class="preview-area">
          <div class="preview-label">
            Preview — drag keys to position (Ctrl/Cmd+click multi-select, Shift+click range)
          </div>
          <div class="preview-scroll-container">
            <div class="preview-canvas">
              <For each={keys()}>
                {(k, i) => (
                  <DraggableKey
                    config={k}
                    selected={selectedIndices().has(i())}
                    onSelect={(e) => handleSelect(i(), e)}
                    onDragEnd={(dx, dy) => handleDragEnd(i(), dx, dy)}
                  />
                )}
              </For>
              <Show when={keys().length === 0}>
                <div class="empty-hint">Add a key to get started</div>
              </Show>
            </div>
          </div>
        </section>

        <aside class="props-panel">
          <Show
            when={hasSelection()}
            fallback={<div class="props-empty">Select a key to edit</div>}
          >
            {(sel) => {
              const isMulti = selectionCount() > 1;
              return (
                <div class="props-content">
                  <h2>
                    {isMulti ? `${selectionCount()} keys selected` : "Properties"}
                  </h2>

                  <Show when={!isMulti}>
                    <button
                      class="btn-capture"
                      classList={{ active: isCapturingExisting() }}
                      onClick={() => setIsCapturingExisting(!isCapturingExisting())}
                      style={{ "margin-bottom": "8px" }}
                    >
                      {isCapturingExisting() ? "Press any key..." : "Capture New Key"}
                    </button>

                    <div class="field">
                      <label>Key ID</label>
                      <input
                        type="text"
                        value={sel().id}
                        onInput={(e) =>
                          updateKey(Array.from(selectedIndices())[0], { id: e.currentTarget.value })
                        }
                      />
                    </div>

                    <div class="field">
                      <label>Label</label>
                      <input
                        type="text"
                        value={sel().label}
                        onInput={(e) =>
                          updateKey(Array.from(selectedIndices())[0], {
                            label: e.currentTarget.value,
                          })
                        }
                      />
                    </div>
                  </Show>

                  <div class="field-row">
                    <NumberField
                      label="X"
                      value={sel().x}
                      onInput={(v) => updateSelectedKeys({ x: v })}
                    />
                    <NumberField
                      label="Y"
                      value={sel().y}
                      onInput={(v) => updateSelectedKeys({ y: v })}
                    />
                  </div>

                  <div class="field-row">
                    <NumberField
                      label="Width"
                      value={sel().width}
                      min={16}
                      onInput={(v) => updateSelectedKeys({ width: v })}
                    />
                    <NumberField
                      label="Height"
                      value={sel().height}
                      min={16}
                      onInput={(v) => updateSelectedKeys({ height: v })}
                    />
                  </div>

                  <div class="field-row">
                    <NumberField
                      label="Outline"
                      value={sel().outlineWidth}
                      min={0}
                      max={20}
                      onInput={(v) => updateSelectedKeys({ outlineWidth: v })}
                    />
                    <NumberField
                      label="Rounded"
                      value={sel().rounded}
                      min={0}
                      max={100}
                      onInput={(v) => updateSelectedKeys({ rounded: v })}
                    />
                  </div>

                  <NumberField
                    label="Font Size"
                    value={sel().fontSize}
                    min={8}
                    max={72}
                    onInput={(v) => updateSelectedKeys({ fontSize: v })}
                  />

                  <ColorField
                    label="Outline Color"
                    value={sel().outlineColor}
                    onInput={(v) => updateSelectedKeys({ outlineColor: v })}
                  />

                  <ColorField
                    label="Pressed Outline"
                    value={sel().pressedOutlineColor}
                    onInput={(v) => updateSelectedKeys({ pressedOutlineColor: v })}
                  />

                  <ColorField
                    label="Background"
                    value={sel().bgColor}
                    onInput={(v) => updateSelectedKeys({ bgColor: v })}
                  />

                  <ColorField
                    label="Pressed BG"
                    value={sel().pressedBgColor}
                    onInput={(v) => updateSelectedKeys({ pressedBgColor: v })}
                  />

                  <ColorField
                    label="Font Color"
                    value={sel().fontColor}
                    onInput={(v) => updateSelectedKeys({ fontColor: v })}
                  />

                  <ColorField
                    label="Pressed Font Color"
                    value={sel().pressedFontColor}
                    onInput={(v) => updateSelectedKeys({ pressedFontColor: v })}
                  />

                  <h2 style={{ "margin-top": "16px" }}>Hold Note (Rain)</h2>

                  <div class="field">
                    <label>Direction</label>
                    <select
                      value={sel().rainDirection}
                      onChange={(e) => updateSelectedKeys({ rainDirection: e.currentTarget.value as KeyConfig["rainDirection"] })}
                    >
                      <option value="up">Up</option>
                      <option value="down">Down</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </div>

                  <div class="field-row">
                    <NumberField
                      label="Width"
                      value={sel().rainWidth}
                      min={0}
                      onInput={(v) => updateSelectedKeys({ rainWidth: v })}
                    />
                    <NumberField
                      label="Speed"
                      value={sel().rainSpeed}
                      min={0.01}
                      max={10}
                      step={0.01}
                      onInput={(v) => updateSelectedKeys({ rainSpeed: v })}
                    />
                  </div>

                  <NumberField
                    label="Max Length"
                    value={sel().rainMaxHeight}
                    min={10}
                    max={2000}
                    onInput={(v) => updateSelectedKeys({ rainMaxHeight: v })}
                  />

                  <ColorField
                    label="Color"
                    value={sel().rainColor}
                    onInput={(v) => updateSelectedKeys({ rainColor: v })}
                  />

                  <Show when={isMulti}>
                    <button
                      class="btn-danger"
                      onClick={removeSelectedKeys}
                      style={{ "margin-top": "12px" }}
                    >
                      Delete {selectionCount()} keys
                    </button>
                  </Show>
                </div>
              );
            }}
          </Show>
        </aside>
      </div>
    </div>
  );
}
