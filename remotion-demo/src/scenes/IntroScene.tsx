import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  const logoScale = interpolate(frame, [0, 25], [0.3, 1], {
    extrapolateRight: "clamp",
  });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const taglineOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [30, 50], [30, 0], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [70, 90], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Glow pulse
  const glowIntensity = interpolate(
    Math.sin(frame * 0.1),
    [-1, 1],
    [20, 60]
  );

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeOut,
        backgroundColor: colors.bg,
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
          marginBottom: 30,
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 28,
            background: gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 ${glowIntensity}px rgba(255, 107, 43, 0.5), 0 0 ${glowIntensity * 2}px rgba(123, 97, 255, 0.3)`,
          }}
        >
          <svg width="70" height="70" viewBox="0 0 70 70" fill="none">
            <path
              d="M15 50 L25 20 L35 38 L45 15 L55 50"
              stroke="white"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <circle cx="25" cy="20" r="4" fill="white" />
            <circle cx="35" cy="38" r="4" fill="white" />
            <circle cx="45" cy="15" r="4" fill="white" />
          </svg>
        </div>
      </div>

      {/* Company name */}
      <div
        style={{
          fontSize: 72,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          letterSpacing: "-1px",
        }}
      >
        <span style={{ color: colors.orange }}>Neural</span>
        <span>Flow</span>
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginLeft: 12,
            fontSize: 48,
          }}
        >
          AI
        </span>
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 28,
          fontFamily: fonts.body,
          color: colors.gray,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          marginTop: 16,
          letterSpacing: "4px",
          textTransform: "uppercase",
        }}
      >
        Your AI Growth Partner
      </div>
    </AbsoluteFill>
  );
};
