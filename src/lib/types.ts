export type ButtonDesign = 'minimal' | 'solid' | 'outline' | 'bracket' | 'scan' | 'glitch';

export interface Theme {
  colors: string[];
  variables: Record<string, string>;
}

export interface ButtonSpec {
  label: string;
  design: ButtonDesign;
}

export interface SeoSpec {
  title?: string;
  description?: string;
  keywords?: string;
  ogImage?: string;
  robotsIndex: boolean;
  extraMeta: Record<string, string>;
}

export type EntryStatus = 'live' | 'draft' | 'archived';

export type EntryKind = 'experiment' | 'project' | 'paper';

export const KINDS: EntryKind[] = ['experiment', 'project', 'paper'];

export interface RegistryEntry {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  button: ButtonSpec;
  theme: Theme;
  seo: SeoSpec;
  files: string[];
  createdAt: number;
  updatedAt: number;
  status: EntryStatus;
  kind: EntryKind;
}

export interface ContactPayload {
  plugin: string;
  name: string;
  email: string;
  message: string;
}

export const BTN_DESIGNS: ButtonDesign[] = ['minimal', 'solid', 'outline', 'bracket', 'scan', 'glitch'];

export const MAX_DIST_ZIP = 40 * 1024 * 1024;
export const MAX_DIST_FILES = 400;
export const SESSION_TTL = 60 * 60 * 24 * 14;