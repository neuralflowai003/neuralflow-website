import { Composition } from "remotion";
import { NeuralFlowDemo } from "./NeuralFlowDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NeuralFlowDemo"
        component={NeuralFlowDemo}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
