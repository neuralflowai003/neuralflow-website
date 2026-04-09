import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const stats = [
  { value: 300, suffix: "%", label: "More Leads", icon: "🎯" },
  { value: 50, suffix: "%", label: "Cost Reduction", icon: "💰" },
  { value: 24, suffix: "/7", label: "AI Coverage", icon: "🤖" },
  { value: 10, suffix: "x", label: "Faster Response", icon: "⚡" },
];

export const StatsScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 48,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          marginBottom: 60,
          textAlign: "center",
          letterSpacing: "-1px",
          opacity: interpolate(frame, [0, 12], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Real{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Results
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 40,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {stats.map((stat, i) => {
          const delay = 8 + i * 8;
          const statOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateRight: "clamp",
          });
          const statScale = interpolate(
            frame,
            [delay, delay + 10],
            [0.8, 1],
            { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) }
          );
          const counterProgress = interpolate(
            frame,
            [delay, delay + 25],
            [0, 1],
            { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
          );
          const displayValue = Math.round(stat.value * counterProgress);

          return (
            <div
              key={i}
              style={{
                opacity: statOpacity,
                transform: `scale(${statScale})`,
                textAlign: "center",
                padding: "36px 40px",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.06)",
                minWidth: 200,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>{stat.icon}</div>
              <div
                style={{
                  fontSize: 64,
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  background: gradient,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  lineHeight: 1,
                }}
              >
                {displayValue}
                {stat.suffix}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontFamily: fonts.body,
                  color: colors.muted,
                  marginTop: 12,
                  textTransform: "uppercase",
                  letterSpacing: 2,
                  fontWeight: 500,
                }}
              >
                {stat.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
