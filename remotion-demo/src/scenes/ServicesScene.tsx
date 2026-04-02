import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, glassCard, gradient } from "../styles";

const services = [
  { icon: "🤖", title: "AI Chatbots", desc: "24/7 lead capture & booking" },
  { icon: "📈", title: "SEO Growth", desc: "Rank #1 on Google" },
  { icon: "⚡", title: "Automation", desc: "Eliminate manual workflows" },
  { icon: "🎯", title: "Lead Gen", desc: "Qualified leads on autopilot" },
  { icon: "📊", title: "Analytics", desc: "Data-driven decisions" },
  { icon: "🔧", title: "Custom AI", desc: "Built for your business" },
];

export const ServicesScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 15], [-30, 0], {
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
        opacity: fadeOut,
        backgroundColor: colors.bg,
        padding: "60px 120px",
      }}
    >
      {/* Section title */}
      <div
        style={{
          fontSize: 52,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 60,
          textAlign: "center",
        }}
      >
        What We{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Build For You
        </span>
      </div>

      {/* Services grid */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          justifyContent: "center",
          maxWidth: 1200,
        }}
      >
        {services.map((service, i) => {
          const delay = 15 + i * 8;
          const cardOpacity = interpolate(frame, [delay, delay + 15], [0, 1], {
            extrapolateRight: "clamp",
          });
          const cardY = interpolate(frame, [delay, delay + 15], [40, 0], {
            extrapolateRight: "clamp",
          });
          const cardScale = interpolate(
            frame,
            [delay, delay + 15],
            [0.9, 1],
            { extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                ...glassCard,
                width: 340,
                opacity: cardOpacity,
                transform: `translateY(${cardY}px) scale(${cardScale})`,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>{service.icon}</div>
              <div
                style={{
                  fontSize: 24,
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  color: colors.white,
                  marginBottom: 8,
                }}
              >
                {service.title}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontFamily: fonts.body,
                  color: colors.gray,
                }}
              >
                {service.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
