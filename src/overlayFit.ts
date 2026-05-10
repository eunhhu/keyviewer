import type { KeyConfig } from "./types";

export const OVERLAY_BOUNDS_PADDING = 16;
export const MIN_OVERLAY_WIDTH = 120;
export const MIN_OVERLAY_HEIGHT = 80;

export interface OverlayState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  contentOffsetX?: number;
  contentOffsetY?: number;
}

export interface ContentOffset {
  x: number;
  y: number;
}

export function getRainWidth(k: KeyConfig) {
  return Math.max(1, k.rainWidth > 0 ? k.rainWidth : k.width - k.outlineWidth * 2);
}

export function calculateOverlayFit(keys: KeyConfig[]) {
  if (keys.length === 0) {
    return { width: 400, height: 300, offset: { x: 0, y: 0 } };
  }

  let minX = 0;
  let minY = 0;
  let maxX = MIN_OVERLAY_WIDTH;
  let maxY = MIN_OVERLAY_HEIGHT;

  const includeRect = (left: number, top: number, right: number, bottom: number) => {
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  };

  for (const k of keys) {
    includeRect(k.x, k.y, k.x + k.width, k.y + k.height);

    const rainWidth = getRainWidth(k);
    const releasedRainExtent = k.rainMaxHeight * 2;
    switch (k.rainDirection) {
      case "up":
        includeRect(
          k.x + (k.width - rainWidth) / 2,
          k.y - releasedRainExtent,
          k.x + (k.width + rainWidth) / 2,
          k.y
        );
        break;
      case "down":
        includeRect(
          k.x + (k.width - rainWidth) / 2,
          k.y + k.height,
          k.x + (k.width + rainWidth) / 2,
          k.y + k.height + releasedRainExtent
        );
        break;
      case "left":
        includeRect(
          k.x - releasedRainExtent,
          k.y + (k.height - rainWidth) / 2,
          k.x,
          k.y + (k.height + rainWidth) / 2
        );
        break;
      case "right":
        includeRect(
          k.x + k.width,
          k.y + (k.height - rainWidth) / 2,
          k.x + k.width + releasedRainExtent,
          k.y + (k.height + rainWidth) / 2
        );
        break;
    }
  }

  const offset = {
    x: minX < 0 ? Math.ceil(-minX + OVERLAY_BOUNDS_PADDING) : 0,
    y: minY < 0 ? Math.ceil(-minY + OVERLAY_BOUNDS_PADDING) : 0,
  };

  return {
    width: Math.ceil(Math.max(MIN_OVERLAY_WIDTH, maxX + offset.x + OVERLAY_BOUNDS_PADDING)),
    height: Math.ceil(Math.max(MIN_OVERLAY_HEIGHT, maxY + offset.y + OVERLAY_BOUNDS_PADDING)),
    offset,
  };
}
