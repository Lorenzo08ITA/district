'use client';
import ThreeGame from './ThreeGame';
import type { GameProps } from './types';
export default function Drift(props: GameProps) {
  return <ThreeGame {...props} kind="drift" />;
}
