/**
 * The address of each view, kept in the URL hash so the back button steps through the views you visited and a refresh
 * stays where you were: #/goals, #/training/log, #/performance/power.
 */
export type RouteTab = 'dashboard' | 'goals' | 'activities' | 'training' | 'performance' | 'coach' | 'profile';
export type RouteTrainingView = 'week' | 'log' | 'plan';
export type RoutePerformanceView = 'heart-rate' | 'power' | 'travel';

const TABS: RouteTab[] = ['dashboard', 'goals', 'activities', 'training', 'performance', 'coach', 'profile'];
const TRAINING: RouteTrainingView[] = ['week', 'log', 'plan'];
const PERFORMANCE: RoutePerformanceView[] = ['heart-rate', 'power', 'travel'];

export interface Route {
  tab: RouteTab;
  training: RouteTrainingView;
  performance: RoutePerformanceView;
}

/** Reads a hash such as "#/training/log". Anything unknown is the home view. */
export function parseRoute(hash: string): Route {
  const [first = '', second = ''] = hash.replace(/^#\/?/, '').split('/');
  const tab = (TABS as string[]).includes(first) ? (first as RouteTab) : 'dashboard';
  return {
    tab,
    training: tab === 'training' && (TRAINING as string[]).includes(second) ? (second as RouteTrainingView) : 'week',
    performance: tab === 'performance' && (PERFORMANCE as string[]).includes(second) ? (second as RoutePerformanceView) : 'heart-rate',
  };
}

/** The hash for a view; the first sub-view of a tab is left out. */
export function buildRoute(tab: RouteTab, training: RouteTrainingView, performance: RoutePerformanceView): string {
  if (tab === 'dashboard') return '#/';
  if (tab === 'training' && training !== 'week') return `#/training/${training}`;
  if (tab === 'performance' && performance !== 'heart-rate') return `#/performance/${performance}`;
  return `#/${tab}`;
}
