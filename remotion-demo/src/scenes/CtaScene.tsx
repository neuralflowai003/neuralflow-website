import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, 12], [0.85, 1], {
    extrapolateRight: "clamp",
  });

  const glowPulse = interpolate(Math.sin(frame * 0.15), [-1, 1], [30, 80]);

  const urlOpacity = interpolate(frame, [15, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn,
        backgroundColor: colors.bg,
      }}
    >
      {/* Background gradient burst */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,107,43,0.12), rgba(123,97,255,0.08), transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      <div
        style={{
          transform: `scale(${scale})`,
          textAlign: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: 64,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            textShadow: `0 0 ${glowPulse}px rgba(255,107,43,0.5), 0 0 ${glowPulse * 1.5}px rgba(123,97,255,0.3)`,
            marginBottom: 24,
            lineHeight: 1.2,
          }}
        >
          Ready to{" "}
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Grow
          </span>
          ?
        </div>

        {/* Fake button */}
        <div
          style={{
            display: "inline-block",
            padding: "18px 48px",
            borderRadius: 12,
            background: gradient,
            fontSize: 22,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            boxShadow: `0 0 ${glowPulse * 0.5}px rgba(255,107,43,0.4)`,
            marginBottom: 32,
          }}
        >
          Book Your Free Strategy Call
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: 26,
            fontFamily: fonts.body,
            color: colors.orange,
            opacity: urlOpacity,
            letterSpacing: 1,
          }}
        >
          neuralflowai.io
        </div>
      </div>
    </AbsoluteFill>
  );
};
