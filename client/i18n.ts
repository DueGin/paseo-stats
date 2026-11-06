import {
  defineTranslations,
  useTranslation,
  type PluginMessage,
} from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { resolveLanguage, type Language } from "./locale";
import { en, nest, zh, type MessageKey, type MessageParams } from "./messages";

export type { Language } from "./locale";
export type { MessageKey, MessageParams } from "./messages";

type Template<Key extends MessageKey> = Key extends keyof typeof en
  ? (typeof en)[Key]
  : `${Key}_other` extends keyof typeof en
    ? (typeof en)[`${Key}_other`]
    : never;

type Names<Text> = Text extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | Names<Rest>
  : never;

// Placeholders the key's English text needs, so a missing one is a type
// error rather than a runtime throw from the host.
type ParamsOf<Key extends MessageKey> = [Names<Template<Key>>] extends [never]
  ? MessageParams | undefined
  : Record<Names<Template<Key>>, string | number> & MessageParams;

// Keys whose text has no placeholders, for lookups through a variable.
export type PlainKey = {
  [Key in MessageKey]: [Names<Template<Key>>] extends [never] ? Key : never;
}[MessageKey];

export type Translate = <Key extends MessageKey>(
  key: Key,
  ...params: [Names<Template<Key>>] extends [never]
    ? [params?: MessageParams]
    : [params: ParamsOf<Key>]
) => string;

type Messages = {
  message(key: MessageKey, params?: MessageParams): PluginMessage;
};

const translations = defineTranslations({
  resources: { en: nest(en), "zh-CN": nest(zh) },
});

// Persistent labels the host resolves in the app's current language.
export const messages = translations as unknown as Messages;

export function useI18n(): { language: Language; t: Translate } {
  const { locale, t } = useTranslation(translations) as unknown as {
    locale: string;
    t(key: string, params?: MessageParams): string;
  };
  return useMemo(
    () => ({
      language: resolveLanguage([locale]),
      t: ((key: MessageKey, params?: MessageParams) =>
        t(key, params)) as Translate,
    }),
    [locale, t],
  );
}
