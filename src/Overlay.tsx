import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
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

function loadOverlayState() {
  try {
    const raw = localStorage.getItem(OVERLAY_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export default function Overlay() {
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [pressed, setPressed] = createSignal<Set<string>>(new Set());
  const [pressedSince, setPressedSince] = createSignal<Map<string, number>>(new Map());
  const [now, setNow] = createSignal(Date.now());
  const [clickThrough, setClickThrough] = createSignal(
    localStorage.getItem("keyviewer-clickthrough") !== "false"
  );

  let unlisten: UnlistenFn | undefined;
  let rafId: number;

  const animate = () => {
    setNow(Date.now());
    rafId = requestAnimationFrame(animate);
  };

  onMount(async () => {
    const isClickThrough = localStorage.getItem("keyviewer-clickthrough") !== "false";
    invoke("set_ignore_cursor_events", { ignore: isClickThrough }).catch(console.error);

    const state = loadOverlayState();
    if (state?.x !== undefined && state?.y !== undefined) {
      invoke("set_overlay_position", { x: state.x, y: state.y }).catch(console.error);
    }

    rafId = requestAnimationFrame(animate);

    unlisten = await listen<{ key: string; event_type: "keydown" | "keyup" }>(
      "global-key-event",
      (event) => {
        const { key, event_type } = event.payload;
        const keyId = key;

        setPressed((prev) => {
          const next = new Set(prev);
          if (event_type === "keydown") next.add(keyId);
          else next.delete(keyId);
          return next;
        });

        setPressedSince((prev) => {
          const next = new Map(prev);
          if (event_type === "keydown") {
            if (!next.has(keyId)) next.set(keyId, Date.now());
          } else {
            next.delete(keyId);
          }
          return next;
        });
      }
    );
  });

  onCleanup(() => {
    unlisten?.();
    cancelAnimationFrame(rafId);
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

    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;

    for (const k of currentKeys) {
      const keyLeft = k.x;
      const keyTop = k.y;
      const keyRight = k.x + k.width + k.outlineWidth * 2;
      const keyBottom = k.y + k.height + k.outlineWidth * 2;

      if (keyLeft < minX) minX = keyLeft;
      if (keyTop < minY) minY = keyTop;
      if (keyRight > maxX) maxX = keyRight;
      if (keyBottom > maxY) maxY = keyBottom;

      const isKeyPressed = isPressed(k.id);
      if (isKeyPressed) {
        const startTime = getPressedStartTime(k.id);
        if (startTime) {
          const duration = now() - startTime;
          const rainLength = Math.min(duration * k.rainSpeed, k.rainMaxHeight);

          switch (k.rainDirection) {
            case "up": {
              const top = k.y - rainLength;
              if (top < minY) minY = top;
              break;
            }
            case "down": {
              const bottom = k.y + k.height + rainLength;
              if (bottom > maxY) maxY = bottom;
              break;
            }
            case "left": {
              const left = k.x - rainLength;
              if (left < minX) minX = left;
              break;
            }
            case "right": {
              const right = k.x + k.width + rainLength;
              if (right > maxX) maxX = right;
              break;
            }
          }
        }
      }
    }

    const padding = 20;
    const targetWidth = Math.max(400, maxX - Math.max(0, minX) + padding * 2);
    const targetHeight = Math.max(300, maxY - Math.max(0, minY) + padding * 2);

    getCurrentWindow()
      .setSize(new LogicalSize(targetWidth, targetHeight))
      .catch(console.error);
  });

  const isPressed = (id: string) => {
    const baseId = id.replace(/_copy.*$/, "");
    return pressed().has(id) || pressed().has(baseId);
  };

  const getPressedStartTime = (id: string): number | undefined => {
    const baseId = id.replace(/_copy.*$/, "");
    return pressedSince().get(id) || pressedSince().get(baseId);
  };

  const onDragStart = (e: PointerEvent) => {
    if (clickThrough()) return;
    if (e.target !== e.currentTarget) return;
    getCurrentWindow().startDragging().catch(console.error);
  };

  const getRainStyle = (k: KeyConfig) => {
    const startTime = getPressedStartTime(k.id);
    if (!startTime) return null;
    const duration = now() - startTime;
    const length = Math.min(duration * k.rainSpeed, k.rainMaxHeight);
    const width = k.rainWidth > 0 ? k.rainWidth : k.width - k.outlineWidth * 2;

    switch (k.rainDirection) {
      case "up":
        return {
          left: `${k.x + (k.width - width) / 2}px`,
          top: `${k.y - length}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "down":
        return {
          left: `${k.x + (k.width - width) / 2}px`,
          top: `${k.y + k.height}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "left":
        return {
          left: `${k.x - length}px`,
          top: `${k.y + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
      case "right":
        return {
          left: `${k.x + k.width}px`,
          top: `${k.y + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
    }
  };

  return (
    <div class="overlay-root" classList={{ "is-draggable": !clickThrough() }} onPointerDown={onDragStart}>
      <For each={keys()}>
        {(k) => {
          const isKeyPressed = isPressed(k.id);
          const rainStyle = isKeyPressed ? getRainStyle(k) : null;

          return (
            <>
              <Show when={rainStyle}>
                <div
                  style={{
                    position: "absolute",
                    ...rainStyle!,
                    "background-color": k.rainColor,
                    opacity: 0.6,
                    "border-radius": `${k.rounded}px`,
                    "pointer-events": "none",
                    transition: "none",
                  }}
                />
              </Show>

              <div
                class="overlay-key"
                style={{
                  position: "absolute",
                  left: `${k.x}px`,
                  top: `${k.y}px`,
                  width: `${k.width}px`,
                  height: `${k.height}px`,
                  "outline-width": `${k.outlineWidth}px`,
                  "outline-color": isKeyPressed ? k.pressedOutlineColor : k.outlineColor,
                  "outline-style": "solid",
                  "background-color": isKeyPressed ? k.pressedBgColor : k.bgColor,
                  "border-radius": `${k.rounded}px`,
                  "font-size": `${k.fontSize}px`,
                  color: isKeyPressed ? k.pressedFontColor : k.fontColor,
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "user-select": "none",
                  "pointer-events": "none",
                  transition:
                    "background-color 80ms ease-out, outline-color 80ms ease-out, color 80ms ease-out",
                }}
              >
                {k.label}
              </div>
            </>
          );
        }}
      </For>
    </div>
  );
}
