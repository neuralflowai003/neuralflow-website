import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, glassCard, gradient } from "../styles";

const services = [
  { icon: "🤖", title: "AI Chatbots & Agents", desc: "24/7 lead capture, booking, and customer support", color: "#FF6B2B" },
  { icon: "📈", title: "SEO & Search", desc: "Rank #1 on Google and dominate local search", color: "#7B61FF" },
  { icon: "⚡", title: "Workflow Automation", desc: "Eliminate repetitive tasks, save 20+ hrs/week", color: "#22c55e" },
  { icon: "🎯", title: "Lead Generation", desc: "Qualified leads on autopilot, straight to your CRM", color: "#FF6B2B" },
  { icon: "📊", title: "AI Analytics", desc: "Real-time insights that drive smarter decisions", color: "#7B61FF" },
  { icon: "🔧", title: "Custom AI Solutions", desc: "Bespoke AI systems built for your exact needs", color: "#22c55e" },
];

export const ServicesScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 15], [-25, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeOut,
        padding: "40px 100px",
      }}
    >
      {/* Section label */}
      <div
        style={{
          fontSize: 13,
          fontFamily: fonts.body,
          fontWeight: 600,
          color: colors.orange,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: titleOpacity,
          marginBottom: 16,
        }}
      >
        What We Do
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 56,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginBottom: 50,
          textAlign: "center",
          letterSpacing: "-1px",
        }}
      >
        Everything You Need to{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Scale
        </span>
      </div>

      {/* Services grid — 3x2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          maxWidth: 1200,
          width: "100%",
        }}
      >
        {services.map((service, i) => {
          const delay = 18 + i * 10;
          const cardOpacity = interpolate(frame, [delay, delay + 12], [0, 1], {
            extrapolateRight: "clamp",
          });
          const cardY = interpolate(frame, [delay, delay + 12], [30, 0], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });

          // Glow border on hover simulation
          const isHighlighted = frame > delay + 20 && frame < delay + 50;

          return (
            <div
              key={i}
              style={{
                ...glassCard,
                padding: "28px 32px",
                opacity: cardOpacity,
                transform: `translateY(${cardY}px)`,
                borderColor: isHighlighted
                  ? `${service.color}40`
                  : "rgba(255,255,255,0.06)",
                boxShadow: isHighlighted
                  ? `0 0 30px ${service.color}15, inset 0 1px 0 rgba(255,255,255,0.05)`
                  : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <span style={{ fontSize: 36 }}>{service.icon}</span>
                <div
                  style={{
                    fontSize: 20,
                    fontFamily: fonts.heading,
                    fontWeight: 600,
                    color: colors.white,
                  }}
                >
                  {service.title}
                </div>
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontFamily: fonts.body,
                  color: colors.gray,
                  lineHeight: 1.5,
                }}
              >
                {service.desc}
              </div>
              {/* Bottom accent line */}
              <div
                style={{
                  marginTop: 16,
                  height: 2,
                  borderRadius: 1,
                  width: interpolate(
                    frame,
                    [delay + 12, delay + 25],
                    [0, 100],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                  ),
                  background: `linear-gradient(90deg, ${service.color}, transparent)`,
                  opacity: 0.5,
                }}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
