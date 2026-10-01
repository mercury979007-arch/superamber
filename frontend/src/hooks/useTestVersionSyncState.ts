import { useEffect, useState } from 'react';
import {
  getTestVersionSyncState,
  subscribeTestVersionSync,
  type TestVersionSyncState,
} from '../utils/testVersionSync';

export function useTestVersionSyncState(): TestVersionSyncState {
  const [state, setState] = useState<TestVersionSyncState>(() => getTestVersionSyncState());

  useEffect(() => (
    subscribeTestVersionSync(() => {
      setState(getTestVersionSyncState());
    })
  ), []);

  return state;
}
