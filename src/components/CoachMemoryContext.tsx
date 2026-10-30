import { createContext, useContext } from 'react';
import { EMPTY_MEMORY, type CoachMemory } from '../lib/coachMemory';

export interface CoachMemoryApi {
  memory: CoachMemory;
  /** Saves a durable note the coach suggested */
  remember: (text: string) => void;
}

/** Lets an assessment, wherever it is shown, offer "remember this" without every parent passing the memory down. */
export const CoachMemoryContext = createContext<CoachMemoryApi>({ memory: EMPTY_MEMORY, remember: () => {} });
export const useCoachMemory = () => useContext(CoachMemoryContext);
