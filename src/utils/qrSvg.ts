/**
 * Compact, zero-dependency ISO/IEC 18004 QR Code Matrix generator (Byte mode, ECC Level L).
 * Supports versions 1 through 10 (up to 271 UTF-8 bytes — plenty for canonical recipe URLs).
 */

interface VersionSpec {
  version: number;
  size: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks1: number;
  dataCodewords1: number;
  numBlocks2: number;
  dataCodewords2: number;
  alignmentCenters: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks1: 1, dataCodewords1: 19, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [] },
  { version: 2, size: 25, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks1: 1, dataCodewords1: 34, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks1: 1, dataCodewords1: 55, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks1: 1, dataCodewords1: 80, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks1: 1, dataCodewords1: 108, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks1: 2, dataCodewords1: 68, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks1: 2, dataCodewords1: 78, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks1: 2, dataCodewords1: 97, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 24, 42] },
  { version: 9, size: 53, totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks1: 2, dataCodewords1: 116, numBlocks2: 0, dataCodewords2: 0, alignmentCenters: [6, 26, 46] },
  { version: 10, size: 57, totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks1: 2, dataCodewords1: 68, numBlocks2: 2, dataCodewords2: 69, alignmentCenters: [6, 28, 50] },
];

// GF(256) log/exp tables with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function computeReedSolomon(data: Uint8Array, ecLen: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
  }

  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return rem;
}

export function generateQrMatrix(text: string): boolean[][] {
  const utf8 = new TextEncoder().encode(text.slice(0, 240));
  const spec =
    VERSION_SPECS.find((s) => {
      const cap = s.numBlocks1 * s.dataCodewords1 + s.numBlocks2 * s.dataCodewords2;
      const headerBytes = s.version <= 9 ? 2 : 3;
      return utf8.length + headerBytes <= cap;
    }) || VERSION_SPECS[VERSION_SPECS.length - 1];

  const totalDataBytes =
    spec.numBlocks1 * spec.dataCodewords1 + spec.numBlocks2 * spec.dataCodewords2;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Mode indicator: 0100 (Byte mode)
  pushBits(0b0100, 4);
  const countBits = spec.version <= 9 ? 8 : 16;
  const payload = utf8.slice(0, totalDataBytes - (spec.version <= 9 ? 2 : 3));
  pushBits(payload.length, countBits);
  for (const b of payload) pushBits(b, 8);

  // Terminator (up to 4 zero bits)
  const maxBits = totalDataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataBytes[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < totalDataBytes; i++, p++) {
    dataBytes[i] = padBytes[p % 2];
  }

  // Split into blocks & compute Reed-Solomon EC
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < spec.numBlocks1; b++) {
    const block = dataBytes.slice(offset, offset + spec.dataCodewords1);
    offset += spec.dataCodewords1;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomon(block, spec.ecCodewordsPerBlock));
  }
  for (let b = 0; b < spec.numBlocks2; b++) {
    const block = dataBytes.slice(offset, offset + spec.dataCodewords2);
    offset += spec.dataCodewords2;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomon(block, spec.ecCodewordsPerBlock));
  }

  // Interleave codewords
  const finalBytes: number[] = [];
  const maxDataLen = Math.max(spec.dataCodewords1, spec.dataCodewords2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) finalBytes.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) {
      finalBytes.push(block[i]);
    }
  }

  const size = spec.size;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onBorder || inCore));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (!isFunction[8][i]) setFunctionModule(8, i, false);
    if (!isFunction[i][8]) setFunctionModule(i, 8, false);
    if (i < 8) {
      if (!isFunction[8][size - 1 - i]) setFunctionModule(8, size - 1 - i, false);
      if (!isFunction[size - 1 - i][8]) setFunctionModule(size - 1 - i, 8, false);
    }
  }
  setFunctionModule(size - 8, 8, true);

  // Place data bits in upward/downward 2-column zig-zag
  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            dark = ((finalBytes[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Apply mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for ECC Level L (01), Mask 0 (000) -> precomputed BCH 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, ((formatBits >>> i) & 1) === 1);
  setFunctionModule(8, 7, ((formatBits >>> 6) & 1) === 1);
  setFunctionModule(8, 8, ((formatBits >>> 7) & 1) === 1);
  setFunctionModule(7, 8, ((formatBits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, ((formatBits >>> i) & 1) === 1);

  for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, ((formatBits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, ((formatBits >>> i) & 1) === 1);

  return modules;
}

/**
 * Renders a standalone SVG string for a QR code (used in exported HTML files and print cards).
 */
export function renderQrSvgString(url: string, pixelSize = 84): string {
  const matrix = generateQrMatrix(url || 'https://ten-forward.the-lal.net/');
  const n = matrix.length;
  const quiet = 2;
  const viewSize = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        path += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/><path d="${path}" fill="#0f172a"/></svg>`;
}
