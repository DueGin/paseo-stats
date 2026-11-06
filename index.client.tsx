import type {
  PluginClientContext,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { messages } from "./client/i18n";
import { StatsSettingsScreen } from "./client/settings-screen";
import { StatsScreen } from "./client/stats-screen";
import { leaveScreen, markOpenedInApp } from "./client/web";

const ICON = "ChartColumn";

function StatsSidebarItem({
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  const active = currentScreen?.screenId === "stats";
  return (
    <SidebarRow
      icon={ICON}
      active={active}
      onPress={() => {
        // A second press closes the screen where the app allows it.
        if (active && leaveScreen()) return;
        markOpenedInApp();
        openScreen({ screenId: "stats" });
      }}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const title = messages.message("app.title");
  const removers = [
    client.addScreen({ id: "stats", title, Component: StatsScreen }),
    client.addSidebarFooterItem({
      id: "stats",
      title,
      Component: StatsSidebarItem,
    }),
    client.addCommandCenterItem({
      id: "open-stats",
      title: messages.message("app.open"),
      icon: ICON,
      keywords: ["usage", "tokens", "cost", "stats", "用量", "费用", "统计"],
      context: "global",
      onSelect({ openScreen }) {
        markOpenedInApp();
        openScreen({ screenId: "stats" });
      },
    }),
    client.addSettingsScreen({
      id: "stats",
      title: messages.message("app.settings"),
      icon: ICON,
      Component: StatsSettingsScreen,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
