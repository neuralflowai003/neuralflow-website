import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const messages = [
  { role: "user", text: "Hi, I need help with my business" },
  {
    role: "aria",
    text: "Hey! I'm ARIA, NeuralFlow's AI assistant. I'd love to help you grow. What's your biggest challenge right now?",
  },
  { role: "user", text: "I'm not getting enough leads from my website" },
  {
    role: "aria",
    text: "I can help with that! Let me book you a free strategy call with Danny to discuss AI automation + SEO for lead generation. What time works for you?",
  },
];

export const AriaScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], {
    extrapolateRight: "clamp",
  });

  // Chat window slide in
  const windowY = interpolate(frame, [0, 15], [60, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "column",
        opacity: fadeIn * fadeOut,
        backgroundColor: colors.bg,
      }}
    >
      {/* Title */}
      <div
        style={{
          fontSize: 44,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          marginBottom: 40,
          textAlign: "center",
        }}
      >
        Meet{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          ARIA
        </span>{" "}
        — Your AI Receptionist
      </div>

      {/* Chat window */}
      <div
        style={{
          width: 700,
          background: "#0a0a14",
          borderRadius: 20,
          border: `1px solid ${colors.border}`,
          overflow: "hidden",
          transform: `translateY(${windowY}px)`,
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(255,107,43,0.1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            background: "linear-gradient(135deg, rgba(255,107,43,0.15), rgba(123,97,255,0.15))",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#22c55e",
            }}
          />
          <span
            style={{
              fontSize: 16,
              fontFamily: fonts.heading,
              fontWeight: 600,
              color: colors.white,
            }}
          >
            ARIA — NeuralFlow AI
          </span>
        </div>

        {/* Messages */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {messages.map((msg, i) => {
            const msgDelay = 10 + i * 18;
            const msgOpacity = interpolate(
              frame,
              [msgDelay, msgDelay + 10],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            const msgY = interpolate(
              frame,
              [msgDelay, msgDelay + 10],
              [20, 0],
              { extrapolateRight: "clamp" }
            );
            const isAria = msg.role === "aria";

            return (
              <div
                key={i}
                style={{
                  opacity: msgOpacity,
                  transform: `translateY(${msgY}px)`,
                  display: "flex",
                  justifyContent: isAria ? "flex-start" : "flex-end",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "14px 20px",
                    borderRadius: isAria
                      ? "4px 16px 16px 16px"
                      : "16px 4px 16px 16px",
                    background: isAria
                      ? "rgba(255,255,255,0.06)"
                      : "linear-gradient(135deg, rgba(255,107,43,0.2), rgba(123,97,255,0.2))",
                    border: `1px solid ${isAria ? colors.border : "rgba(255,107,43,0.2)"}`,
                    fontSize: 15,
                    fontFamily: fonts.body,
                    color: isAria ? colors.white : "#e0e0e0",
                    lineHeight: 1.5,
                  }}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
