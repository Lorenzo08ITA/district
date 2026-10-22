'use client';
import CanvasGame from './CanvasGame';
import type { GameProps } from './types';
export default function Flux(props: GameProps) {
  return <CanvasGame {...props} kind="flux" />;
}
