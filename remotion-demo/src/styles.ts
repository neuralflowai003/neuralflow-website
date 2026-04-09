import { CSSProperties } from "react";
import { interpolate } from "remotion";

export const colors = {
  bg: "#050508",
  bgCard: "#0a0a12",
  orange: "#FF6B2B",
  purple: "#7B61FF",
  white: "#ffffff",
  gray: "#a0a0b0",
  green: "#22c55e",
  border: "rgba(255,255,255,0.08)",
};

export const gradient = "linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)";
export const gradientReverse = "linear-gradient(135deg, #7B61FF 0%, #FF6B2B 100%)";

export const fonts = {
  heading: "'Space Grotesk', 'SF Pro Display', 'Inter', sans-serif",
  body: "'Inter', 'SF Pro Text', 'Space Grotesk', sans-serif",
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

export const glassCard: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  backdropFilter: "blur(20px)",
};

// Easing helper for spring-like animations
export function spring(frame: number, start: number, end: number, damping = 0.7): number {
  const progress = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  const elastic = 1 - Math.pow(1 - progress, 3) * Math.cos(progress * Math.PI * damping);
  return Math.min(1, elastic);
}

// Animated grid dot background helper
export function gridDotOpacity(frame: number, dotIndex: number, totalDots: number): number {
  const wave = Math.sin((frame * 0.03) + (dotIndex / totalDots) * Math.PI * 4);
  return 0.03 + wave * 0.02;
}
