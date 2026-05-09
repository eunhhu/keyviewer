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
}

export interface AppConfig {
  keys: KeyConfig[];
  overlayActive: boolean;
}
