import { z } from 'zod';
import { getGame } from './catalog';
export const resultSchema = z.object({
  id: z.uuid(),
  game: z.string().refine((v) => !!getGame(v)),
  mode: z.enum(['offline', 'online']),
  score: z.number().finite().min(0).max(1000000),
  durationMs: z.number().int().min(0).max(86400000),
  won: z.boolean(),
  stats: z
    .record(
      z.string().max(40),
      z.union([z.number().finite().min(-1000000).max(1000000), z.string().max(8192), z.boolean()]),
    )
    .refine((v) => Object.keys(v).length <= 30),
});
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(2).max(24).optional(),
});
export const preferencesSchema = z.object({
  theme: z.enum(['dark', 'light']),
  accent: z.enum(['lime', 'peach', 'blue']),
  layout: z.enum(['grid', 'compact']),
  favorites: z.array(z.string().refine((v) => !!getGame(v))).max(12),
});
export const inputSchema = z.object({
  x: z.number().finite().min(-1).max(1).default(0),
  z: z.number().finite().min(-1).max(1).default(0),
  yaw: z.number().finite().min(-100000).max(100000).default(0),
  pitch: z.number().finite().min(-1.5).max(1.5).default(0),
  fire: z.boolean().default(false),
  target: z.number().int().min(0).max(575).optional(),
  score: z.number().finite().min(0).max(1000000).optional(),
  px: z.number().finite().min(-100).max(100).optional(),
  pz: z.number().finite().min(-100).max(100).optional(),
  size: z.number().finite().min(5).max(100).optional(),
});
