// web（e2e）では 3D の体を使わない（expo-gl と three を web の束に入れない）。ケガの画面は 2D の図を出す。
// Android と iOS は InjuryBodyMap3D.native.tsx
import type { ComponentType } from 'react';
import type { Injury } from '@/db/repositories/injuries';

export const InjuryBodyMap3D: ComponentType<{ injuries: Injury[]; numbers: Map<string, string> }> | null = null;
