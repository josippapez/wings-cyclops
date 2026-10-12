// The parts of Cyclops's API answers the plugin reads.

export interface Project {
  id: string;
  name: string;
  clientName: string;
}

/** A time entry, or a running timer, which has no end. */
export interface Entry {
  id: string;
  projectId: string;
  task?: string | null;
  startedAt: string;
  endedAt?: string | null;
  /** YYYY-MM-DD. */
  entryDate: string;
  durationMinutes?: number | null;
}

/** GET /auth/me. */
export interface Me {
  name?: string;
  timezone?: string | null;
}
