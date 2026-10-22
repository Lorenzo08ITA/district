'use client';
import CanvasGame from './CanvasGame';
import type { GameProps } from './types';
export default function Orbit(props: GameProps) {
  return <CanvasGame {...props} kind="orbit" />;
}
