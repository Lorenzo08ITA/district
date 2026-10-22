'use client';
import CanvasGame from './CanvasGame';
import type { GameProps } from './types';
export default function Pulse(props: GameProps) {
  return <CanvasGame {...props} kind="pulse" />;
}
