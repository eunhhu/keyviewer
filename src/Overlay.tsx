import { createSignal, createEffect, onMount, onCleanup, For } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
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

export default function Overlay() {
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [pressed, setPressed] = createSignal<Set<string>>(new Set());
  const [clickThrough, setClickThrough] = createSignal(localStorage.getItem("keyviewer-clickthrough") !== "false");

  let unlisten: UnlistenFn | undefined;

  onMount(async () => {
    const isClickThrough = localStorage.getItem("keyviewer-clickthrough") !== "false";
    invoke("set_ignore_cursor_events", { ignore: isClickThrough }).catch(console.error);

    unlisten = await listen<{ key: string; event_type: "keydown" | "keyup" }>(
      "global-key-event",
      (event) => {
        const { key, event_type } = event.payload;
        setPressed((prev) => {
          const next = new Set(prev);
          if (event_type === "keydown") next.add(key);
          else next.delete(key);
          return next;
        });
      }
    );
  });

  onCleanup(() => {
    unlisten?.();
  });

  createEffect(() => {
    const handler = () => {
      setKeys(loadConfig());
      setClickThrough(localStorage.getItem("keyviewer-clickthrough") !== "false");
    };
    window.addEventListener("storage", handler);
    onCleanup(() => window.removeEventListener("storage", handler));
  });

  createEffect(() => {
    const currentKeys = keys();
    if (currentKeys.length === 0) return;
    
    let maxX = 0;
    let maxY = 0;
    
    for (const k of currentKeys) {
      const right = k.x + k.width + k.outlineWidth * 2;
      const bottom = k.y + k.height + k.outlineWidth * 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    
    const targetWidth = Math.max(400, maxX + 20);
    const targetHeight = Math.max(300, maxY + 20);
    
    getCurrentWindow().setSize(new LogicalSize(targetWidth, targetHeight)).catch(console.error);
  });

  const isPressed = (id: string) => {
    const baseId = id.replace(/_copy.*$/, "");
    return pressed().has(id) || pressed().has(baseId);
  };

  const onDragStart = (e: PointerEvent) => {
    if (clickThrough()) return;
    if (e.target !== e.currentTarget) return;
    getCurrentWindow().startDragging().catch(console.error);
  };

  return (
    <div 
      class="overlay-root" 
      classList={{ "is-draggable": !clickThrough() }}
      onPointerDown={onDragStart}
    >
      <For each={keys()}>
        {(k) => (
          <div
            class="overlay-key"
            style={{
              position: "absolute",
              left: `${k.x}px`,
              top: `${k.y}px`,
              width: `${k.width}px`,
              height: `${k.height}px`,
              "outline-width": `${k.outlineWidth}px`,
              "outline-color": isPressed(k.id)
                ? k.pressedOutlineColor
                : k.outlineColor,
              "outline-style": "solid",
              "background-color": isPressed(k.id)
                ? k.pressedBgColor
                : k.bgColor,
              "border-radius": `${k.rounded}px`,
              "font-size": `${k.fontSize}px`,
              color: isPressed(k.id)
                ? k.pressedFontColor
                : k.fontColor,
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "user-select": "none",
              "pointer-events": "none",
              transition: "background-color 80ms ease-out, outline-color 80ms ease-out, color 80ms ease-out",
            }}
          >
            {k.label}
          </div>
        )}
      </For>
    </div>
  );
}
