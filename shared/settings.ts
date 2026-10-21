import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Prices are USD per million tokens.
export const PriceOverrideSchema = z.object({
  model: z.string().trim().min(1),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().nullable().default(null),
  cacheWrite: z.number().nonnegative().nullable().default(null),
});
export type PriceOverride = z.infer<typeof PriceOverrideSchema>;

export const statsSettings = defineSettings({
  id: "stats",
  scope: "host",
  version: 1,
  schema: z.object({
    onlinePricing: z.boolean().default(true),
    priceOverrides: z.array(PriceOverrideSchema).default([]),
    autoUpdate: z.boolean().default(false),
  }),
});
