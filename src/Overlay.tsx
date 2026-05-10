import { createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { calculateOverlayFit, getRainWidth, type ContentOffset } from "./overlayFit";
import type { KeyConfig } from "./types";
import { loadConfig, loadOverlayState, saveOverlayStatePatch } from "./storage";

interface ReleasedRain {
  id: number;
  key: KeyConfig;
  length: number;
  releasedAt: number;
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

export default function Overlay() {
  const initialOverlayState = loadOverlayState();
  const initialContentOffset: ContentOffset = {
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

    onCleanup(() => {
      unlisten?.();
      for (const unlistenWindowEvent of windowUnlisteners) unlistenWindowEvent();
      cancelAnimationFrame(rafId);
    });
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

  const getRainStyle = (k: KeyConfig, offset: ContentOffset) => {
    const startTime = getPressedStartTime(k.id);
    if (!startTime) return null;
    const duration = now() - startTime;
    const length = Math.min(duration * k.rainSpeed, k.rainMaxHeight);
    const width = getRainWidth(k);

    switch (k.rainDirection) {
      case "up":
        return {
          left: `${k.x + offset.x + (k.width - width) / 2}px`,
          top: `${k.y + offset.y - length}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "down":
        return {
          left: `${k.x + offset.x + (k.width - width) / 2}px`,
          top: `${k.y + offset.y + k.height}px`,
          width: `${width}px`,
          height: `${length}px`,
        };
      case "left":
        return {
          left: `${k.x + offset.x - length}px`,
          top: `${k.y + offset.y + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
      case "right":
        return {
          left: `${k.x + offset.x + k.width}px`,
          top: `${k.y + offset.y + (k.height - width) / 2}px`,
          width: `${length}px`,
          height: `${width}px`,
        };
    }
  };

  const getReleasedRainStyle = (rain: ReleasedRain, offset: ContentOffset) => {
    const k = rain.key;
    const speed = Math.max(0.01, k.rainSpeed);
    const travel = (now() - rain.releasedAt) * speed;
    const width = getRainWidth(k);
    const holdLength = rain.length;
    const maxTravel = k.rainMaxHeight;

    const visibleLength = Math.max(0, Math.min(holdLength, maxTravel - travel));
    if (visibleLength <= 0) {
      return { position: "absolute", width: "0px", height: "0px" } as any;
    }

    switch (k.rainDirection) {
      case "up": {
        const topEdge = k.y + offset.y - Math.min(holdLength + travel, maxTravel);
        return {
          position: "absolute",
          left: `${k.x + offset.x + (k.width - width) / 2}px`,
          top: `${topEdge}px`,
          width: `${width}px`,
          height: `${visibleLength}px`,
        };
      }
      case "down":
        return {
          position: "absolute",
          left: `${k.x + offset.x + (k.width - width) / 2}px`,
          top: `${k.y + offset.y + k.height + travel}px`,
          width: `${width}px`,
          height: `${visibleLength}px`,
        };
      case "left": {
        const leftEdge = k.x + offset.x - Math.min(holdLength + travel, maxTravel);
        return {
          position: "absolute",
          left: `${leftEdge}px`,
          top: `${k.y + offset.y + (k.height - width) / 2}px`,
          width: `${visibleLength}px`,
          height: `${width}px`,
        };
      }
      case "right":
        return {
          position: "absolute",
          left: `${k.x + offset.x + k.width + travel}px`,
          top: `${k.y + offset.y + (k.height - width) / 2}px`,
          width: `${visibleLength}px`,
          height: `${width}px`,
        };
    }
  };

  return (
    <div class="overlay-root" classList={{ "is-draggable": !clickThrough() }} onPointerDown={onRootPointerDown}>
      <Show when={!clickThrough()}>
        <>
          <div class="overlay-drag-handle" onPointerDown={startWindowDrag}>
            Drag overlay
          </div>
        </>
      </Show>
      <For each={releasedRains()}>
        {(rain) => (
          <div
            style={{
              position: "absolute",
              ...getReleasedRainStyle(rain, contentOffset()),
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
          const isKeyPressed = () => isPressed(k.id);
          const rainStyle = () => isKeyPressed() ? getRainStyle(k, contentOffset()) : null;

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
                  left: `${k.x + contentOffset().x}px`,
                  top: `${k.y + contentOffset().y}px`,
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
