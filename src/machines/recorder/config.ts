export const VISUALIZER_CONFIG = {
  height: 24,

  // Analyzer configuration
  analyzer: {
    fftSize: 2048,
    smoothingTimeConstant: 0.75,
    minDecibels: -120,
    maxDecibels: 0,
    defaultValue: -100,
  },

  // Visualization settings
  bars: {
    count: 32, // Number of bars to show
    spacing: 2, // Spacing between bars in pixels
    width: 1, // Width of each bar in pixels
  },

  // Calculate total width based on bars configuration
  get width() {
    return (
      this.bars.width * this.bars.count +
      this.bars.spacing * (this.bars.count - 1)
    );
  },

  // Colors for the gradient (using Tailwind colors)
  colors: {
    background: "white",
    gradient: ["#000000", "#636363", "#636363", "#000000"],
  },
} as const;
