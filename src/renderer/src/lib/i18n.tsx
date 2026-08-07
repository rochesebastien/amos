// Lightweight i18n: a Zustand-backed language store + a `useT()` hook.
// No external dependency. Translations are flat dot-namespaced keys with
// optional `{var}` interpolation. Missing keys fall back to the key itself.
// Every user-facing string must exist in BOTH dictionaries.
import { create } from "zustand";
import { ipc } from "./ipc";

export type Lang = "en" | "fr";

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

const LANG_KEY = "cheveluai.lang";

/** Key of the persisted (main-process) language preference. */
export const LANG_SETTING = "language";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    // common
    "common.save": "Save",
    "common.saving": "Saving…",
    "common.saved": "Saved",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.remove": "Remove",
    "common.rename": "Rename",
    "common.move": "Move",
    "common.back": "Back",
    "common.close": "Close",
    "common.create": "Create",
    "common.loading": "Loading…",

    // nav
    "nav.home": "Home",
    "nav.settings": "Settings",
    "nav.toggleTheme": "Toggle theme",
    "nav.expandSidebar": "Expand sidebar",
    "nav.collapseSidebar": "Collapse sidebar",
    "nav.resizeHint": "Drag to resize · double-click to collapse",

    // sidebar
    "sidebar.projects": "Projects",
    "sidebar.none": "No project yet",
    "sidebar.openFolder": "Open a folder",
    "sidebar.sort": "Sort projects",
    "sidebar.sortRecent": "Most recent",
    "sidebar.sortName": "Name (A–Z)",

    // welcome / recents
    "welcome.title": "Welcome to AMOS",
    "welcome.subtitle":
      "Open a project folder to manage its agents, skills and MCP servers — for Claude and Codex alike.",
    "welcome.openFolder": "Open folder",
    "welcome.opening": "Opening…",
    "welcome.recents": "Recent projects",
    "welcome.noRecents": "No project yet — open a folder to get started.",
    "welcome.openFailed": "Could not open this folder: {error}",

    // projects
    "projects.never": "Never opened",
    "projects.lastOpened": "Opened {when}",
    "projects.remove": "Remove from AMOS",
    "projects.removeTitle": "Remove project",
    "projects.removeDesc":
      "“{name}” will be removed from AMOS. The folder on disk is left untouched.",

    // project overview
    "project.overview": "Overview",
    "project.folder": "Folder",
    "project.notFound": "Unknown project",
    "project.notFoundDesc": "This project is not registered in AMOS (any more).",
    "project.backHome": "Back to home",
    "project.agents": "Agents",
    "project.skills": "Skills",
    "project.mcps": "MCP servers",
    "project.scanSoon": "Scanning this folder arrives in the next iteration.",

    // relative time
    "time.now": "just now",
    "time.minutes": "{n} min ago",
    "time.hours": "{n} h ago",
    "time.days": "{n} d ago",
    "time.weeks": "{n} wk ago",

    // settings shell
    "settings.title": "Settings",
    "settings.general": "General",
    "settings.backToApp": "Back to app",

    // settings · general
    "settings.general.title": "General",
    "settings.general.subtitle": "Appearance and language.",
    "settings.appearance": "Appearance",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.theme.system": "System",
    "settings.language": "Language",
    "settings.language.hint": "Interface language. Applies immediately.",

    // chat — used by the view parked for the chat phase
    "chat.disclaimer": "CheveluAI runs on your configured model. Verify important information.",
    "chat.newChat": "New chat",
    "chat.mcpCountOne": "{n} MCP",
    "chat.mcpCountOther": "{n} MCPs",
    "chat.activeMcps": "Active MCPs",
    "chat.noMcpsAttached": "No MCPs attached",
    "chat.pickProjectMcps": "Pick a project to enable MCPs",
    "chat.toolCountOne": "{n} tool",
    "chat.toolCountOther": "{n} tools",
    "chat.emptyTitle": "What can I help with?",
    "chat.emptyProjectActive": "Chatting in “{name}”. Its pre-prompt and attached MCP tools are active.",
    "chat.emptyNoProject": "Pick a project to use its pre-prompt and MCP tools, or just start typing.",
    "chat.fileReadError": "Could not read file",
    "chat.inlined": "inlined",
    "chat.removeFile": "Remove {name}",
    "chat.attachFiles": "Attach files",
    "chat.sendPlaceholder": "Send a message…",
    "chat.stop": "Stop",
    "chat.send": "Send",
    "chat.thinking": "Thinking…",
    "chat.model": "Model",
    "chat.noModel": "No model",
    "chat.noModelHint": "Enable models in Settings → Models.",
    "chat.copyMessage": "Copy message",
    "chat.copied": "Copied!",
    "chat.copy": "Copy",
    "chat.running": "running…",
    "chat.hide": "hide",
    "chat.details": "details",

    // composer "+" menu — parked with the chat view
    "composer.add": "Add",
    "composer.attachFiles": "Add files or photos",
    "composer.addToProject": "Add to project",
    "composer.manageProjects": "Manage projects",
    "composer.mcpTools": "MCP tools",
    "composer.mcpToolsLabel": "Tools attached to this project",
    "composer.mcpPickProject": "Pick a project to attach MCP tools.",
    "composer.noMcpsYet": "No MCPs yet.",
    "composer.manageMcps": "Manage MCPs",
    "composer.clearProject": "Remove project",
    "composer.attachToProject": "Attach to this project",
    "composer.availability": "Availability (all chats)",
    "composer.mcpEnabled": "Enabled",
    "composer.mcpDisabled": "Disabled",

    // code editor (IDE) — reused as the skill editor
    "editor.title": "Code editor",
    "editor.explorer": "Explorer",
    "editor.entry": "Entry",
    "editor.setEntry": "Set as entry point",
    "editor.newFile": "New file",
    "editor.newFolder": "New folder",
    "editor.pathHint": "Path of the file, e.g. lib/helpers.py",
    "editor.folderHint": "Path of the folder, e.g. lib/utils",
    "editor.rename": "Rename",
    "editor.deleteFile": "Delete file",
    "editor.deleteFileDesc": "“{path}” will be removed from the project.",
    "editor.importFolder": "Import a folder",
    "editor.importFiles": "Import files",
    "editor.noFiles": "No files yet — create one or import a project.",
    "editor.emptyTitle": "No file open",
    "editor.emptyHint": "Pick a file in the explorer, create a new one, or import your project.",
    "editor.saveExit": "Save & exit",
    "editor.exitNoSave": "Exit without saving",
    "editor.fileOne": "file",
    "editor.fileOther": "files",
    "editor.enterTitle": "Enter code editing mode",
    "editor.enterDesc": "You are about to enter code editing mode. Continue?",
    "editor.enterCta": "Enter edit mode",
  },
  fr: {
    "common.save": "Enregistrer",
    "common.saving": "Enregistrement…",
    "common.saved": "Enregistré",
    "common.cancel": "Annuler",
    "common.delete": "Supprimer",
    "common.remove": "Retirer",
    "common.rename": "Renommer",
    "common.move": "Déplacer",
    "common.back": "Retour",
    "common.close": "Fermer",
    "common.create": "Créer",
    "common.loading": "Chargement…",

    "nav.home": "Accueil",
    "nav.settings": "Paramètres",
    "nav.toggleTheme": "Changer de thème",
    "nav.expandSidebar": "Déplier le panneau",
    "nav.collapseSidebar": "Replier le panneau",
    "nav.resizeHint": "Glisser pour redimensionner · double-clic pour replier",

    "sidebar.projects": "Projets",
    "sidebar.none": "Aucun projet pour l’instant",
    "sidebar.openFolder": "Ouvrir un dossier",
    "sidebar.sort": "Trier les projets",
    "sidebar.sortRecent": "Plus récents",
    "sidebar.sortName": "Nom (A–Z)",

    "welcome.title": "Bienvenue dans AMOS",
    "welcome.subtitle":
      "Ouvrez un dossier de projet pour gérer ses agents, skills et serveurs MCP — côté Claude comme côté Codex.",
    "welcome.openFolder": "Ouvrir un dossier",
    "welcome.opening": "Ouverture…",
    "welcome.recents": "Projets récents",
    "welcome.noRecents": "Aucun projet pour l’instant — ouvrez un dossier pour commencer.",
    "welcome.openFailed": "Impossible d’ouvrir ce dossier : {error}",

    "projects.never": "Jamais ouvert",
    "projects.lastOpened": "Ouvert {when}",
    "projects.remove": "Retirer d’AMOS",
    "projects.removeTitle": "Retirer le projet",
    "projects.removeDesc":
      "« {name} » sera retiré d’AMOS. Le dossier sur le disque n’est pas modifié.",

    "project.overview": "Vue d’ensemble",
    "project.folder": "Dossier",
    "project.notFound": "Projet inconnu",
    "project.notFoundDesc": "Ce projet n’est (plus) enregistré dans AMOS.",
    "project.backHome": "Retour à l’accueil",
    "project.agents": "Agents",
    "project.skills": "Skills",
    "project.mcps": "Serveurs MCP",
    "project.scanSoon": "L’analyse de ce dossier arrive à la prochaine itération.",

    "time.now": "à l’instant",
    "time.minutes": "il y a {n} min",
    "time.hours": "il y a {n} h",
    "time.days": "il y a {n} j",
    "time.weeks": "il y a {n} sem.",

    "settings.title": "Paramètres",
    "settings.general": "Général",
    "settings.backToApp": "Retour à l’app",

    "settings.general.title": "Général",
    "settings.general.subtitle": "Apparence et langue.",
    "settings.appearance": "Apparence",
    "settings.theme.light": "Clair",
    "settings.theme.dark": "Sombre",
    "settings.theme.system": "Système",
    "settings.language": "Langue",
    "settings.language.hint": "Langue de l’interface. Appliquée immédiatement.",

    "chat.disclaimer": "CheveluAI utilise le modèle que vous avez configuré. Vérifiez les informations importantes.",
    "chat.newChat": "Nouvelle discussion",
    "chat.mcpCountOne": "{n} MCP",
    "chat.mcpCountOther": "{n} MCPs",
    "chat.activeMcps": "MCPs actifs",
    "chat.noMcpsAttached": "Aucun MCP rattaché",
    "chat.pickProjectMcps": "Choisissez un projet pour activer les MCPs",
    "chat.toolCountOne": "{n} outil",
    "chat.toolCountOther": "{n} outils",
    "chat.emptyTitle": "Comment puis-je vous aider ?",
    "chat.emptyProjectActive": "Discussion dans « {name} ». Son pré-prompt et ses outils MCP rattachés sont actifs.",
    "chat.emptyNoProject": "Choisissez un projet pour utiliser son pré-prompt et ses outils MCP, ou commencez simplement à écrire.",
    "chat.fileReadError": "Impossible de lire le fichier",
    "chat.inlined": "intégré",
    "chat.removeFile": "Retirer {name}",
    "chat.attachFiles": "Joindre des fichiers",
    "chat.sendPlaceholder": "Envoyer un message…",
    "chat.stop": "Arrêter",
    "chat.send": "Envoyer",
    "chat.thinking": "Réflexion…",
    "chat.model": "Modèle",
    "chat.noModel": "Aucun modèle",
    "chat.noModelHint": "Activez des modèles dans Paramètres → Modèles.",
    "chat.copyMessage": "Copier le message",
    "chat.copied": "Copié !",
    "chat.copy": "Copier",
    "chat.running": "en cours…",
    "chat.hide": "masquer",
    "chat.details": "détails",

    "composer.add": "Ajouter",
    "composer.attachFiles": "Ajouter des fichiers ou des photos",
    "composer.addToProject": "Ajouter au projet",
    "composer.manageProjects": "Gérer les projets",
    "composer.mcpTools": "Outils MCP",
    "composer.mcpToolsLabel": "Outils rattachés à ce projet",
    "composer.mcpPickProject": "Choisissez un projet pour rattacher des outils MCP.",
    "composer.noMcpsYet": "Aucun MCP pour l’instant.",
    "composer.manageMcps": "Gérer les MCPs",
    "composer.clearProject": "Retirer le projet",
    "composer.attachToProject": "Rattacher à ce projet",
    "composer.availability": "Disponibilité (toutes les discussions)",
    "composer.mcpEnabled": "Activé",
    "composer.mcpDisabled": "Désactivé",

    "editor.title": "Éditeur de code",
    "editor.explorer": "Explorateur",
    "editor.entry": "Entrée",
    "editor.setEntry": "Définir comme point d’entrée",
    "editor.newFile": "Nouveau fichier",
    "editor.newFolder": "Nouveau dossier",
    "editor.pathHint": "Chemin du fichier, par ex. lib/helpers.py",
    "editor.folderHint": "Chemin du dossier, par ex. lib/utils",
    "editor.rename": "Renommer",
    "editor.deleteFile": "Supprimer le fichier",
    "editor.deleteFileDesc": "« {path} » sera retiré du projet.",
    "editor.importFolder": "Importer un dossier",
    "editor.importFiles": "Importer des fichiers",
    "editor.noFiles": "Aucun fichier — créez-en un ou importez un projet.",
    "editor.emptyTitle": "Aucun fichier ouvert",
    "editor.emptyHint": "Choisissez un fichier dans l’explorateur, créez-en un, ou importez votre projet.",
    "editor.saveExit": "Enregistrer et quitter",
    "editor.exitNoSave": "Quitter sans enregistrer",
    "editor.fileOne": "fichier",
    "editor.fileOther": "fichiers",
    "editor.enterTitle": "Entrer en mode édition de code",
    "editor.enterDesc": "Vous allez entrer en mode édition de code. Êtes-vous sûr ?",
    "editor.enterCta": "Entrer en mode édition",
  },
};

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const table = dict[lang] ?? dict.en;
  const value = table[key] ?? dict.en[key] ?? key;
  return interpolate(value, vars);
}

type LangState = {
  lang: Lang;
  setLang: (l: Lang, opts?: { persist?: boolean }) => void;
};

// whether the user already has an explicit local choice (vs. defaulting to en)
export const hadStoredLang = localStorage.getItem(LANG_KEY) != null;
const stored = (localStorage.getItem(LANG_KEY) as Lang) || "en";
document.documentElement.lang = stored;

export const useLang = create<LangState>((set) => ({
  lang: stored,
  setLang: (l, opts = { persist: true }) => {
    localStorage.setItem(LANG_KEY, l);
    document.documentElement.lang = l;
    set({ lang: l });
    if (opts.persist !== false) {
      // mirror into the main-process database so the choice survives a reset
      // of the renderer's local storage
      ipc.setSetting(LANG_SETTING, l).catch(() => {});
    }
  },
}));

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export function useT(): TFunc {
  const lang = useLang((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}

// Adopt the persisted language on first load when the user has never made an
// explicit local choice (fresh install, or a brand new renderer profile).
let adopted = hadStoredLang;
export function adoptStoredLanguage(lang?: string | null) {
  if (adopted || !lang) return;
  adopted = true;
  if (LANGUAGES.some((l) => l.value === lang)) {
    useLang.getState().setLang(lang as Lang, { persist: false });
  }
}

/** Localised, compact "time since" label used by the recents lists. */
export function relativeTime(t: TFunc, iso: string | null): string {
  if (!iso) return t("projects.never");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("projects.never");
  const minutes = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (minutes < 1) return t("time.now");
  if (minutes < 60) return t("time.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("time.days", { n: days });
  return t("time.weeks", { n: Math.floor(days / 7) });
}
