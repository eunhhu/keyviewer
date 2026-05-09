import { createSignal, createEffect, onMount, onCleanup, For } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { KeyConfig } from "./types";

const STORAGE_KEY = "keyviewer-config";

function loadConfig(): KeyConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as KeyConfig[];
  } catch {}
  return [];
}

export default function Overlay() {
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [pressed, setPressed] = createSignal<Set<string>>(new Set());

  let unlisten: UnlistenFn | undefined;

  onMount(async () => {
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
    const handler = () => setKeys(loadConfig());
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
    
    import("@tauri-apps/api/window").then((module) => {
      module.getCurrentWindow().setSize(new module.LogicalSize(targetWidth, targetHeight));
    }).catch(() => {});
  });

  return (
    <div class="overlay-root" data-tauri-drag-region>
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
              "outline-color": pressed().has(k.id)
                ? k.pressedOutlineColor
                : k.outlineColor,
              "outline-style": "solid",
              "background-color": pressed().has(k.id)
                ? k.pressedBgColor
                : k.bgColor,
              "border-radius": `${k.rounded}px`,
              "font-size": `${k.fontSize}px`,
              color: pressed().has(k.id)
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
