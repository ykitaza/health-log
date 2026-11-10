import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';

export type IconName =
  | 'home' | 'meal' | 'chart' | 'scale' | 'gear' | 'back' | 'chevron' | 'plus' | 'check' | 'pencil'
  | 'star' | 'copy' | 'search' | 'up' | 'down' | 'close' | 'trash' | 'car' | 'bus' | 'plane'
  | 'calc' | 'dumbbell' | 'eyeOff' | 'prev' | 'next' | 'calendar'
  | 'trendUp' | 'trendFlat' | 'caution' | 'arrowUp' | 'arrowDown' | 'arrowFlat' | 'moon' | 'info' | 'heart' | 'swap' | 'sync'
  | 'chat' | 'external' | 'steps';

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
      case 'trendUp': return <Path {...p} d="M4 16l5-5 4 4 7-7M14 8h6v6" />;
      case 'trendFlat': return <Path {...p} d="M4 12h15M15 8l4 4-4 4" />;
      case 'caution': return <Path {...p} d="M12 4l9 16H3zM12 10v4M12 17h.01" />;
      case 'arrowUp': return <Path {...p} d="M12 19V5M6 11l6-6 6 6" />;
      case 'arrowDown': return <Path {...p} d="M12 5v14M6 13l6 6 6-6" />;
      case 'arrowFlat': return <Path {...p} d="M5 12h14M13 6l6 6-6 6" />;
      case 'moon': return <Path {...p} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />;
      case 'info': return (<><Circle {...p} cx="12" cy="12" r="9" /><Path {...p} d="M12 11v5M12 8h.01" /></>);
      case 'sync': return <Path {...p} d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4" />;
      case 'swap': return <Path {...p} d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />;
      case 'chat': return <Path {...p} d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />;
      case 'external': return <Path {...p} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />;
      // 足あと（歩数）：左右の足の裏とかかと
      case 'steps': return <Path {...p} d="M6.5 3c1.9 0 3 2 3 4.8S8.4 12.5 6.5 12.5 3.5 10.6 3.5 7.8 4.6 3 6.5 3zM4.5 15.5h4v1.5a2 2 0 0 1-4 0zM17.5 6.5c1.9 0 3 2 3 4.8s-1.1 4.7-3 4.7-3-1.9-3-4.7 1.1-4.8 3-4.8zM15.5 19h4v.5a2 2 0 0 1-4 0z" />;
      case 'heart': return <Path {...p} d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />;
      case 'eyeOff': return <Path {...p} d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-2.6 3.2M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />;
    }
  })();
  return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
