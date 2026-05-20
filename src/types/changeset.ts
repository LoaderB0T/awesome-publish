export interface Changeset {
  id: string;
  summary: string;
  releases: {
    name: string;
    type: 'patch' | 'minor' | 'major';
  }[];
}
