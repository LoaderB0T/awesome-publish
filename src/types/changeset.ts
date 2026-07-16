import type { BumpType } from '../services/version.js';

export interface ChangesetMeta {
  author?: string;
  email?: string;
  timestamp?: string;
}

export interface Changeset {
  id: string;
  summary: string;
  releases: {
    name: string;
    type: BumpType;
  }[];
  meta?: ChangesetMeta;
}
