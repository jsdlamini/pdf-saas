// VSCode-icons file/folder icon lookup. `vscode-icons-js` ships the
// filename → icon-name mapping (the long tail); the SVG assets live in
// public/vscode-icons/ (copied from the vscode-icons extension repo) and are
// rendered via <img> so the icons keep their own colours.
import {
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from "vscode-icons-js";

// vscode-icons-js maps most folder names, but the captain's spec calls out a
// few extra that read better as a specific folder type than the default.
const FOLDER_OVERRIDES: Record<string, string> = {
  figures: "folder_type_images",
  code: "folder_type_src",
  chapters: "folder_type_docs",
  sections: "folder_type_docs",
  bib: "folder_type_library",
  references: "folder_type_library",
};

export function vscodeFileIcon(name: string): string {
  return getIconForFile(name) || "default_file.svg";
}

export function vscodeFolderIcon(name: string, open: boolean): string {
  const key = name.toLowerCase();
  const override = FOLDER_OVERRIDES[key];
  if (override) return open ? `${override}_opened.svg` : `${override}.svg`;
  const icon = open ? getIconForOpenFolder(key) : getIconForFolder(key);
  return icon || (open ? "default_folder_opened.svg" : "default_folder.svg");
}
