import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const headlines = [
  "More Leads. Less Work.",
  "Rank #1. Get Found.",
  "Automate Everything.",
  "Grow While You Sleep.",
];

export const HeroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [105, 120], [1, 0], {
    extrapolateRight: "clamp",
  });

  // Cycle headlines every 30 frames
  const cycleIndex = Math.floor(frame / 30) % headlines.length;
  const cycleFrame = frame % 30;

  // 3-phase: blur in → hold → blur out
  const headlineOpacity = interpolate(
    cycleFrame,
    [0, 6, 24, 30],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" }
  );
  const headlineBlur = interpolate(
    cycleFrame,
    [0, 6, 24, 30],
    [12, 0, 0, 12],
    { extrapolateRight: "clamp" }
  );
  const headlineY = interpolate(
    cycleFrame,
    [0, 6, 24, 30],
    [20, 0, 0, -20],
    { extrapolateRight: "clamp" }
  );

  const glowStrength = interpolate(
    Math.sin(cycleFrame * 0.2),
    [-1, 1],
    [20, 50]
  );

  // Subtitle
  const subOpacity = interpolate(frame, [8, 25], [0, 1], {
    extrapolateRight: "clamp",
  });
  const subY = interpolate(frame, [8, 25], [30, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Accent line under headline
  const lineWidth = interpolate(frame, [10, 30], [0, 300], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
      }}
    >
      {/* Rotating headline */}
      <div
        style={{
          fontSize: 96,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: headlineOpacity,
          transform: `translateY(${headlineY}px)`,
          filter: `blur(${headlineBlur}px)`,
          textShadow: `0 0 ${glowStrength}px rgba(255,107,43,0.5), 0 0 ${glowStrength * 2}px rgba(123,97,255,0.2)`,
          textAlign: "center",
          lineHeight: 1.1,
          letterSpacing: "-2px",
        }}
      >
        {headlines[cycleIndex]}
      </div>

      {/* Gradient accent line */}
      <div
        style={{
          width: lineWidth,
          height: 3,
          background: gradient,
          borderRadius: 2,
          marginTop: 30,
          opacity: subOpacity,
          boxShadow: `0 0 20px rgba(255,107,43,0.3)`,
        }}
      />

      {/* Subtitle */}
      <div
        style={{
          fontSize: 28,
          fontFamily: fonts.body,
          color: colors.muted,
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          marginTop: 30,
          textAlign: "center",
          maxWidth: 700,
          lineHeight: 1.6,
          fontWeight: 400,
        }}
      >
        AI automation & SEO that grows your revenue
        <br />
        while you focus on what matters.
      </div>
    </AbsoluteFill>
  );
};
