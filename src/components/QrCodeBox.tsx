import { useMemo } from 'react';
import { generateQrMatrix } from '../utils/qrSvg';

interface QrCodeBoxProps {
  url: string;
  domain: string;
  size?: number;
}

export function QrCodeBox({ url, domain, size = 84 }: QrCodeBoxProps) {
  const matrix = useMemo(
    () => generateQrMatrix(url || 'https://ten-forward.the-lal.net/'),
    [url]
  );
  const n = matrix.length;
  const quiet = 2;
  const viewSize = n + quiet * 2;

  const pathData = useMemo(() => {
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          d += `M${c + quiet},${r + quiet}h1v1h-1z`;
        }
      }
    }
    return d;
  }, [matrix, n]);

  return (
    <div
      className="inline-flex flex-col items-center p-2 rounded-lg bg-white text-slate-900 border border-slate-300 shadow-sm shrink-0"
      title={`Scan QR code with your phone camera to open the original recipe on ${domain}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        aria-label={`QR Code linking to ${url}`}
      >
        <rect width={viewSize} height={viewSize} fill="#ffffff" />
        <path d={pathData} fill="#0f172a" />
      </svg>
      <span className="text-[9px] font-mono text-slate-600 mt-1 max-w-[90px] text-center leading-tight truncate">
        {domain || 'original source'}
      </span>
    </div>
  );
}
