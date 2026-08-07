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
    "sidebar.expandProject": "Show capabilities",
    "sidebar.collapseProject": "Hide capabilities",
    "sidebar.scanning": "Scanning…",
    "sidebar.sectionEmpty": "None",

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
    "project.scanning": "Scanning…",
    "project.rescan": "Rescan",
    "project.scanFailed": "This folder could not be scanned: {error}",
    "project.scannedAt": "Scanned {when}",
    "project.countProject": "{n} in the project",
    "project.countGlobal": "{n} global",
    "project.instructions": "Instruction files",
    "project.noInstructions": "No CLAUDE.md or AGENTS.md in this project.",
    "project.brokenTitle": "Files that could not be parsed",
    "project.brokenDesc": "AMOS lists them so you can fix them — nothing was ignored.",

    // capabilities — badges and shared labels
    "cap.agent": "Agent",
    "cap.skill": "Skill",
    "cap.mcp": "MCP server",
    "cap.eco.claude": "Claude",
    "cap.eco.codex": "Codex",
    "cap.scope.project": "Project",
    "cap.scope.global": "Global",
    "cap.scope.globalHint": "Available in every project, from your home folder",
    "cap.broken": "Broken",
    "cap.parseError": "This file could not be parsed",
    "cap.none": "None detected",
    "cap.sourceFile": "Source file",
    "cap.notFound": "Unknown item",
    "cap.notFoundDesc": "This capability is not in the project any more. Rescan to refresh.",
    "cap.backToProject": "Back to the project",
    "cap.unsaved": "Unsaved changes",
    "cap.revert": "Revert",
    "cap.fixByHand": "This file could not be parsed, so there is no entry to edit. Fix it in your editor, then rescan.",

    // conflict dialog — the file moved under the editor
    "conflict.title": "This file changed on disk",
    "conflict.desc":
      "Something else rewrote it since you opened it. Reload to take what is on disk, or overwrite it with your version.",
    "conflict.backupHint": "Either way AMOS keeps a .bak copy of the previous content next to the file.",
    "conflict.reload": "Reload from disk",
    "conflict.overwrite": "Overwrite anyway",


    // agent editor
    "agent.instructions": "Instructions",
    "agent.name": "Name",
    "agent.nameHint": "How the CLI addresses this agent. Empty falls back to the file name.",
    "agent.description": "Description",
    "agent.descriptionHint": "One line telling the CLI when to reach for this agent.",
    "agent.model": "Model",
    "agent.modelHint": "Leave empty to use the CLI's default model.",
    "agent.modelPlaceholder": "sonnet",
    "agent.tools": "Tools",
    "agent.toolsHint": "Comma-separated. Empty means every tool the CLI offers.",
    "agent.bodyPlaceholder": "What this agent should do, in markdown.",
    "agent.otherKeys": "Other frontmatter keys",
    "agent.otherKeysHint": "AMOS has no form for these, and never touches them when saving.",
    "agent.brokenHint":
      "The frontmatter of this file could not be parsed. Saving replaces it with the fields below — the previous content stays in the .bak file.",

    // skill editor
    "skill.folder": "Folder",
    "skill.files": "Files",
    "skill.noFiles": "This skill folder is empty.",
    "skill.newFile": "New file",
    "skill.newFileHint": "Path inside the skill folder, e.g. scripts/run.py",
    "skill.newFileInvalid":
      "Use plain names separated by /, no leading dot and no “..” — up to four levels deep.",
    "skill.refresh": "Refresh the file list",
    "skill.pickFile": "Pick a file on the left to edit it.",
    "skill.binaryFile": "This looks like a binary file, so AMOS will not open it as text.",
    "skill.tooManyFiles": "This folder has more files than AMOS lists — the tree is partial.",

    // mcp editor
    "mcp.transport": "Transport",
    "mcp.transportHint": "How the CLI reaches the server.",
    "mcp.transport.stdio": "stdio (local process)",
    "mcp.transport.http": "HTTP",
    "mcp.transport.sse": "SSE",
    "mcp.transport.ws": "WebSocket",
    "mcp.name": "Server name",
    "mcp.nameHint": "The key this server is declared under. Renaming rewrites that key.",
    "mcp.nameRequired": "An MCP server needs a name.",
    "mcp.command": "Command",
    "mcp.commandHint": "The executable to launch, e.g. npx or uvx.",
    "mcp.args": "Arguments",
    "mcp.argsHint": "One argument per line — arguments often contain spaces.",
    "mcp.env": "Environment",
    "mcp.envHint": "One KEY=value per line.",
    "mcp.url": "URL",
    "mcp.urlHint": "Endpoint of the remote server.",
    "mcp.headers": "Headers",
    "mcp.headersHint": "One Header=value per line.",
    "mcp.empty": "—",
    "mcp.remove": "Delete this server",
    "mcp.removeTitle": "Delete MCP server",
    "mcp.removeDesc": "“{name}” will be removed from its config file. A .bak copy is kept.",
    "mcp.passthroughHint":
      "Any other key this entry carries is kept exactly as it is — AMOS only rewrites the fields above.",
    "mcp.brokenHint": "This entry could not be read fully. Check the fields before saving.",
    "mcp.tomlCommentWarning":
      "This is a TOML config file. AMOS cannot write TOML comments back, so saving drops them — the .bak copy next to the file keeps them.",
    "mcp.tomlCommentsDropped":
      "Saved. The comments this file carried are gone from it; they are still in the .bak copy.",

    // creating a capability
    "new.title.agent": "New agent",
    "new.title.skill": "New skill",
    "new.title.mcp": "New MCP server",
    "new.subtitle.agent": "A markdown file the CLI can delegate to.",
    "new.subtitle.skill": "A folder with a SKILL.md the CLI can load on demand.",
    "new.subtitle.mcp": "An entry in the config file that lists this project's MCP servers.",
    "new.ecosystem": "Ecosystem",
    "new.ecosystemHint": "Which CLI will read it. That decides where the file goes.",
    "new.scope": "Scope",
    "new.scopeHint": "In this project only, or in your home folder for every project.",
    "new.name": "Name",
    "new.nameHint": "Letters, digits, dot, dash and underscore.",
    "new.nameInvalid": "Use letters, digits, dot, dash or underscore, starting with a letter or digit.",
    "new.nameTaken": "“{name}” is already declared in that file. Open it instead, or pick another name.",
    "new.namePlaceholder.agent": "code-reviewer",
    "new.namePlaceholder.skill": "pdf-export",
    "new.namePlaceholder.mcp": "filesystem",
    "new.descriptionHint": "Shown to the CLI so it knows when to use this.",
    "new.codexNoAgents":
      "Codex has no per-agent files: its instructions live in AGENTS.md. Pick Claude, or edit an AGENTS.md instead.",
    "new.globalHint": "Global capabilities live in your home folder and apply to every project.",
    "new.agentScaffold": "You are {name}.\n\nDescribe what this agent should do here.",
    "new.skillScaffold": "# {name}\n\nDescribe what this skill does and how to use it.",

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
    "sidebar.expandProject": "Afficher les capacités",
    "sidebar.collapseProject": "Masquer les capacités",
    "sidebar.scanning": "Analyse…",
    "sidebar.sectionEmpty": "Aucun",

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
    "project.scanning": "Analyse…",
    "project.rescan": "Relancer l’analyse",
    "project.scanFailed": "Ce dossier n’a pas pu être analysé : {error}",
    "project.scannedAt": "Analysé {when}",
    "project.countProject": "{n} dans le projet",
    "project.countGlobal": "{n} en global",
    "project.instructions": "Fichiers d’instructions",
    "project.noInstructions": "Aucun CLAUDE.md ni AGENTS.md dans ce projet.",
    "project.brokenTitle": "Fichiers illisibles",
    "project.brokenDesc": "AMOS les liste pour que vous puissiez les corriger — rien n’a été ignoré.",

    "cap.agent": "Agent",
    "cap.skill": "Skill",
    "cap.mcp": "Serveur MCP",
    "cap.eco.claude": "Claude",
    "cap.eco.codex": "Codex",
    "cap.scope.project": "Projet",
    "cap.scope.global": "Global",
    "cap.scope.globalHint": "Disponible dans tous les projets, depuis votre dossier personnel",
    "cap.broken": "Invalide",
    "cap.parseError": "Ce fichier n’a pas pu être analysé",
    "cap.none": "Rien de détecté",
    "cap.sourceFile": "Fichier source",
    "cap.notFound": "Élément inconnu",
    "cap.notFoundDesc":
      "Cette capacité n’est plus dans le projet. Relancez l’analyse pour rafraîchir.",
    "cap.backToProject": "Retour au projet",
    "cap.unsaved": "Modifications non enregistrées",
    "cap.revert": "Annuler les modifications",
    "cap.fixByHand":
      "Ce fichier n’a pas pu être analysé, il n’y a donc rien à éditer ici. Corrigez-le dans votre éditeur, puis relancez l’analyse.",

    "conflict.title": "Ce fichier a changé sur le disque",
    "conflict.desc":
      "Quelque chose d’autre l’a réécrit depuis son ouverture. Rechargez pour prendre la version du disque, ou écrasez-la avec la vôtre.",
    "conflict.backupHint":
      "Dans les deux cas, AMOS conserve une copie .bak du contenu précédent à côté du fichier.",
    "conflict.reload": "Recharger depuis le disque",
    "conflict.overwrite": "Écraser quand même",


    "agent.instructions": "Instructions",
    "agent.name": "Nom",
    "agent.nameHint":
      "Le nom sous lequel le CLI appelle cet agent. Vide, c’est le nom du fichier qui sert.",
    "agent.description": "Description",
    "agent.descriptionHint": "Une ligne qui dit au CLI quand faire appel à cet agent.",
    "agent.model": "Modèle",
    "agent.modelHint": "Laissez vide pour utiliser le modèle par défaut du CLI.",
    "agent.modelPlaceholder": "sonnet",
    "agent.tools": "Outils",
    "agent.toolsHint": "Séparés par des virgules. Vide = tous les outils du CLI.",
    "agent.bodyPlaceholder": "Ce que doit faire cet agent, en markdown.",
    "agent.otherKeys": "Autres clés d’en-tête",
    "agent.otherKeysHint":
      "AMOS n’a pas de champ pour celles-ci, et n’y touche jamais en enregistrant.",
    "agent.brokenHint":
      "L’en-tête de ce fichier n’a pas pu être analysé. Enregistrer le remplacera par les champs ci-dessous — le contenu précédent reste dans le fichier .bak.",

    "skill.folder": "Dossier",
    "skill.files": "Fichiers",
    "skill.noFiles": "Ce dossier de skill est vide.",
    "skill.newFile": "Nouveau fichier",
    "skill.newFileHint": "Chemin dans le dossier de la skill, par ex. scripts/run.py",
    "skill.newFileInvalid":
      "Utilisez des noms simples séparés par /, sans point initial ni « .. » — quatre niveaux au maximum.",
    "skill.refresh": "Rafraîchir la liste des fichiers",
    "skill.pickFile": "Choisissez un fichier à gauche pour l’éditer.",
    "skill.binaryFile": "Ce fichier semble binaire : AMOS ne l’ouvre pas comme du texte.",
    "skill.tooManyFiles":
      "Ce dossier contient plus de fichiers qu’AMOS n’en liste — l’arborescence est partielle.",

    "mcp.transport": "Transport",
    "mcp.transportHint": "Comment le CLI joint le serveur.",
    "mcp.transport.stdio": "stdio (processus local)",
    "mcp.transport.http": "HTTP",
    "mcp.transport.sse": "SSE",
    "mcp.transport.ws": "WebSocket",
    "mcp.name": "Nom du serveur",
    "mcp.nameHint": "La clé sous laquelle ce serveur est déclaré. La renommer réécrit cette clé.",
    "mcp.nameRequired": "Un serveur MCP doit avoir un nom.",
    "mcp.command": "Commande",
    "mcp.commandHint": "L’exécutable à lancer, par ex. npx ou uvx.",
    "mcp.args": "Arguments",
    "mcp.argsHint": "Un argument par ligne — ils contiennent souvent des espaces.",
    "mcp.env": "Environnement",
    "mcp.envHint": "Une paire CLÉ=valeur par ligne.",
    "mcp.url": "URL",
    "mcp.urlHint": "Point d’accès du serveur distant.",
    "mcp.headers": "En-têtes",
    "mcp.headersHint": "Une paire En-tête=valeur par ligne.",
    "mcp.empty": "—",
    "mcp.remove": "Supprimer ce serveur",
    "mcp.removeTitle": "Supprimer le serveur MCP",
    "mcp.removeDesc":
      "« {name} » sera retiré de son fichier de configuration. Une copie .bak est conservée.",
    "mcp.passthroughHint":
      "Toute autre clé de cette entrée est conservée telle quelle — AMOS ne réécrit que les champs ci-dessus.",
    "mcp.brokenHint":
      "Cette entrée n’a pas pu être lue entièrement. Vérifiez les champs avant d’enregistrer.",
    "mcp.tomlCommentWarning":
      "Ce fichier de configuration est en TOML. AMOS ne sait pas réécrire les commentaires TOML : enregistrer les supprime — la copie .bak à côté du fichier les conserve.",
    "mcp.tomlCommentsDropped":
      "Enregistré. Les commentaires de ce fichier en ont disparu ; ils restent dans la copie .bak.",

    "new.title.agent": "Nouvel agent",
    "new.title.skill": "Nouvelle skill",
    "new.title.mcp": "Nouveau serveur MCP",
    "new.subtitle.agent": "Un fichier markdown auquel le CLI peut déléguer.",
    "new.subtitle.skill": "Un dossier avec un SKILL.md que le CLI charge à la demande.",
    "new.subtitle.mcp":
      "Une entrée dans le fichier de configuration qui liste les serveurs MCP de ce projet.",
    "new.ecosystem": "Écosystème",
    "new.ecosystemHint": "Quel CLI le lira. C’est ce qui décide de l’emplacement du fichier.",
    "new.scope": "Portée",
    "new.scopeHint": "Dans ce projet seulement, ou dans votre dossier personnel pour tous les projets.",
    "new.name": "Nom",
    "new.nameHint": "Lettres, chiffres, point, tiret et tiret bas.",
    "new.nameInvalid":
      "Utilisez lettres, chiffres, point, tiret ou tiret bas, en commençant par une lettre ou un chiffre.",
    "new.nameTaken":
      "« {name} » est déjà déclaré dans ce fichier. Ouvrez-le, ou choisissez un autre nom.",
    "new.namePlaceholder.agent": "code-reviewer",
    "new.namePlaceholder.skill": "pdf-export",
    "new.namePlaceholder.mcp": "filesystem",
    "new.descriptionHint": "Montrée au CLI pour qu’il sache quand s’en servir.",
    "new.codexNoAgents":
      "Codex n’a pas de fichiers d’agent : ses instructions vivent dans AGENTS.md. Choisissez Claude, ou modifiez un AGENTS.md.",
    "new.globalHint":
      "Les capacités globales vivent dans votre dossier personnel et s’appliquent à tous les projets.",
    "new.agentScaffold": "Vous êtes {name}.\n\nDécrivez ici ce que doit faire cet agent.",
    "new.skillScaffold": "# {name}\n\nDécrivez ce que fait cette skill et comment l’utiliser.",

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
