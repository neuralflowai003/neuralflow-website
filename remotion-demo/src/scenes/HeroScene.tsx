import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const headlines = [
  "More Leads. Less Work.",
  "Rank #1. Get Found.",
  "Automate Everything.",
];

export const HeroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [105, 120], [1, 0], {
    extrapolateRight: "clamp",
  });

  // Cycle through headlines every 40 frames
  const cycleIndex = Math.floor(frame / 40) % headlines.length;
  const cycleFrame = frame % 40;

  const headlineOpacity = interpolate(
    cycleFrame,
    [0, 8, 32, 40],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" }
  );
  const headlineBlur = interpolate(cycleFrame, [0, 8, 32, 40], [10, 0, 0, 10], {
    extrapolateRight: "clamp",
  });
  const headlineScale = interpolate(
    cycleFrame,
    [0, 8, 32, 40],
    [0.95, 1, 1, 1.05],
    { extrapolateRight: "clamp" }
  );

  // Glow on the active headline
  const glowStrength = interpolate(cycleFrame, [8, 20, 32], [40, 20, 40], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtitle slide up
  const subY = interpolate(frame, [10, 30], [40, 0], {
    extrapolateRight: "clamp",
  });
  const subOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
        backgroundColor: colors.bg,
      }}
    >
      {/* Gradient orbs in background */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          left: "20%",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,107,43,0.15), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "20%",
          right: "20%",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123,97,255,0.15), transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      {/* Rotating headline */}
      <div
        style={{
          fontSize: 88,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: headlineOpacity,
          transform: `scale(${headlineScale})`,
          filter: `blur(${headlineBlur}px)`,
          textShadow: `0 0 ${glowStrength}px rgba(255,107,43,0.6), 0 0 ${glowStrength * 2}px rgba(123,97,255,0.3)`,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        {headlines[cycleIndex]}
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: 30,
          fontFamily: fonts.body,
          color: colors.gray,
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          marginTop: 40,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.5,
        }}
      >
        AI automation & SEO that grows your business
        <br />
        while you focus on what matters.
      </div>
    </AbsoluteFill>
  );
};
