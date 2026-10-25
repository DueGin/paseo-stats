import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const UpdateStatusSchema = z.object({
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  latestTag: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updateAvailable: z.boolean(),
  install: z.enum(["git", "npm", "directory", "registry", "unknown"]),
  // Why an available update cannot be applied from inside the plugin.
  blocked: z
    .enum(["directory", "registry", "not_installed", "no_cli"])
    .nullable(),
  checkedAt: z.number().nullable(),
  error: z.string().nullable(),
  applying: z.boolean(),
  applyError: z.string().nullable(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const updateCheckRpc = defineRpc({
  name: "update.check",
  input: z.object({ refresh: z.boolean().optional() }),
  output: UpdateStatusSchema,
});

export const updateApplyRpc = defineRpc({
  name: "update.apply",
  input: z.object({ tag: z.string() }),
  output: UpdateStatusSchema,
});
