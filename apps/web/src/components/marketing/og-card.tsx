import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = 'image/png';

export function brandOg(title: string, subtitle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: '#15233A',
          color: '#ffffff',
          padding: 64,
        }}
      >
        <div style={{ fontSize: 28, color: '#8EE0B5', marginBottom: 16 }}>Facilito · Logic Code Spot</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1, maxWidth: 980 }}>{title}</div>
        <div style={{ fontSize: 28, marginTop: 18, color: '#D7EEFC', maxWidth: 860 }}>{subtitle}</div>
      </div>
    ),
    { ...ogSize },
  );
}
