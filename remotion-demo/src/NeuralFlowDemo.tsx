import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { HeroScene } from "./scenes/HeroScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { ServicesScene } from "./scenes/ServicesScene";
import { AriaScene } from "./scenes/AriaScene";
import { SeoScene } from "./scenes/SeoScene";
import { ProcessScene } from "./scenes/ProcessScene";
import { StatsScene } from "./scenes/StatsScene";
import { TestimonialsScene } from "./scenes/TestimonialsScene";
import { CtaScene } from "./scenes/CtaScene";

// 40 seconds @ 30fps = 1200 frames
export const NeuralFlowDemo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: "#050508", overflow: "hidden" }}>
      {/* Persistent animated gradient bg */}
      <AnimatedBackground frame={frame} />

      {/* Scene 1: Cinematic logo intro (0-4s) */}
      <Sequence from={0} durationInFrames={120}>
        <IntroScene />
      </Sequence>

      {/* Scene 2: Hero headlines (4-8s) */}
      <Sequence from={120} durationInFrames={120}>
        <HeroScene />
      </Sequence>

      {/* Scene 3: Problem agitation (8-12s) */}
      <Sequence from={240} durationInFrames={120}>
        <ProblemScene />
      </Sequence>

      {/* Scene 4: Services showcase (12-17s) */}
      <Sequence from={360} durationInFrames={150}>
        <ServicesScene />
      </Sequence>

      {/* Scene 5: ARIA chatbot demo (17-22s) */}
      <Sequence from={510} durationInFrames={150}>
        <AriaScene />
      </Sequence>

      {/* Scene 6: SEO before/after (22-27s) */}
      <Sequence from={660} durationInFrames={150}>
        <SeoScene />
      </Sequence>

      {/* Scene 7: Process / How it works (27-31s) */}
      <Sequence from={810} durationInFrames={120}>
        <ProcessScene />
      </Sequence>

      {/* Scene 8: Stats counter (31-34s) */}
      <Sequence from={930} durationInFrames={90}>
        <StatsScene />
      </Sequence>

      {/* Scene 9: Testimonial (34-37s) */}
      <Sequence from={1020} durationInFrames={90}>
        <TestimonialsScene />
      </Sequence>

      {/* Scene 10: CTA outro (37-40s) */}
      <Sequence from={1110} durationInFrames={90}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
};

// Persistent moving gradient orbs behind everything
const AnimatedBackground: React.FC<{ frame: number }> = ({ frame }) => {
  const orbX1 = interpolate(Math.sin(frame * 0.008), [-1, 1], [10, 40]);
  const orbY1 = interpolate(Math.cos(frame * 0.006), [-1, 1], [10, 50]);
  const orbX2 = interpolate(Math.sin(frame * 0.01 + 2), [-1, 1], [55, 90]);
  const orbY2 = interpolate(Math.cos(frame * 0.007 + 1), [-1, 1], [40, 85]);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: `${orbX1}%`,
          top: `${orbY1}%`,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,107,43,0.08), transparent 70%)",
          filter: "blur(100px)",
          transform: "translate(-50%, -50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${orbX2}%`,
          top: `${orbY2}%`,
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123,97,255,0.06), transparent 70%)",
          filter: "blur(100px)",
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Subtle noise grain overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`,
          opacity: 0.4,
        }}
      />
    </>
  );
};
