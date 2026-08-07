/** The languages AMOS ships. Its own module so the dictionaries — which the
 * i18n runtime imports — do not have to import the runtime back. */
export type Lang = "en" | "fr";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];
