'use client';
import ThreeGame from './ThreeGame';
import type { GameProps } from './types';
export default function Prism(props: GameProps) {
  return <ThreeGame {...props} kind="prism" />;
}
