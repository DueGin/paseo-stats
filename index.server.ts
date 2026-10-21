import type { PluginServerContext } from "@getpaseo/plugin/server";
import { StatsService } from "./server/service.ts";
import { statsSettings } from "./shared/settings.ts";
import { statsQueryRpc } from "./shared/stats.ts";
import { updateApplyRpc, updateCheckRpc } from "./shared/update.ts";

export default function contribute(server: PluginServerContext) {
  const service = new StatsService(server.registerSettings(statsSettings));
  server.handle(statsQueryRpc, (query, { paseo }) =>
    service.query(query, paseo),
  );
  server.handle(updateCheckRpc, ({ refresh }) =>
    service.updater.check(refresh),
  );
  server.handle(updateApplyRpc, ({ tag }) => service.updater.apply(tag));
  server.on("agent.turn_ended", (_event, { paseo }) => {
    service.scheduleSync(paseo);
  });
  return () => service.dispose();
}
