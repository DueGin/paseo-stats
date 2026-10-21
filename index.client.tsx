import type {
  PluginClientContext,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { detectLanguage, translate } from "./client/i18n";
import { StatsSettingsScreen } from "./client/settings-screen";
import { StatsScreen } from "./client/stats-screen";

const ICON = "ChartColumn";

function StatsSidebarItem({
  currentScreen,
  openScreen,
}: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon={ICON}
      active={currentScreen?.screenId === "stats"}
      onPress={() => openScreen({ screenId: "stats" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const language = detectLanguage();
  const title = translate(language, "app.title");
  const removers = [
    client.addScreen({ id: "stats", title, Component: StatsScreen }),
    client.addSidebarFooterItem({
      id: "stats",
      title,
      Component: StatsSidebarItem,
    }),
    client.addCommandCenterItem({
      id: "open-stats",
      title: translate(language, "app.open"),
      icon: ICON,
      keywords: ["usage", "tokens", "cost", "stats", "用量", "费用", "统计"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: "stats" });
      },
    }),
    client.addSettingsScreen({
      id: "stats",
      title: translate(language, "app.settings"),
      icon: ICON,
      Component: StatsSettingsScreen,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
