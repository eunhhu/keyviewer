export interface KeyConfig {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  outlineWidth: number;
  outlineColor: string;
  bgColor: string;
  pressedOutlineColor: string;
  pressedBgColor: string;
  rounded: number;
  fontSize: number;
  fontColor: string;
  pressedFontColor: string;
  rainDirection: "up" | "down" | "left" | "right";
  rainWidth: number;
  rainColor: string;
  rainSpeed: number;
  rainMaxHeight: number;
}
