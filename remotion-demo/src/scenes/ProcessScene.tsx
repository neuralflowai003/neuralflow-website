import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const steps = [
  { num: "01", title: "Discovery Call", desc: "We learn your business, goals, and pain points", icon: "🎯" },
  { num: "02", title: "Custom Strategy", desc: "Tailored AI + SEO roadmap built for your needs", icon: "📋" },
  { num: "03", title: "Build & Launch", desc: "We implement everything — you just approve", icon: "🚀" },
  { num: "04", title: "Scale & Optimize", desc: "Continuous improvement, monthly reporting", icon: "📈" },
];

export const ProcessScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [105, 120], [1, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
        padding: "0 120px",
      }}
    >
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: fonts.body,
            fontWeight: 600,
            color: colors.orange,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 16,
            opacity: interpolate(frame, [0, 12], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          How It Works
        </div>
        <div
          style={{
            fontSize: 52,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            letterSpacing: "-1px",
            opacity: interpolate(frame, [5, 18], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          Simple.{" "}
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Effective.
          </span>{" "}
          Fast.
        </div>
      </div>

      {/* Steps — horizontal timeline */}
      <div
        style={{
          display: "flex",
          gap: 24,
          width: "100%",
          maxWidth: 1200,
          position: "relative",
        }}
      >
        {/* Connecting line */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 60,
            right: 60,
            height: 2,
            background: colors.border,
          }}
        >
          <div
            style={{
              width: `${interpolate(frame, [20, 80], [0, 100], {
                extrapolateRight: "clamp",
                easing: Easing.out(Easing.cubic),
              })}%`,
              height: "100%",
              background: gradient,
              borderRadius: 1,
            }}
          />
        </div>

        {steps.map((step, i) => {
          const delay = 15 + i * 18;
          const stepOpacity = interpolate(frame, [delay, delay + 12], [0, 1], {
            extrapolateRight: "clamp",
          });
          const stepY = interpolate(frame, [delay, delay + 12], [25, 0], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });

          return (
            <div
              key={i}
              style={{
                flex: 1,
                opacity: stepOpacity,
                transform: `translateY(${stepY}px)`,
                textAlign: "center",
              }}
            >
              {/* Step circle */}
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.04)",
                  border: `2px solid ${stepOpacity > 0.5 ? colors.orange : colors.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                  fontSize: 36,
                  boxShadow: stepOpacity > 0.5
                    ? `0 0 20px rgba(255,107,43,0.15)`
                    : "none",
                }}
              >
                {step.icon}
              </div>

              {/* Step number */}
              <div
                style={{
                  fontSize: 13,
                  fontFamily: fonts.mono,
                  color: colors.orange,
                  fontWeight: 600,
                  marginBottom: 8,
                  letterSpacing: 2,
                }}
              >
                STEP {step.num}
              </div>

              {/* Step title */}
              <div
                style={{
                  fontSize: 22,
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  color: colors.white,
                  marginBottom: 8,
                }}
              >
                {step.title}
              </div>

              {/* Step description */}
              <div
                style={{
                  fontSize: 14,
                  fontFamily: fonts.body,
                  color: colors.gray,
                  lineHeight: 1.5,
                }}
              >
                {step.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
