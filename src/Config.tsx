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
});

function loadConfig(): KeyConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<KeyConfig>[];
      return parsed.map((k) => ({
        ...defaultKeyConfig(k.id || "Key", k.label || "Key"),
        ...k,
      }));
    }
  } catch {}
  return [];
}

function saveConfig(keys: KeyConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

// ─── Color Input with text fallback ────────────────────────────────
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

// ─── Number Input ──────────────────────────────────────────────────
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

// ─── Draggable Key Preview ─────────────────────────────────────────
function DraggableKey(props: {
  config: KeyConfig;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
}) {
  let el!: HTMLDivElement;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = props.config.x;
    origY = props.config.y;
    el.setPointerCapture(e.pointerId);
    props.onSelect();
  };

  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    const SNAP = 8;
    const rawX = Math.max(0, origX + dx);
    const rawY = Math.max(0, origY + dy);
    
    const nx = Math.round(rawX / SNAP) * SNAP;
    const ny = Math.round(rawY / SNAP) * SNAP;
    
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  };

  const onPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    const nx = parseInt(el.style.left, 10);
    const ny = parseInt(el.style.top, 10);
    props.onDragEnd(nx, ny);
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

// ─── Main Config Component ─────────────────────────────────────────
export default function Config() {
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [selectedIdx, setSelectedIdx] = createSignal<number | null>(null);
  const [overlayActive, setOverlayActive] = createSignal(false);
  const [clickThrough, setClickThrough] = createSignal(true);
  const [isCapturing, setIsCapturing] = createSignal(false);
  const [addId, setAddId] = createSignal("");
  const [addLabel, setAddLabel] = createSignal("");

  const [isCapturingExisting, setIsCapturingExisting] = createSignal(false);

  // Persist on change
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
          } else if (isCapturingExisting() && selectedIdx() !== null) {
            updateKey(selectedIdx()!, { id: keyId, label });
            setIsCapturingExisting(false);
          }
        }
      }
    }).then((f) => (unlisten = f));

    onCleanup(() => {
      if (unlisten) unlisten();
    });
  });

  const selected = () => {
    const idx = selectedIdx();
    return idx !== null ? keys()[idx] : null;
  };

  function updateKey(idx: number, patch: Partial<KeyConfig>) {
    setKeys((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
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
    setSelectedIdx(keys().length - 1);
  }

  function removeKey(idx: number) {
    setKeys((prev) => prev.filter((_, i) => i !== idx));
    if (selectedIdx() === idx) setSelectedIdx(null);
    else if (selectedIdx() !== null && selectedIdx()! > idx)
      setSelectedIdx(selectedIdx()! - 1);
  }

  function duplicateKey(idx: number) {
    const k = keys()[idx];
    setKeys((prev) => [
      ...prev,
      { ...k, x: k.x + 20, y: k.y + 20 },
    ]);
    setSelectedIdx(keys().length - 1);
  }

  async function toggleOverlay() {
    const next = !overlayActive();
    setOverlayActive(next);
    try {
      await invoke("toggle_overlay", { active: next });
    } catch (err) {
      console.error("toggle_overlay invoke failed:", err);
    }
  }
  
  async function toggleClickThrough() {
    const next = !clickThrough();
    setClickThrough(next);
    try {
      await invoke("set_ignore_cursor_events", { ignore: next });
    } catch (err) {
      console.error("set_ignore_cursor_events failed:", err);
    }
  }

  return (
    <div class="config-root">
      {/* ── Header ─────────────────────────────────────────── */}
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
            title="When active, the overlay ignores mouse clicks (Click-through). Disable to drag."
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
        {/* ── Sidebar: key list ─────────────────────────────── */}
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
                  classList={{ selected: selectedIdx() === i() }}
                  onClick={() => setSelectedIdx(i())}
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

          {/* Add key form */}
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

        {/* ── Preview canvas ────────────────────────────────── */}
        <section class="preview-area">
          <div class="preview-label">
            Preview — drag keys to position
          </div>
          <div class="preview-scroll-container">
            <div class="preview-canvas">
              <For each={keys()}>
                {(k, i) => (
                  <DraggableKey
                    config={k}
                    selected={selectedIdx() === i()}
                    onSelect={() => setSelectedIdx(i())}
                    onDragEnd={(x, y) => updateKey(i(), { x, y })}
                  />
                )}
              </For>
              <Show when={keys().length === 0}>
                <div class="empty-hint">Add a key to get started</div>
              </Show>
            </div>
          </div>
        </section>

        {/* ── Properties panel ──────────────────────────────── */}
        <aside class="props-panel">
          <Show
            when={selected()}
            fallback={<div class="props-empty">Select a key to edit</div>}
          >
            {(sel) => (
              <div class="props-content">
                <h2>Properties</h2>

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
                      updateKey(selectedIdx()!, { id: e.currentTarget.value })
                    }
                  />
                </div>

                <div class="field">
                  <label>Label</label>
                  <input
                    type="text"
                    value={sel().label}
                    onInput={(e) =>
                      updateKey(selectedIdx()!, {
                        label: e.currentTarget.value,
                      })
                    }
                  />
                </div>

                <div class="field-row">
                  <NumberField
                    label="X"
                    value={sel().x}
                    onInput={(v) => updateKey(selectedIdx()!, { x: v })}
                  />
                  <NumberField
                    label="Y"
                    value={sel().y}
                    onInput={(v) => updateKey(selectedIdx()!, { y: v })}
                  />
                </div>

                <div class="field-row">
                  <NumberField
                    label="Width"
                    value={sel().width}
                    min={16}
                    onInput={(v) => updateKey(selectedIdx()!, { width: v })}
                  />
                  <NumberField
                    label="Height"
                    value={sel().height}
                    min={16}
                    onInput={(v) => updateKey(selectedIdx()!, { height: v })}
                  />
                </div>

                <div class="field-row">
                  <NumberField
                    label="Outline"
                    value={sel().outlineWidth}
                    min={0}
                    max={20}
                    onInput={(v) =>
                      updateKey(selectedIdx()!, { outlineWidth: v })
                    }
                  />
                  <NumberField
                    label="Rounded"
                    value={sel().rounded}
                    min={0}
                    max={100}
                    onInput={(v) => updateKey(selectedIdx()!, { rounded: v })}
                  />
                </div>

                <NumberField
                  label="Font Size"
                  value={sel().fontSize}
                  min={8}
                  max={72}
                  onInput={(v) => updateKey(selectedIdx()!, { fontSize: v })}
                />

                <ColorField
                  label="Outline Color"
                  value={sel().outlineColor}
                  onInput={(v) =>
                    updateKey(selectedIdx()!, { outlineColor: v })
                  }
                />

                <ColorField
                  label="Pressed Outline"
                  value={sel().pressedOutlineColor}
                  onInput={(v) => updateKey(selectedIdx()!, { pressedOutlineColor: v })}
                />

                <ColorField
                  label="Background"
                  value={sel().bgColor}
                  onInput={(v) => updateKey(selectedIdx()!, { bgColor: v })}
                />

                <ColorField
                  label="Pressed BG"
                  value={sel().pressedBgColor}
                  onInput={(v) =>
                    updateKey(selectedIdx()!, { pressedBgColor: v })
                  }
                />

                <ColorField
                  label="Font Color"
                  value={sel().fontColor}
                  onInput={(v) => updateKey(selectedIdx()!, { fontColor: v })}
                />
                
                <ColorField
                  label="Pressed Font Color"
                  value={sel().pressedFontColor}
                  onInput={(v) => updateKey(selectedIdx()!, { pressedFontColor: v })}
                />
              </div>
            )}
          </Show>
        </aside>
      </div>
    </div>
  );
}
