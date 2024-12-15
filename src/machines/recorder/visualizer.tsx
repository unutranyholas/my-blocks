
import { useEffect, useRef } from "react";
import { VISUALIZER_CONFIG } from "./config";

interface AudioVisualizerProps {
  dataArray: Float32Array | null; // Frequency data from analyzer
  isRecording: boolean; // Whether we're currently recording
  isPaused?: boolean; // Whether recording is paused
}

export function AudioVisualizer({
  dataArray,
  isRecording,
  isPaused = false,
}: AudioVisualizerProps) {
  // Refs to store canvas and animation frame references
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Get canvas and context
    const canvas = canvasRef.current;
    if (!canvas || !dataArray) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      // Handle pause state - stop animation but keep last frame
      if (isPaused) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }
        return;
      }

      // Handle stop state - clear canvas and stop animation
      if (!isRecording) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }
        ctx.fillStyle = VISUALIZER_CONFIG.colors.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Handle high DPI displays
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      // Set physical canvas size to match display size * device pixel ratio
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      // Clear canvas with background color
      ctx.fillStyle = VISUALIZER_CONFIG.colors.background;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Summarize frequencies into fewer bars
      const frequencies = summarizeFrequencies(
        dataArray,
        VISUALIZER_CONFIG.bars.count,
      );

      // Calculate bar width to fill available space
      const totalSpacing =
        VISUALIZER_CONFIG.bars.spacing * (frequencies.length - 1);

      const barWidth = Math.round(
        (rect.width - totalSpacing) / frequencies.length,
      );

      let x = 0;

      // Draw the summarized frequencies
      for (let i = 0; i < frequencies.length; i++) {
        // Add a minimum height threshold and better scaling
        const normalizedValue =
          (frequencies[i] - VISUALIZER_CONFIG.analyzer.minDecibels) /
          (VISUALIZER_CONFIG.analyzer.maxDecibels -
            VISUALIZER_CONFIG.analyzer.minDecibels);

        const barHeight = Math.max(
          1, // Minimum height of 1px
          Math.round(normalizedValue * (rect.height / 2)),
        );

        // Create gradient for current bar
        const gradient = ctx.createLinearGradient(
          0,
          rect.height / 2 - barHeight,
          0,
          rect.height / 2 + barHeight,
        );
        VISUALIZER_CONFIG.colors.gradient.forEach((color, index) => {
          gradient.addColorStop(
            index / (VISUALIZER_CONFIG.colors.gradient.length - 1),
            color,
          );
        });

        // Draw the bar centered vertically
        ctx.fillStyle = gradient;
        ctx.fillRect(x, rect.height / 2 - barHeight, barWidth, barHeight * 2);

        // Move to next bar position
        x += barWidth + VISUALIZER_CONFIG.bars.spacing;
      }

      // Schedule next frame
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    // Start animation if recording
    if (isRecording) {
      draw();
    }

    // Cleanup function to cancel animation when component unmounts
    // or when dependencies change
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dataArray, isRecording, isPaused]);

  return (
    <canvas
      ref={canvasRef}
      className={"bg-white"}
      style={{
        width: `${VISUALIZER_CONFIG.width}px`,
        height: `${VISUALIZER_CONFIG.height}px`,
      }}
      aria-label="Audio frequency visualization"
    />
  );
}

// Add this helper function inside the component
function summarizeFrequencies(
  dataArray: Float32Array,
  numBars: number,
): number[] {
  // Focus on the first quarter of frequencies where most action happens
  const meaningfulRange = Math.floor(dataArray.length * 0.25); // Use only first 25%
  const bucketSize = Math.floor(meaningfulRange / numBars);
  const summary = new Array(numBars).fill(0);

  for (let i = 0; i < numBars; i++) {
    let sum = 0;
    const startIndex = i * bucketSize;
    const endIndex = startIndex + bucketSize;

    // Average the frequencies in this bucket
    for (let j = startIndex; j < endIndex; j++) {
      sum += dataArray[j];
    }
    summary[i] = sum / bucketSize;
  }

  return summary;
}

