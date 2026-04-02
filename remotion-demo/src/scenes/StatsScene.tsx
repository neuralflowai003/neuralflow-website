import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const stats = [
  { value: 300, suffix: "%", label: "More Leads" },
  { value: 50, suffix: "%", label: "Cost Reduction" },
  { value: 24, suffix: "/7", label: "AI Coverage" },
  { value: 10, suffix: "x", label: "Faster Response" },
];

export const StatsScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [35, 45], [1, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        opacity: fadeIn * fadeOut,
        backgroundColor: colors.bg,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 60,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {stats.map((stat, i) => {
          const delay = 5 + i * 5;
          const statOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {
            extrapolateRight: "clamp",
          });
          const statScale = interpolate(
            frame,
            [delay, delay + 10],
            [0.7, 1],
            { extrapolateRight: "clamp" }
          );
          const counterProgress = interpolate(
            frame,
            [delay, delay + 20],
            [0, 1],
            { extrapolateRight: "clamp" }
          );
          const displayValue = Math.round(stat.value * counterProgress);

          return (
            <div
              key={i}
              style={{
                opacity: statOpacity,
                transform: `scale(${statScale})`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 72,
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
                  fontSize: 18,
                  fontFamily: fonts.body,
                  color: colors.gray,
                  marginTop: 12,
                  textTransform: "uppercase",
                  letterSpacing: 2,
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
