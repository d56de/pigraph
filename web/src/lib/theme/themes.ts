export type ThemeId = "obsidian" | "aurora" | "nord";

/** Graph-Farben für den Pixi-Renderer (Pixi nutzt numerische Hex-Werte). */
export interface GraphPalette {
  background: number;
  client: number;
  domainAllowed: number;
  domainBlocked: number;
  edge: number;
  edgeBlockedPulse: number;
  labelClient: number;
  labelDomain: number;
}

/** CSS-Token für HUD/Karten (als Strings für CSS-Variablen). */
export interface CssPalette {
  bg: string;
  panel: string;
  panelBorder: string;
  text: string;
  textDim: string;
  client: string;
  allowed: string;
  blocked: string;
  forwarded: string;
}

export interface Palette {
  graph: GraphPalette;
  css: CssPalette;
}

export const THEMES: Record<ThemeId, Palette> = {
  obsidian: {
    graph: {
      background: 0x0b0d12,
      client: 0xa89df8,
      domainAllowed: 0x86efac,
      domainBlocked: 0xfca5a5,
      edge: 0x2d3344,
      edgeBlockedPulse: 0xf87171,
      labelClient: 0xc4bdfb,
      labelDomain: 0x8b93a8,
    },
    css: {
      bg: "#0b0d12",
      panel: "rgba(22, 26, 34, 0.9)",
      panelBorder: "#2a3040",
      text: "#e8eaf0",
      textDim: "#8b93a8",
      client: "#a89df8",
      allowed: "#86efac",
      blocked: "#fca5a5",
      forwarded: "#fbbf24",
    },
  },
  aurora: {
    graph: {
      background: 0x06080f,
      client: 0x67e8f9,
      domainAllowed: 0x67e8f9,
      domainBlocked: 0xf472b6,
      edge: 0x3b5a8c,
      edgeBlockedPulse: 0xf472b6,
      labelClient: 0xbfdbfe,
      labelDomain: 0x7b8bb0,
    },
    css: {
      bg: "#06080f",
      panel: "rgba(18, 24, 40, 0.9)",
      panelBorder: "#243049",
      text: "#e6edff",
      textDim: "#7b8bb0",
      client: "#67e8f9",
      allowed: "#67e8f9",
      blocked: "#f472b6",
      forwarded: "#fde047",
    },
  },
  nord: {
    graph: {
      background: 0x2e3440,
      client: 0x88c0d0,
      domainAllowed: 0xa3be8c,
      domainBlocked: 0xbf616a,
      edge: 0x4c566a,
      edgeBlockedPulse: 0xbf616a,
      labelClient: 0xe5e9f0,
      labelDomain: 0xaab2c0,
    },
    css: {
      bg: "#2e3440",
      panel: "rgba(59, 66, 82, 0.9)",
      panelBorder: "#4c566a",
      text: "#e5e9f0",
      textDim: "#aab2c0",
      client: "#88c0d0",
      allowed: "#a3be8c",
      blocked: "#bf616a",
      forwarded: "#ebcb8b",
    },
  },
};
