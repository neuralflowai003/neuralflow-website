import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const scale = interpolate(frame, [0, 15], [0.85, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.1)),
  });

  const glowPulse = interpolate(Math.sin(frame * 0.12), [-1, 1], [30, 80]);

  // Button shimmer
  const shimmerX = interpolate(frame, [20, 60], [-100, 200], {
    extrapolateRight: "clamp",
  });

  // URL fade in
  const urlOpacity = interpolate(frame, [25, 38], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Tagline
  const tagOpacity = interpolate(frame, [35, 48], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn,
      }}
    >
      {/* Big gradient burst */}
      <div
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,107,43,0.1), rgba(123,97,255,0.06), transparent 65%)",
          filter: "blur(60px)",
        }}
      />

      <div
        style={{
          transform: `scale(${scale})`,
          textAlign: "center",
          position: "relative",
        }}
      >
        {/* Main headline */}
        <div
          style={{
            fontSize: 72,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            textShadow: `0 0 ${glowPulse}px rgba(255,107,43,0.4), 0 0 ${glowPulse * 1.5}px rgba(123,97,255,0.2)`,
            marginBottom: 16,
            lineHeight: 1.2,
            letterSpacing: "-2px",
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

        {/* Sub text */}
        <div
          style={{
            fontSize: 22,
            fontFamily: fonts.body,
            color: colors.muted,
            marginBottom: 40,
            opacity: urlOpacity,
          }}
        >
          Book your free strategy call today
        </div>

        {/* CTA button with shimmer */}
        <div
          style={{
            display: "inline-block",
            padding: "20px 56px",
            borderRadius: 14,
            background: gradient,
            fontSize: 24,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            boxShadow: `0 0 ${glowPulse * 0.6}px rgba(255,107,43,0.4), 0 20px 40px rgba(0,0,0,0.3)`,
            marginBottom: 36,
            position: "relative",
            overflow: "hidden",
          }}
        >
          Get Your Free Growth Plan
          {/* Shimmer effect */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: `${shimmerX}%`,
              width: 60,
              height: "100%",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
              transform: "skewX(-20deg)",
            }}
          />
        </div>

        {/* URL */}
        <div
          style={{
            fontSize: 32,
            fontFamily: fonts.heading,
            fontWeight: 600,
            color: colors.accent,
            opacity: urlOpacity,
            letterSpacing: 1,
          }}
        >
          neuralflowai.io
        </div>

        {/* Bottom tagline */}
        <div
          style={{
            fontSize: 15,
            fontFamily: fonts.body,
            color: "rgba(255,255,255,0.4)",
            marginTop: 16,
            opacity: tagOpacity,
            letterSpacing: 3,
            textTransform: "uppercase",
          }}
        >
          AI Consulting · SEO · Automation
        </div>
      </div>
    </AbsoluteFill>
  );
};
