import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const SeoScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
    extrapolateRight: "clamp",
  });

  // Before phase: 0-65, After phase: 65+
  const showAfter = frame > 65;
  const flipProgress = interpolate(frame, [60, 75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  // Rank number animation
  const rankNum = showAfter
    ? interpolate(frame, [75, 85], [27, 1], {
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 27;

  // Traffic bar animation
  const trafficBefore = 15;
  const trafficAfter = interpolate(frame, [80, 110], [15, 92], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const traffic = showAfter ? trafficAfter : trafficBefore;

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
      <div style={{ textAlign: "center", marginBottom: 50 }}>
        <div
          style={{
            fontSize: 13,
            fontFamily: fonts.body,
            fontWeight: 600,
            color: colors.accent,
            letterSpacing: 4,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          SEO Results
        </div>
        <div
          style={{
            fontSize: 52,
            fontFamily: fonts.heading,
            fontWeight: 700,
            color: colors.white,
            letterSpacing: "-1px",
          }}
        >
          From Page 3 to{" "}
          <span
            style={{
              background: gradient,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            #1 on Google
          </span>
        </div>
      </div>

      {/* Dashboard mockup */}
      <div
        style={{
          width: "100%",
          maxWidth: 1000,
          background: colors.bgAlt,
          borderRadius: 24,
          border: `1px solid ${colors.border}`,
          padding: 40,
          boxShadow: showAfter
            ? "0 0 60px rgba(255,107,43,0.08)"
            : "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Top metrics row */}
        <div
          style={{
            display: "flex",
            gap: 24,
            marginBottom: 36,
          }}
        >
          {[
            {
              label: "Google Rank",
              value: `#${Math.round(rankNum)}`,
              change: showAfter ? "↑ 26 positions" : "",
              changeColor: colors.green,
            },
            {
              label: "Monthly Traffic",
              value: `${Math.round(traffic * 48)}`,
              change: showAfter ? "+580% increase" : "48 visits/mo",
              changeColor: showAfter ? colors.green : colors.muted,
            },
            {
              label: "Leads/Month",
              value: showAfter
                ? `${Math.round(interpolate(frame, [85, 115], [2, 34], { extrapolateRight: "clamp" }))}`
                : "2",
              change: showAfter ? "+1,600% growth" : "2 leads/mo",
              changeColor: showAfter ? colors.green : colors.muted,
            },
          ].map((metric, i) => {
            const metricOpacity = interpolate(
              frame,
              [8 + i * 8, 16 + i * 8],
              [0, 1],
              { extrapolateRight: "clamp" }
            );

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "24px 28px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 16,
                  border: `1px solid ${colors.border}`,
                  opacity: metricOpacity,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: fonts.body,
                    color: colors.muted,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    marginBottom: 8,
                  }}
                >
                  {metric.label}
                </div>
                <div
                  style={{
                    fontSize: 42,
                    fontFamily: fonts.heading,
                    fontWeight: 700,
                    color: colors.white,
                    lineHeight: 1,
                  }}
                >
                  {metric.value}
                </div>
                {metric.change && (
                  <div
                    style={{
                      fontSize: 13,
                      fontFamily: fonts.body,
                      fontWeight: 600,
                      color: metric.changeColor,
                      marginTop: 8,
                    }}
                  >
                    {metric.change}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Traffic bar chart */}
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 13,
              fontFamily: fonts.body,
              color: colors.muted,
              marginBottom: 16,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Organic Traffic Growth
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 120 }}>
            {Array.from({ length: 12 }, (_, i) => {
              const barDelay = 30 + i * 3;
              const isAfterMonth = i >= 6;
              const barHeight = isAfterMonth && showAfter
                ? interpolate(frame, [75 + (i - 6) * 5, 90 + (i - 6) * 5], [15, 20 + (i - 5) * 15], {
                    extrapolateRight: "clamp",
                  })
                : interpolate(frame, [barDelay, barDelay + 10], [0, 10 + Math.random() * 8], {
                    extrapolateRight: "clamp",
                  });

              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: `${barHeight}%`,
                    background: isAfterMonth && showAfter ? gradient : "rgba(255,255,255,0.08)",
                    borderRadius: "4px 4px 0 0",
                    minHeight: 4,
                  }}
                />
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontSize: 11,
              fontFamily: fonts.mono,
              color: "rgba(255,255,255,0.3)",
            }}
          >
            <span>Jan</span>
            <span>Mar</span>
            <span>Jun</span>
            <span>Sep</span>
            <span>Dec</span>
          </div>
        </div>

        {/* Before/After label */}
        <div
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 16,
            fontFamily: fonts.heading,
            fontWeight: 600,
            color: showAfter ? colors.accent : colors.muted,
          }}
        >
          {showAfter ? "✨ After NeuralFlow SEO" : "Before NeuralFlow"}
        </div>
      </div>
    </AbsoluteFill>
  );
};
