import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const messages: Array<{ role: string; text: string; typing?: boolean }> = [
  { role: "aria", text: "Hey! 👋 I'm ARIA, NeuralFlow's AI assistant. How can I help you grow today?" },
  { role: "user", text: "I'm losing leads — nobody answers after 5pm" },
  { role: "aria", text: "That's a huge revenue leak. Our AI chatbot captures leads 24/7 and books appointments directly into your calendar. Want to see how?" },
  { role: "user", text: "Yes! Can we set up a call?" },
  { role: "aria", text: "Absolutely! I've got Danny available Thursday at 2pm ET. I'll book that for you now and send a confirmation email. ✅" },
];

export const AriaScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
    extrapolateRight: "clamp",
  });

  const windowScale = interpolate(frame, [0, 15], [0.9, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        ...fullCenter,
        flexDirection: "row",
        opacity: fadeIn * fadeOut,
        gap: 60,
        padding: "0 100px",
      }}
    >
      {/* Left side — description */}
      <div style={{ flex: "0 0 380px" }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: fonts.body,
            fontWeight: 600,
            color: colors.orange,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 16,
            opacity: interpolate(frame, [5, 15], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          Meet ARIA
        </div>
        <div
          style={{
            fontSize: 48,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            lineHeight: 1.15,
            letterSpacing: "-1px",
            marginBottom: 20,
            opacity: interpolate(frame, [8, 20], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          Your AI
          <br />
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Receptionist
          </span>
        </div>
        <div
          style={{
            fontSize: 18,
            fontFamily: fonts.body,
            color: colors.gray,
            lineHeight: 1.7,
            opacity: interpolate(frame, [15, 28], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          ARIA chats with visitors, qualifies leads, and books appointments
          directly on your calendar — 24/7, no humans needed.
        </div>

        {/* Stats below description */}
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 32,
            opacity: interpolate(frame, [25, 38], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          {[
            { val: "24/7", label: "Availability" },
            { val: "<3s", label: "Response" },
            { val: "85%", label: "Lead Capture" },
          ].map((s, i) => (
            <div key={i}>
              <div
                style={{
                  fontSize: 28,
                  fontFamily: fonts.heading,
                  fontWeight: 700,
                  background: gradient,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {s.val}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: fonts.body,
                  color: colors.gray,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginTop: 4,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right side — chat window */}
      <div
        style={{
          flex: 1,
          maxWidth: 580,
          background: "#0a0a14",
          borderRadius: 24,
          border: `1px solid ${colors.border}`,
          overflow: "hidden",
          transform: `scale(${windowScale})`,
          boxShadow:
            "0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(255,107,43,0.06)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 24px",
            background: "linear-gradient(135deg, rgba(255,107,43,0.1), rgba(123,97,255,0.1))",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.green,
              boxShadow: `0 0 6px ${colors.green}`,
            }}
          />
          <span
            style={{
              fontSize: 14,
              fontFamily: fonts.heading,
              fontWeight: 600,
              color: colors.white,
            }}
          >
            ARIA — Online
          </span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 6 }}>
            {["#ef4444", "#eab308", "#22c55e"].map((c) => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.6 }} />
            ))}
          </div>
        </div>

        {/* Messages */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((msg, i) => {
            const msgDelay = 12 + i * 22;
            const msgOpacity = interpolate(
              frame,
              [msgDelay, msgDelay + 8],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            const msgY = interpolate(
              frame,
              [msgDelay, msgDelay + 8],
              [15, 0],
              { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
            );
            const isAria = msg.role === "aria";

            // Typing indicator before ARIA messages
            const showTyping =
              isAria &&
              frame >= msgDelay - 8 &&
              frame < msgDelay;
            const typingDot = Math.floor((frame * 4) % 3);

            return (
              <div key={i}>
                {/* Typing indicator */}
                {showTyping && (
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                      padding: "10px 16px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: "4px 14px 14px 14px",
                      width: "fit-content",
                      marginBottom: 4,
                    }}
                  >
                    {[0, 1, 2].map((d) => (
                      <div
                        key={d}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: typingDot === d ? colors.orange : colors.gray,
                          opacity: typingDot === d ? 1 : 0.3,
                        }}
                      />
                    ))}
                  </div>
                )}
                {/* Message bubble */}
                <div
                  style={{
                    opacity: msgOpacity,
                    transform: `translateY(${msgY}px)`,
                    display: "flex",
                    justifyContent: isAria ? "flex-start" : "flex-end",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "82%",
                      padding: "12px 18px",
                      borderRadius: isAria
                        ? "4px 16px 16px 16px"
                        : "16px 4px 16px 16px",
                      background: isAria
                        ? "rgba(255,255,255,0.05)"
                        : "linear-gradient(135deg, rgba(255,107,43,0.18), rgba(123,97,255,0.18))",
                      border: `1px solid ${isAria ? "rgba(255,255,255,0.06)" : "rgba(255,107,43,0.15)"}`,
                      fontSize: 14,
                      fontFamily: fonts.body,
                      color: colors.white,
                      lineHeight: 1.5,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
