import { CSSProperties } from "react";
import { interpolate } from "remotion";

// Exact colors from neuralflowai.io CSS variables
export const colors = {
  bg: "#050508",          // --bg
  bgAlt: "#0a0a0f",      // --bg-alt
  accent: "#FF6B2B",      // --accent (orange)
  accentGlow: "rgba(255, 107, 43, 0.5)", // --accent-glow
  purple: "#7B61FF",
  white: "#ffffff",        // --text
  muted: "#888899",        // --muted
  border: "rgba(255, 255, 255, 0.08)", // --border
  glass: "rgba(18, 18, 22, 0.4)",     // --glass
  green: "#22c55e",
};

export const gradient = "linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)";
export const gradientReverse = "linear-gradient(135deg, #7B61FF 0%, #FF6B2B 100%)";
export const gradientHorizontal = "linear-gradient(90deg, #FF6B2B, #7B61FF)";

export const fonts = {
  heading: "'Space Grotesk', 'Inter', sans-serif",
  body: "'Inter', 'Space Grotesk', sans-serif",
  mono: "'SF Mono', 'Fira Code', 'Consolas', monospace",
};

export const fullCenter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  position: "absolute",
  top: 0,
  left: 0,
};

// Matches the site's glass card style
export const glassCard: CSSProperties = {
  background: colors.glass,
  border: `1px solid ${colors.border}`,
  borderRadius: 20,
  backdropFilter: "blur(20px)",
};

export function spring(frame: number, start: number, end: number, damping = 0.7): number {
  const progress = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  const elastic = 1 - Math.pow(1 - progress, 3) * Math.cos(progress * Math.PI * damping);
  return Math.min(1, elastic);
}
