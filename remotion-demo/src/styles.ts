import { CSSProperties } from "react";

export const colors = {
  bg: "#050508",
  bgCard: "#0a0a12",
  orange: "#FF6B2B",
  purple: "#7B61FF",
  white: "#ffffff",
  gray: "#a0a0b0",
  border: "rgba(255,255,255,0.08)",
};

export const gradient = "linear-gradient(135deg, #FF6B2B 0%, #7B61FF 100%)";

export const fonts = {
  heading: "'Space Grotesk', 'Inter', sans-serif",
  body: "'Inter', 'Space Grotesk', sans-serif",
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
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: "32px 40px",
};
