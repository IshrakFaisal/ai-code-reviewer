import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const titleCase = (s: string) =>
  ["UI", "API"].includes(s)
    ? s
    : s
        .toLowerCase()
        .replace(/(^|[ _])\w/g, (c) => c.toUpperCase())
        .replaceAll("_", " ");
