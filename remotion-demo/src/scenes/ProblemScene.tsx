import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const problems = [
  { icon: "😤", text: "Spending hours on tasks AI could do in seconds" },
  { icon: "📉", text: "Competitors outranking you on Google" },
  { icon: "💸", text: "Losing leads because nobody answers after hours" },
  { icon: "🔄", text: "Drowning in repetitive manual workflows" },
];

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [105, 120], [1, 0], {
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
        padding: "0 180px",
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 56,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: titleOpacity,
          marginBottom: 60,
          textAlign: "center",
          letterSpacing: "-1px",
        }}
      >
        Sound{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Familiar
        </span>
        ?
      </div>

      {/* Problem items */}
      <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%", maxWidth: 900 }}>
        {problems.map((problem, i) => {
          const delay = 15 + i * 15;
          const itemOpacity = interpolate(frame, [delay, delay + 12], [0, 1], {
            extrapolateRight: "clamp",
          });
          const itemX = interpolate(frame, [delay, delay + 12], [-60, 0], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          // Red strike-through that appears after item
          const strikeWidth = interpolate(
            frame,
            [delay + 20, delay + 30],
            [0, 100],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                opacity: itemOpacity,
                transform: `translateX(${itemX}px)`,
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "20px 32px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.06)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span style={{ fontSize: 36 }}>{problem.icon}</span>
              <span
                style={{
                  fontSize: 22,
                  fontFamily: fonts.body,
                  color: strikeWidth > 50 ? colors.muted : colors.white,
                  fontWeight: 500,
                }}
              >
                {problem.text}
              </span>
              {/* Strike-through line */}
              <div
                style={{
                  position: "absolute",
                  left: 80,
                  top: "50%",
                  width: `${strikeWidth}%`,
                  height: 2,
                  background: "linear-gradient(90deg, #ef4444, transparent)",
                  transform: "translateY(-50%)",
                }}
              />
              {/* Checkmark that appears after strike */}
              {strikeWidth > 90 && (
                <div
                  style={{
                    position: "absolute",
                    right: 32,
                    fontSize: 28,
                    opacity: interpolate(
                      frame,
                      [delay + 28, delay + 35],
                      [0, 1],
                      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                    ),
                  }}
                >
                  ✅
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
