import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const TestimonialsScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], {
    extrapolateRight: "clamp",
  });

  const quoteScale = interpolate(frame, [5, 20], [0.9, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Stars reveal
  const starsWidth = interpolate(frame, [15, 30], [0, 100], {
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
      {/* Big quote marks */}
      <div
        style={{
          fontSize: 120,
          fontFamily: fonts.heading,
          background: gradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          lineHeight: 0.6,
          opacity: 0.3,
          marginBottom: 20,
        }}
      >
        "
      </div>

      {/* Quote */}
      <div
        style={{
          fontSize: 36,
          fontFamily: fonts.heading,
          fontWeight: 500,
          color: colors.white,
          textAlign: "center",
          maxWidth: 900,
          lineHeight: 1.5,
          transform: `scale(${quoteScale})`,
          opacity: interpolate(frame, [8, 22], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        NeuralFlow transformed our business. ARIA books appointments while we
        sleep, and our Google rankings went from page 3 to{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: 700,
          }}
        >
          #1 in 90 days
        </span>
        .
      </div>

      {/* Stars */}
      <div
        style={{
          marginTop: 32,
          display: "flex",
          gap: 8,
          overflow: "hidden",
          width: `${starsWidth}%`,
          maxWidth: 200,
          justifyContent: "center",
        }}
      >
        {[1, 2, 3, 4, 5].map((s) => (
          <span key={s} style={{ fontSize: 28, color: "#fbbf24" }}>
            ★
          </span>
        ))}
      </div>

      {/* Attribution */}
      <div
        style={{
          marginTop: 28,
          textAlign: "center",
          opacity: interpolate(frame, [25, 38], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontFamily: fonts.heading,
            fontWeight: 600,
            color: colors.white,
          }}
        >
          — Local Business Owner
        </div>
        <div
          style={{
            fontSize: 14,
            fontFamily: fonts.body,
            color: colors.muted,
            marginTop: 4,
          }}
        >
          NeuralFlow AI Client
        </div>
      </div>
    </AbsoluteFill>
  );
};
