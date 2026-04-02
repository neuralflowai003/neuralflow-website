import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, fullCenter, gradient } from "../styles";

const beforeResults = [
  { title: "Some Random Directory", url: "randomsite.com", rank: "Page 3" },
  { title: "Your Business Name", url: "yourbusiness.com", rank: "#27" },
];

const afterResults = [
  {
    title: "Your Business — #1 Rated in Your City",
    url: "yourbusiness.com",
    rank: "#1",
    featured: true,
  },
  {
    title: "Your Business — Services & Reviews",
    url: "yourbusiness.com/services",
    rank: "#2",
    featured: false,
  },
];

export const SeoScene: React.FC = () => {
  const frame = useCurrentFrame();

  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [75, 90], [1, 0], {
    extrapolateRight: "clamp",
  });

  // Toggle between before/after
  const showAfter = frame > 40;
  const transitionProgress = interpolate(frame, [38, 48], [0, 1], {
    extrapolateLeft: "clamp",
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
        SEO That{" "}
        <span
          style={{
            background: gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Actually Works
        </span>
      </div>

      {/* Before / After labels */}
      <div
        style={{
          display: "flex",
          gap: 80,
          marginBottom: 30,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontFamily: fonts.heading,
            fontWeight: 600,
            color: showAfter ? colors.gray : colors.orange,
            opacity: showAfter ? 0.5 : 1,
            transition: "all 0.3s",
          }}
        >
          BEFORE NeuralFlow
        </div>
        <div
          style={{
            fontSize: 22,
            fontFamily: fonts.heading,
            fontWeight: 600,
            color: showAfter ? colors.orange : colors.gray,
            opacity: showAfter ? 1 : 0.5,
          }}
        >
          AFTER NeuralFlow
        </div>
      </div>

      {/* Search results mockup */}
      <div
        style={{
          width: 800,
          background: "#0a0a14",
          borderRadius: 16,
          border: `1px solid ${colors.border}`,
          padding: 32,
          boxShadow: showAfter
            ? "0 0 40px rgba(255,107,43,0.15)"
            : "0 20px 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Search bar */}
        <div
          style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: 30,
            padding: "14px 24px",
            marginBottom: 28,
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: `1px solid ${colors.border}`,
          }}
        >
          <span style={{ fontSize: 20 }}>🔍</span>
          <span
            style={{
              fontSize: 16,
              fontFamily: fonts.body,
              color: colors.white,
            }}
          >
            best {showAfter ? "[your service]" : "[your service]"} near me
          </span>
        </div>

        {/* Results */}
        {(showAfter ? afterResults : beforeResults).map((result, i) => {
          const resultOpacity = showAfter
            ? interpolate(frame, [42 + i * 6, 48 + i * 6], [0, 1], {
                extrapolateRight: "clamp",
              })
            : interpolate(frame, [8 + i * 8, 16 + i * 8], [0, 1], {
                extrapolateRight: "clamp",
              });

          return (
            <div
              key={`${showAfter}-${i}`}
              style={{
                opacity: resultOpacity,
                padding: "16px 0",
                borderBottom:
                  i < (showAfter ? afterResults : beforeResults).length - 1
                    ? `1px solid ${colors.border}`
                    : "none",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontFamily: fonts.body,
                  color: colors.gray,
                  marginBottom: 4,
                }}
              >
                {result.url}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  color:
                    "featured" in result && result.featured
                      ? colors.orange
                      : "#6ea8fe",
                  marginBottom: 4,
                }}
              >
                {result.title}
              </div>
              <div
                style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 13,
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  background:
                    "featured" in result && result.featured
                      ? "rgba(255,107,43,0.15)"
                      : "rgba(255,255,255,0.06)",
                  color:
                    "featured" in result && result.featured
                      ? colors.orange
                      : colors.gray,
                }}
              >
                Rank: {result.rank}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
