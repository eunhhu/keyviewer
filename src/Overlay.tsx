import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { KeyConfig } from "./types";

const STORAGE_KEY = "keyviewer-config";

const RAIN_SPEED = 0.15;
const MAX_RAIN_HEIGHT = 400;

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

    let maxX = 0;
    let maxY = 0;
    let maxRainTop = 0;

    for (const k of currentKeys) {
      const right = k.x + k.width + k.outlineWidth * 2;
      const bottom = k.y + k.height + k.outlineWidth * 2;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;

      const isKeyPressed = isPressed(k.id);
      if (isKeyPressed) {
        const startTime = pressedSince().get(k.id) || now();
        const duration = now() - startTime;
        const rainHeight = Math.min(duration * RAIN_SPEED, MAX_RAIN_HEIGHT);
        const top = k.y - rainHeight;
        if (top < maxRainTop) maxRainTop = top;
      }
    }

    const targetWidth = Math.max(400, maxX + 20);
    const targetHeight = Math.max(300, maxY + 20 + Math.abs(maxRainTop));

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

  return (
    <div class="overlay-root" classList={{ "is-draggable": !clickThrough() }} onPointerDown={onDragStart}>
      <For each={keys()}>
        {(k) => {
          const startTime = getPressedStartTime(k.id);
          const duration = startTime ? now() - startTime : 0;
          const rainHeight = Math.min(duration * RAIN_SPEED, MAX_RAIN_HEIGHT);
          const isKeyPressed = isPressed(k.id);

          return (
            <>
              <Show when={isKeyPressed && rainHeight > 0}>
                <div
                  style={{
                    position: "absolute",
                    left: `${k.x + k.outlineWidth}px`,
                    top: `${k.y - rainHeight}px`,
                    width: `${k.width - k.outlineWidth * 2}px`,
                    height: `${rainHeight}px`,
                    "background-color": k.pressedBgColor,
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
