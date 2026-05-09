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
  pressedBgColor: string;
  rounded: number;
  fontSize: number;
  fontColor: string;
}

export interface AppConfig {
  keys: KeyConfig[];
  overlayActive: boolean;
}
