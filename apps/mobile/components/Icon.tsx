import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'home' | 'meal' | 'chart' | 'scale' | 'gear' | 'back' | 'chevron' | 'plus' | 'check' | 'pencil'
  | 'star' | 'copy' | 'search' | 'up' | 'down' | 'close' | 'trash' | 'car' | 'bus' | 'plane'
  | 'calc' | 'dumbbell' | 'eyeOff' | 'prev' | 'next' | 'calendar';

/** 線で描く簡単なアイコン（24 の格子） */
export function Icon({ name, size = 22, color = colors.text, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body = (() => {
    switch (name) {
      case 'home': return <Path {...p} d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />;
      case 'meal': return <Path {...p} d="M6 3v8a2 2 0 0 0 2 2v8M10 3v8a2 2 0 0 1-2 2M8 3v6M16 21V3c2.5 1 4 4 4 7v3h-4" />;
      case 'chart': return (<><Rect {...p} x="3" y="4" width="18" height="17" rx="2" /><Path {...p} d="M3 9h18M8 2v4M16 2v4M7 17l3-3 3 2 4-4" /></>);
      case 'scale': return (<><Rect {...p} x="3" y="3" width="18" height="18" rx="4" /><Path {...p} d="M8 9a5 5 0 0 1 8 0M12 9l1.5-2" /></>);
      case 'gear': return (<><Circle {...p} cx="12" cy="12" r="3" /><Path {...p} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
      case 'back': case 'prev': return <Path {...p} d="M15 5l-7 7 7 7" />;
      case 'chevron': case 'next': return <Path {...p} d="M9 5l7 7-7 7" />;
      case 'plus': return <Path {...p} d="M12 5v14M5 12h14" />;
      case 'check': return <Path {...p} d="M5 12.5l4.5 4.5L19 7.5" />;
      case 'pencil': return <Path {...p} d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />;
      case 'star': return <Path {...p} d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />;
      case 'copy': return (<><Rect {...p} x="8" y="8" width="12" height="12" rx="2" /><Path {...p} d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>);
      case 'search': return (<><Circle {...p} cx="11" cy="11" r="6.5" /><Path {...p} d="M16 16l4.5 4.5" /></>);
      case 'up': return <Path {...p} d="M6 15l6-6 6 6" />;
      case 'down': return <Path {...p} d="M6 9l6 6 6-6" />;
      case 'close': return <Path {...p} d="M6 6l12 12M18 6L6 18" />;
      case 'trash': return <Path {...p} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />;
      case 'car': return (<><Path {...p} d="M3 16v-4l2-5h11l4 5h1v4h-2M7 16h8M5 12h15" /><Circle {...p} cx="6" cy="17" r="2" /><Circle {...p} cx="17" cy="17" r="2" /></>);
      case 'bus': return (<><Rect {...p} x="3" y="5" width="18" height="12" rx="2" /><Path {...p} d="M3 11h18M8 5v6M14 5v6" /><Circle {...p} cx="7" cy="18" r="1.5" /><Circle {...p} cx="17" cy="18" r="1.5" /></>);
      case 'plane': return <Path {...p} d="M21 15l-8-4V5a1.5 1.5 0 0 0-3 0v6l-8 4v2l8-2v4l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4l8 2z" />;
      case 'calc': return (<><Rect {...p} x="5" y="3" width="14" height="18" rx="2" /><Path {...p} d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>);
      case 'dumbbell': return <Path {...p} d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />;
      case 'calendar': return (<><Rect {...p} x="3" y="5" width="18" height="16" rx="2" /><Path {...p} d="M3 10h18M8 3v4M16 3v4" /></>);
      case 'eyeOff': return <Path {...p} d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />;
    }
  })();
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
