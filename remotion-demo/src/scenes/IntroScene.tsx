import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Phase 1: Lines sweep in (0-30)
  const lineWidth = interpolate(frame, [5, 35], [0, 100], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Phase 2: Logo scales up from center (15-50)
  const logoScale = interpolate(frame, [15, 50], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.back(1.2)),
  });
  const logoOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Phase 3: Text reveals (40-70)
  const nameOpacity = interpolate(frame, [40, 55], [0, 1], {
    extrapolateRight: "clamp",
  });
  const nameX = interpolate(frame, [40, 55], [-40, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const taglineOpacity = interpolate(frame, [55, 75], [0, 1], {
    extrapolateRight: "clamp",
  });
  const taglineY = interpolate(frame, [55, 75], [20, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // Glow pulse
  const glow = interpolate(Math.sin(frame * 0.08), [-1, 1], [15, 50]);

  // Fade out
  const fadeOut = interpolate(frame, [100, 120], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scan line effect
  const scanY = interpolate(frame, [0, 120], [-10, 110], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ ...fullCenter, flexDirection: "column", opacity: fadeOut }}
    >
      {/* Horizontal accent lines */}
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: `${50 - lineWidth / 2}%`,
          width: `${lineWidth}%`,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${colors.orange}40, transparent)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "62%",
          left: `${50 - lineWidth / 2}%`,
          width: `${lineWidth}%`,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${colors.purple}40, transparent)`,
        }}
      />

      {/* Scan line */}
      <div
        style={{
          position: "absolute",
          top: `${scanY}%`,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent 20%, ${colors.orange}15 50%, transparent 80%)`,
        }}
      />

      {/* Logo icon */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
          marginBottom: 40,
        }}
      >
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 32,
            background: gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 ${glow}px rgba(255, 107, 43, 0.5), 0 0 ${glow * 2}px rgba(123, 97, 255, 0.25), inset 0 1px 0 rgba(255,255,255,0.15)`,
          }}
        >
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <path
              d="M15 55 L27 18 L40 40 L53 12 L65 55"
              stroke="white"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={200}
              strokeDashoffset={interpolate(frame, [20, 50], [200, 0], {
                extrapolateRight: "clamp",
              })}
            />
            {[
              { cx: 27, cy: 18, delay: 30 },
              { cx: 40, cy: 40, delay: 36 },
              { cx: 53, cy: 12, delay: 42 },
            ].map((dot) => (
              <circle
                key={dot.cx}
                cx={dot.cx}
                cy={dot.cy}
                r={interpolate(frame, [dot.delay, dot.delay + 8], [0, 5], {
                  extrapolateRight: "clamp",
                })}
                fill="white"
                opacity={interpolate(frame, [dot.delay, dot.delay + 8], [0, 1], {
                  extrapolateRight: "clamp",
                })}
              />
            ))}
          </svg>
        </div>
      </div>

      {/* Company name */}
      <div
        style={{
          fontSize: 80,
          fontFamily: fonts.heading,
          fontWeight: 700,
          color: colors.white,
          opacity: nameOpacity,
          transform: `translateX(${nameX}px)`,
          letterSpacing: "-2px",
          lineHeight: 1,
        }}
      >
        <span style={{ color: colors.orange }}>Neural</span>
        <span>Flow</span>
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginLeft: 16,
            fontSize: 54,
            fontWeight: 600,
          }}
        >
          AI
        </span>
      </div>

      {/* Tagline with letter spacing animation */}
      <div
        style={{
          fontSize: 22,
          fontFamily: fonts.body,
          color: colors.gray,
          opacity: taglineOpacity,
          transform: `translateY(${taglineY}px)`,
          marginTop: 20,
          letterSpacing: interpolate(frame, [55, 80], [12, 6], {
            extrapolateRight: "clamp",
          }),
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        Your AI Growth Partner
      </div>
    </AbsoluteFill>
  );
};
