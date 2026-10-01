import type { CnfSquadSummary } from './cnfSync';
import { convertStudentsToCircular, layoutMaxStudents } from './layouts';
import { findMatchingCnfSquad } from './rosterSync';
import type { ClassConfig } from './types';

export interface CnfSquadOption {
  value: string;
  label: string;
  type: string;
}

export function buildCnfSquadOptions(squads: CnfSquadSummary[]): CnfSquadOption[] {
  return squads.map((squad) => ({
    value: String(squad.id),
    type: squad.type || 'offline',
    label: squad.group || squad.section
      ? `${squad.name}（${squad.group || squad.section}）`
      : squad.name,
  }));
}

export function resolvePreferredCnfSquadId(args: {
  squads: CnfSquadSummary[];
  currentCnfSquadId?: string | null;
  preferredClass: string;
}): string {
  if (args.currentCnfSquadId) {
    return args.currentCnfSquadId;
  }

  const matched = findMatchingCnfSquad(args.squads, args.preferredClass);
  return matched ? String(matched.id) : '';
}

export function applyFetchedCnfRoster(
  config: ClassConfig,
  names: string[],
  args: {
    squadId: string;
    squadType: 'offline' | 'online';
    loginUsername: string;
    timestamp?: string;
  },
): void {
  config.cnf = {
    squadId: args.squadId,
    squadType: args.squadType,
    sessionToken: '',
    loginUsername: args.loginUsername,
    lastSyncedAt: args.timestamp || new Date().toISOString(),
  };

  const groups = convertStudentsToCircular(names.slice(0, layoutMaxStudents('circular')));
  config.weekday.layout = 'circular';
  config.weekday.groups = groups;
  config.weekday.groupOrder = [1, 2, 3, 4, 5, 6];
}
