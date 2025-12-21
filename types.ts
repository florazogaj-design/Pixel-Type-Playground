// A single character is a grid of 0s and 1s (rows x cols)
export type PixelMatrix = number[][];

// The font dictionary maps a character (string) to its matrix
export type PixelFont = Record<string, PixelMatrix>;
