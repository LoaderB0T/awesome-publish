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
    type: 'patch' | 'minor' | 'major';
  }[];
  meta?: ChangesetMeta;
}
