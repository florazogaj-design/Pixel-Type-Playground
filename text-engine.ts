import { PixelMatrix } from './types';
import { PIXEL_FONT, BASE_GRID, GENERATED_CHARS } from './constants';

/**
 * Calculates the geometry and procedural rules for a given character based on variable settings.
 * This is the core "Systematic Rule" engine logic extracted from App.tsx.
 */
export function generateProceduralGlyph(
    char: string,
    weightMod: number,
    heightMod: number
): PixelMatrix | null {
    
    // Base Logic: 6x11 grid, expanded or contracted by modifiers
    const baseW = BASE_GRID.cols;
    const baseH = BASE_GRID.rows;
    
    // Mathematical rules for dimensions (Variable Typography Logic)
    const w = Math.max(4, Math.round(baseW + weightMod)); 
    const h = Math.max(5, Math.round(baseH + heightMod));
    
    const mx = Math.floor((w - 1) / 2);
    const my = Math.floor(h / 2); 
    const lastX = w - 1;
    const lastY = h - 1;
    
    const matrix: PixelMatrix = [];

    // Procedural Construction Rules - Standardized Algorithms
    for (let y = 0; y < h; y++) {
        const row: number[] = [];
        for (let x = 0; x < w; x++) {
            let val = 0;
            switch (char) {
                case 'A':
                    if (y === 0) val = (x > 0 && x < lastX) ? 1 : 0;
                    else if (y === 1) val = (x === 0 || x >= lastX - 1) ? 1 : 0;
                    else if (y === my) val = (x === 0 || x >= 2) ? 1 : 0;
                    else if (y === my + 1) val = (x <= 1 || x === lastX) ? 1 : 0;
                    else val = (x === 0 || x === lastX) ? 1 : 0;
                    break;
                case 'B':
                    if (x === 0) val = 1;
                    else if (x === lastX) {
                        if (y !== 0 && y !== lastY && y !== my) val = 1;
                    }
                    else if (y === 0 || y === lastY) {
                        if (x < lastX) val = 1;
                    }
                    else if (y === my) {
                        if (x > 1 && x < lastX) val = 1;
                    }
                    if (x === lastX - 1 && (y === 1 || y === lastY - 1)) val = 1;
                    if (x === 1 && y === my + 1) val = 1;
                    break;
                case 'C':
                    if (x === 0) {
                        if (y > 0 && y < lastY) val = 1;
                    }
                    else if (y === 0 || y === lastY) {
                        if (x > 0 && x < lastX) val = 1;
                    }
                    else if (x === lastX) {
                        if (y > 0 && y < lastY) {
                            if (Math.abs(y - my) > 1) val = 1;
                        }
                    }
                    if (x === lastX - 1 && (y === 1 || y === lastY - 1)) val = 1;
                    break;
                case 'D':
                    if (x === 0) val = 1;
                    else if (y === 0 || y === lastY) {
                        if (x < lastX) val = 1;
                    }
                    else if (x === lastX) {
                        if (y > 0 && y < lastY) val = 1;
                    }
                    if (x === lastX - 1 && (y === 1 || y === lastY - 1)) val = 1;
                    break;
                case 'E':
                    if (y === 0 || y === lastY) val = (x > 0) ? 1 : 0;
                    else if (x === 0) val = (y > 0 && y < lastY) ? 1 : 0;
                    else if (y === 1 || y === lastY - 1) val = (x === 1) ? 1 : 0;
                    else if (y === my) val = (x === 0 || x > 1) ? 1 : 0;
                    else if (y === my + 1) val = (x === 0 || x === 1) ? 1 : 0;
                    break;
                case 'F':
                    if (y === 0) val = (x > 0) ? 1 : 0;
                    else if (x === 0) val = (y > 0) ? 1 : 0;
                    else if (y === 1) val = (x === 1) ? 1 : 0;
                    else if (y === my) val = (x === 0 || x > 1) ? 1 : 0;
                    else if (y === my + 1) val = (x === 0 || x === 1) ? 1 : 0;
                    break;
                case 'G':
                    if ((y === 0 || y === lastY) && x > 0 && x < lastX) val = 1;
                    else if (x === 0 && y > 0 && y < lastY) val = 1;
                    else if (x === lastX && y > 0 && y < lastY && y !== my - 1) val = 1;
                    else if (y === my && x > 1) val = 1;
                    
                    if (y === 1 && x === lastX - 1) val = 1;
                    if (y === lastY - 1 && x === 1) val = 1;
                    break;
                case 'H':
                    if (x === 0 || x === lastX) val = 1;
                    else if (y === my) val = (x > 1) ? 1 : 0;
                    else if (y === my + 1) val = (x === 1) ? 1 : 0;
                    break;
                case 'I':
                    if (y === 0 || y === lastY) val = 1;
                    else if (y === 1 || y === lastY - 1) {
                        if (x === mx + 1) val = 1;
                    }
                    else {
                        if (x === mx) val = 1;
                    }
                    break;
                case 'J':
                    if (y === 0) val = 1;
                    else if (x === lastX) {
                        if (y < lastY) val = 1;
                    }
                    else if (y === lastY) {
                        if (x > 0 && x < lastX) val = 1;
                    }
                    else if (x === 0) {
                        if (y >= lastY - 3 && y < lastY) val = 1;
                    }
                    else if (x === 1) {
                        if (y === lastY - 1) val = 1;
                    }
                    break;
                case 'K':
                    if (x === 0) val = 1; // Stem
                    const ky = Math.floor(h * 0.55);
                    const kx = 1;
                    
                    if (y < ky) {
                        const ratio = y / ky;
                        const tx = Math.round(lastX - (lastX - kx) * ratio);
                        if (x === tx) val = 1;
                    } else {
                        const ratio = (y - ky) / (lastY - ky);
                        const tx = Math.round(kx + (lastX - kx) * ratio);
                        if (x === tx) val = 1;
                    }
                    if (y === ky && x === kx) val = 1;
                    break;
                case 'L':
                    if (x === 0) val = (y < lastY - 1) ? 1 : 0;
                    else if (y === lastY) val = (x > 0) ? 1 : 0;
                    if (y === lastY - 1 && x <= 1) val = 1;
                    break;
                case 'M':
                    if (x === 0 || x === lastX) val = 1;
                    else if (y >= 2 && y < lastY) {
                        if (x === mx) val = 1;
                    } else if (y < 2) {
                        if (Math.abs(x - mx) === (2 - y)) val = 1;
                    }
                    break;
                case 'N':
                    if (x === 0 || x === lastX) val = 1;
                    else if (y > 0 && y < lastY - 1) {
                        const diagFactor = (w - 3) / (h - 4);
                        const targetX = 1 + Math.round((y - 1) * diagFactor);
                        if (x === targetX) val = 1;
                    }
                    break;
                case 'O':
                    if (x === 0 || x === lastX) val = (y > 1 && y < lastY - 1) ? 1 : 0;
                    else if (y === 0 || y === lastY) val = (x > 0 && x < lastX) ? 1 : 0;
                    if ((y === 1 || y === lastY - 1) && (x === 0 || x === lastX)) val = 1;
                    if (y === 1 && x === 1) val = 1;
                    if (y === lastY - 1 && x === lastX - 1) val = 1;
                    if (y === 1 && x === 0) val = 1;
                    if (y === lastY - 1 && x === lastX) val = 1;
                    if (y === 1 && x === lastX) val = 1;
                    if (y === lastY - 1 && x === 0) val = 1;
                    break;
                case 'P':
                    if (y === 0) val = (x > 0 && x < lastX) ? 1 : 0;
                    else if (x === 0) val = (y > 0) ? 1 : 0;
                    else if (x === lastX) val = (y > 0 && y < my) ? 1 : 0;
                    else if (y === my) val = (x > 1 && x < lastX) ? 1 : 0;
                    
                    if (y === 1 && x === 1) val = 1;
                    if (y === my + 1 && x === 1) val = 1;
                    break;
                case 'Q':
                    const qTail = (x - y === lastX - lastY) && x >= mx;
                    if (qTail) {
                        val = 1;
                    } else {
                        if (x === 0 && y > 0 && y < lastY) val = 1;
                        if (x === lastX && y > 0 && y < lastY) {
                            if (y !== lastY - 1) val = 1;
                        }
                        if (y === 0 && x > 0 && x < lastX) val = 1;
                        if (y === lastY && x > 0 && x < lastX) {
                            if (x !== lastX - 1) val = 1;
                        }
                        if (x === 1 && y === 1) val = 1;
                    }
                    break;
                case 'R':
                    if (x === 0 && y > 0) val = 1;
                    if (y === 0 && x > 0 && x < lastX) val = 1;
                    if (y === my && x > 0 && x < lastX) val = 1;
                    if (x === lastX && y > 0 && y < my) val = 1;
                    if (x === 1 && y === 1) val = 1;
                    if (y > my && (y - x === lastY - lastX)) val = 1;
                    break;
                case 'S':
                    if (y === 0 || y === lastY || y === my) val = (x > 0 && x < lastX) ? 1 : 0;
                    else if (x === 0) {
                        if (y > 0 && y < my) val = 1;
                        if (y > my + 1 && y < lastY) val = 1;
                    }
                    else if (x === lastX) {
                        if (y > 0 && y < my - 1) val = 1;
                        if (y > my && y < lastY) val = 1;
                    }
                    
                    if (y === 1 && x === lastX - 1) val = 1;
                    if (y === lastY - 1 && x === 1) val = 1;
                    break;
                case 'T':
                    if (y === 0) val = 1;
                    else if (y === 1) val = (x === mx + 1) ? 1 : 0;
                    else val = (x === mx) ? 1 : 0;
                    break;
                case 'U':
                    if (x === 0 || x === lastX) val = (y < lastY - 1) ? 1 : 0;
                    else if (y === lastY) val = (x > 0 && x < lastX) ? 1 : 0;
                    if (y === lastY - 1 && (x === 0 || x === lastX || x === lastX - 1)) val = 1;
                    break;
                case 'V': {
                    let lx = 0;
                    if (y === lastY) lx = Math.max(0, mx - 1);
                    let rx = Math.min(lastX, mx + (lastY - y));
                    
                    if (x === lx || x === rx) val = 1;
                    
                    if (weightMod > 6) {
                        const fillHeight = Math.floor((weightMod - 4) / 2);
                        if (y > lastY - fillHeight) {
                            if (x > lx && x < rx) val = 1;
                        }
                    }
                    break;
                }
                case 'W':
                    if (x === 0 || x === lastX) val = 1;
                    else if (y <= lastY - 2) {
                        if (x === mx) val = 1;
                    } else {
                        const offset = y - (lastY - 2);
                        if (Math.abs(x - mx) === offset) val = 1;
                    }
                    break;
                case 'X':
                    // Floor/Ceil logic to match the specific asymmetric stepping of the default font
                    const xL = Math.floor((y / lastY) * lastX);
                    const xR = lastX - Math.ceil((y / lastY) * lastX);
                    if (x === xL || x === xR) val = 1;
                    break;
                case 'Y':
                    if (y < my) {
                        val = (x === 0 || x === lastX) ? 1 : 0;
                    } else if (y > my) {
                        val = (x === mx) ? 1 : 0;
                    } else {
                        // Junction row based on default structure [0,1,0,1,1,0]
                        val = (x === 1 || x === lastX - 1 || x === mx + 1) ? 1 : 0;
                    }
                    break;
                case 'Z':
                    if (y === 0 || y === lastY) val = 1;
                    else {
                        const rangeY = Math.max(1, lastY - 2);
                        const progress = (y - 1) / rangeY;
                        const targetX = Math.round(lastX * (1 - progress));
                        if (x === targetX) val = 1;
                    }
                    break;
            }
            row.push(val);
        }
        matrix.push(row);
    }

    return matrix;
}

export interface GlyphRenderConfig {
    char: string;
    index: number;
    useCustomFont: boolean;
    globalWeight: number;
    globalHeight: number;
    charOverrides: Record<number, { w?: number, h?: number, customMatrix?: PixelMatrix }>;
}

/**
 * Main resolution function that determines which matrix to use for a given character.
 * Handles priority: Override > Custom Static Font > Procedural > Fallback Static.
 */
export function resolveGlyphMatrix(config: GlyphRenderConfig): PixelMatrix | null {
    const { char, index, useCustomFont, globalWeight, globalHeight, charOverrides } = config;

    // Priority 1: Check for Custom Matrix (from Extrude Tool / Manual Edits)
    if (charOverrides[index]?.customMatrix) {
        return charOverrides[index].customMatrix!;
    }

    // Priority 2: Check Constants (User Custom Static Font)
    if (useCustomFont && PIXEL_FONT[char]) {
         return PIXEL_FONT[char].map(row => [...row]);
    }

    // Priority 3: Procedural Generation Eligibility
    if (GENERATED_CHARS.includes(char)) {
        // Determine effective weight/height for this character
        const override = charOverrides[index];
        const weightMod = override?.w !== undefined ? override.w : globalWeight;
        const heightMod = override?.h !== undefined ? override.h : globalHeight;
        
        return generateProceduralGlyph(char, weightMod, heightMod);
    }

    // Priority 4: Fallback to Static Font Definition (for non-procedural chars like numbers, punctuation)
    if (PIXEL_FONT[char]) {
        return PIXEL_FONT[char].map(row => [...row]); // Deep copy
    }

    return null; // Character not found
}