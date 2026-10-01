import type { AppScreen, ClassInfo } from '../types';

export interface AuthenticatedLanding {
  screen: AppScreen;
  selectedClass: ClassInfo | null;
}

export function resolveAuthenticatedLanding(
  standaloneScreen: AppScreen | null,
  standaloneSelectedClass: ClassInfo | null,
): AuthenticatedLanding {
  if (standaloneScreen) {
    return {
      screen: standaloneScreen,
      selectedClass: standaloneSelectedClass,
    };
  }

  return {
    screen: 'welcome',
    selectedClass: null,
  };
}
