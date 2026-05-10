import type { KeyConfig } from "./types";
import type { OverlayState } from "./overlayFit";

export const STORAGE_KEY = "keyviewer-config";
export const OVERLAY_STATE_KEY = "keyviewer-overlay-state";

export const defaultKeyConfig = (id: string, label: string): KeyConfig => ({
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

export function loadConfig(): KeyConfig[] {
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

export function saveConfig(keys: KeyConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys }));
}

export function loadOverlayState(): OverlayState | null {
  try {
    const raw = localStorage.getItem(OVERLAY_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveOverlayStatePatch(patch: Partial<OverlayState>) {
  const current = loadOverlayState() ?? {};
  localStorage.setItem(OVERLAY_STATE_KEY, JSON.stringify({ ...current, ...patch }));
}

export function keyIdToLabel(keyId: string): string {
  const isMac = navigator.userAgent.toLowerCase().includes("mac");
  let label = keyId
    .replace(/^Key([A-Z])$/, "$1")
    .replace(/^Num(\d)$/, "$1")
    .replace(/^Kp(\d)$/, "$1");

  const map: Record<string, string> = {
    Return: "Enter",
    KpReturn: "Enter",
    Space: "␣",
    UpArrow: "↑",
    DownArrow: "↓",
    LeftArrow: "←",
    RightArrow: "→",
    Escape: "Esc",
    Backspace: "⌫",
    Tab: "⇥",
    Delete: "Del",
    Minus: "-",
    KpMinus: "-",
    Equal: "=",
    KpPlus: "=",
    Comma: ",",
    Dot: ".",
    Slash: "/",
    KpDivide: "/",
    BackSlash: "\\",
    SemiColon: ";",
    Quote: "'",
    BackQuote: "`",
    LeftBracket: "[",
    RightBracket: "]",
    CapsLock: "Caps",
    PrintScreen: "PrtSc",
  };

  if (map[label]) return map[label];
  if (label.startsWith("Control")) return "Ctrl";
  if (label.startsWith("Shift")) return "Shift";
  if (label.startsWith("Alt")) return isMac && label.includes("Gr") ? "Option" : "Alt";
  if (label.startsWith("Meta")) return isMac ? "Cmd" : "Win";

  return label;
}
