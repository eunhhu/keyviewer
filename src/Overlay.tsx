import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { calculateOverlayFit, getRainWidth, type ContentOffset, type OverlayState } from "./overlayFit";
import type { KeyConfig } from "./types";

const STORAGE_KEY = "keyviewer-config";
const OVERLAY_STATE_KEY = "keyviewer-overlay-state";

interface ReleasedRain {
  id: number;
  key: KeyConfig;
  length: number;
  releasedAt: number;
}

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

function loadOverlayState(): OverlayState | null {
  try {
    const raw = localStorage.getItem(OVERLAY_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveOverlayStatePatch(patch: Partial<OverlayState>) {
  const current = loadOverlayState() ?? {};
  localStorage.setItem(OVERLAY_STATE_KEY, JSON.stringify({ ...current, ...patch }));
}

function keyAliases(id: string) {
  const baseId = id.replace(/_copy.*$/, "");
  const aliases = new Set([id, baseId]);

  const keyMatch = baseId.match(/^Key([A-Z])$/);
  if (keyMatch) aliases.add(keyMatch[1]);
  if (/^[A-Z]$/.test(baseId)) aliases.add(`Key${baseId}`);

  const numMatch = baseId.match(/^(Num|Digit|Kp)(\d)$/);
  if (numMatch) aliases.add(numMatch[2]);
  if (/^\d$/.test(baseId)) {
    aliases.add(`Num${baseId}`);
    aliases.add(`Digit${baseId}`);
    aliases.add(`Kp${baseId}`);
  }

  if (baseId === "Return" || baseId === "KpReturn") aliases.add("Enter");
  if (baseId === "Enter") aliases.add("Return");
  if (baseId === "Space") aliases.add("␣");
  if (baseId === "␣") aliases.add("Space");
  if (baseId.startsWith("Control")) aliases.add("Ctrl");
  if (baseId === "Ctrl") {
    aliases.add("ControlLeft");
    aliases.add("ControlRight");
  }
  if (baseId.startsWith("Shift")) aliases.add("Shift");
  if (baseId.startsWith("Alt")) aliases.add("Alt");
  if (baseId.startsWith("Meta")) aliases.add("Meta");

  return aliases;
}

function getLayout(offset: ContentOffset) {
  return { offsetX: offset.x, offsetY: offset.y };
}

export default function Overlay() {
  const initialOverlayState = loadOverlayState();
  const initialContentOffset = {
    x: initialOverlayState?.contentOffsetX ?? 0,
    y: initialOverlayState?.contentOffsetY ?? 0,
  };
  const [keys, setKeys] = createSignal<KeyConfig[]>(loadConfig());
  const [pressed, setPressed] = createSignal<Set<string>>(new Set());
  const [pressedSince, setPressedSince] = createSignal<Map<string, number>>(new Map());
  const [releasedRains, setReleasedRains] = createSignal<ReleasedRain[]>([]);
  const [now, setNow] = createSignal(Date.now());
  const [contentOffset, setContentOffset] = createSignal<ContentOffset>(initialContentOffset);
  const [overlayReady, setOverlayReady] = createSignal(false);
  const [clickThrough, setClickThrough] = createSignal(
    localStorage.getItem("keyviewer-clickthrough") !== "false"
  );

  let unlisten: UnlistenFn | undefined;
  let windowUnlisteners: UnlistenFn[] = [];
  let rafId: number;
  let releasedRainId = 0;
  let appliedContentOffset = initialContentOffset;
  let fitRequestId = 0;
  const layout = () => getLayout(contentOffset());

  const animate = () => {
    const currentTime = Date.now();
    setNow(currentTime);
    setReleasedRains((prev) =>
      prev.filter((rain) => {
        const speed = Math.max(0.01, rain.key.rainSpeed);
        const travel = (currentTime - rain.releasedAt) * speed;
        return travel < rain.key.rainMaxHeight;
      })
    );
    rafId = requestAnimationFrame(animate);
  };

  onMount(async () => {
    const isClickThrough = localStorage.getItem("keyviewer-clickthrough") !== "false";
    invoke("set_ignore_cursor_events", { ignore: isClickThrough }).catch(console.error);

    const state = loadOverlayState();
    if (state?.x !== undefined && state?.y !== undefined) {
      await invoke("set_overlay_position", { x: state.x, y: state.y }).catch(console.error);
    }

    const currentWindow = getCurrentWindow();
    windowUnlisteners = [
      await currentWindow.onMoved(({ payload }) => {
        saveOverlayStatePatch({ x: payload.x, y: payload.y });
      }),
      await currentWindow.onResized(async ({ payload }) => {
        const scaleFactor = await currentWindow.scaleFactor();
        saveOverlayStatePatch({
          width: Math.round(payload.width / scaleFactor),
          height: Math.round(payload.height / scaleFactor),
        });
      }),
    ];

    setOverlayReady(true);

    rafId = requestAnimationFrame(animate);

    unlisten = await listen<{ key: string; event_type: "keydown" | "keyup" }>(
      "global-key-event",
      (event) => {
        const { key, event_type } = event.payload;
        const keyId = key;
        const eventTime = Date.now();

        if (event_type === "keyup") {
          const currentPressedSince = pressedSince();
          const released = keys()
            .filter((k) => keyAliases(k.id).has(keyId))
            .map((k) => {
              const startTime = getPressedStartTime(k.id) ?? currentPressedSince.get(keyId);
              if (startTime === undefined) return null;
              const length = Math.min((eventTime - startTime) * k.rainSpeed, k.rainMaxHeight);
              if (length <= 1) return null;
              releasedRainId += 1;
              return { id: releasedRainId, key: { ...k }, length, releasedAt: eventTime };
            })
            .filter((rain): rain is ReleasedRain => rain !== null);

          if (released.length > 0) {
            setReleasedRains((prev) => [...prev, ...released]);
          }
        }

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

  createEffect(() => {
    if (!overlayReady()) return;

    const fit = calculateOverlayFit(keys());
    const requestId = ++fitRequestId;
    const previousOffset = appliedContentOffset;
    const deltaX = fit.offset.x - previousOffset.x;
    const deltaY = fit.offset.y - previousOffset.y;

    appliedContentOffset = fit.offset;
    setContentOffset(fit.offset);
    saveOverlayStatePatch({
      width: fit.width,
      height: fit.height,
      contentOffsetX: fit.offset.x,
      contentOffsetY: fit.offset.y,
    });

    (async () => {
      if (deltaX !== 0 || deltaY !== 0) {
        const position = await invoke<[number, number] | null>("get_overlay_position");
        if (position && requestId === fitRequestId) {
          const scaleFactor = await getCurrentWindow().scaleFactor();
          await invoke("set_overlay_position", {
            x: Math.round(position[0] - deltaX * scaleFactor),
            y: Math.round(position[1] - deltaY * scaleFactor),
          });
        }
      }

      if (requestId === fitRequestId) {
        await invoke("set_overlay_size", { width: fit.width, height: fit.height });
      }
    })().catch(console.error);
  });

  onCleanup(() => {
    unlisten?.();
    for (const unlistenWindowEvent of windowUnlisteners) unlistenWindowEvent();
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

  const isPressed = (id: string) => {
    const currentPressed = pressed();
    for (const alias of keyAliases(id)) {
      if (currentPressed.has(alias)) return true;
    }
    return false;
  };

  const getPressedStartTime = (id: string): number | undefined => {
    const currentPressedSince = pressedSince();
    for (const alias of keyAliases(id)) {
      const startTime = currentPressedSince.get(alias);
      if (startTime !== undefined) return startTime;
    }
    return undefined;
  };

  const startWindowDrag = (e: PointerEvent) => {
    if (clickThrough()) return;
    e.preventDefault();
    e.stopPropagation();
    getCurrentWindow().startDragging().catch(console.error);
  };

  const onRootPointerDown = (e: PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    startWindowDrag(e);
  };

  const getRainStyle = (k: KeyConfig, layout: ReturnType<typeof getLayout>) => {
    const startTime = getPressedStartTime(k.id);
    if (!startTime) return null;
    const duration = now() - startTime;
    const length = Math.min(duration * k.rainSpeed, k.rainMaxHeight);
    const width = getRainWidth(k);

    switch (k.rainDirection) {
      case "up":
        return {
          left: `${k.x + layout.offsetX + (k.width - width) / 2}px`,
          top: `${k.y + layout.offsetY - length}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "down":
        return {
          left: `${k.x + layout.offsetX + (k.width - width) / 2}px`,
          top: `${k.y + layout.offsetY + k.height}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "left":
        return {
          left: `${k.x + layout.offsetX - length}px`,
          top: `${k.y + layout.offsetY + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
      case "right":
        return {
          left: `${k.x + layout.offsetX + k.width}px`,
          top: `${k.y + layout.offsetY + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
    }
  };

  const getReleasedRainStyle = (rain: ReleasedRain, layout: ReturnType<typeof getLayout>) => {
    const k = rain.key;
    const speed = Math.max(0.01, k.rainSpeed);
    const travel = (now() - rain.releasedAt) * speed;
    const width = getRainWidth(k);
    const currentLength = Math.max(0, k.rainMaxHeight - travel);

    const base = {
      width: `${width}px`,
      height: `${currentLength}px`,
    };

    switch (k.rainDirection) {
      case "up":
        return {
          ...base,
          left: `${k.x + layout.offsetX + (k.width - width) / 2}px`,
          top: `${k.y + layout.offsetY - currentLength - travel}px`,
        };
      case "down":
        return {
          ...base,
          left: `${k.x + layout.offsetX + (k.width - width) / 2}px`,
          top: `${k.y + layout.offsetY + k.height + travel}px`,
        };
      case "left":
        return {
          left: `${k.x + layout.offsetX - currentLength - travel}px`,
          top: `${k.y + layout.offsetY + (k.height - width) / 2}px`,
          width: `${currentLength}px`,
          height: `${width}px`,
        };
      case "right":
        return {
          left: `${k.x + layout.offsetX + k.width + travel}px`,
          top: `${k.y + layout.offsetY + (k.height - width) / 2}px`,
          width: `${currentLength}px`,
          height: `${width}px`,
        };
    }
  };

  return (
    <div class="overlay-root" classList={{ "is-draggable": !clickThrough() }} onPointerDown={onRootPointerDown}>
      <Show when={!clickThrough()}>
        <>
          <div
            class="overlay-drag-handle"
            onPointerDown={startWindowDrag}
          >
            Drag overlay
          </div>
        </>
      </Show>
      <For each={releasedRains()}>
        {(rain) => (
          <div
            style={{
              position: "absolute",
              ...getReleasedRainStyle(rain, layout()),
              "background-color": rain.key.rainColor,
              "border-radius": `${rain.key.rounded}px`,
              "pointer-events": "none",
              transition: "none",
            }}
          />
        )}
      </For>
      <For each={keys()}>
        {(k) => {
          const currentLayout = () => layout();
          const isKeyPressed = () => isPressed(k.id);
          const rainStyle = () => isKeyPressed() ? getRainStyle(k, currentLayout()) : null;

          return (
            <>
              <Show when={rainStyle()}>
                {(style) => (
                  <div
                    style={{
                      position: "absolute",
                      ...style(),
                      "background-color": k.rainColor,
                      "border-radius": `${k.rounded}px`,
                      "pointer-events": "none",
                      transition: "none",
                    }}
                  />
                )}
              </Show>

              <div
                class="overlay-key"
                style={{
                  position: "absolute",
                  left: `${k.x + currentLayout().offsetX}px`,
                  top: `${k.y + currentLayout().offsetY}px`,
                  width: `${k.width}px`,
                  height: `${k.height}px`,
                  "outline-width": `${k.outlineWidth}px`,
                  "outline-color": isKeyPressed() ? k.pressedOutlineColor : k.outlineColor,
                  "outline-style": "solid",
                  "background-color": isKeyPressed() ? k.pressedBgColor : k.bgColor,
                  "border-radius": `${k.rounded}px`,
                  "font-size": `${k.fontSize}px`,
                  color: isKeyPressed() ? k.pressedFontColor : k.fontColor,
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
