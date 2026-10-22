'use client';
import CanvasGame from './CanvasGame';
import type { GameProps } from './types';
export default function Wing(props: GameProps) {
  return <CanvasGame {...props} kind="wing" />;
}
