/**
 * Checking the arguments the AI filled in for a COROS "create workout" tool against that tool's own schema, in software,
 * before the athlete sees them and before anything is sent.
 */
import type { CorosTool } from './coros';

/** The tools that put a workout on the account, best first: one that also schedules it on a date, then a library workout. */
export const WORKOUT_TOOLS = ['createScheduledWorkout', 'createSingleWorkout'] as const;

export function pickWorkoutTool(tools: CorosTool[]): CorosTool | undefined {
  for (const name of WORKOUT_TOOLS) {
    const t = tools.find((x) => x.name === name);
    if (t) return t;
  }
  return undefined;
}

const typeOk = (value: unknown, type?: string): boolean => {
  if (!type) return true;
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
};

/** Parses the reply and returns the arguments, or the first reason they cannot be used. */
export function validateCorosArgs(raw: string, tool: CorosTool): { args: Record<string, unknown> } | { error: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let args: any;
  try { args = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw); } catch { return { error: 'The reply was not readable.' }; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { error: 'The reply was not an object.' };
  const schema = tool.inputSchema;
  const props = schema?.properties;
  if (props) {
    for (const key of Object.keys(args)) if (!(key in props)) return { error: `"${key}" is not an argument of ${tool.name}.` };
    for (const [key, spec] of Object.entries(props)) {
      if (!(key in args)) continue;
      if (!typeOk(args[key], spec.type)) return { error: `"${key}" should be a ${spec.type}.` };
      if (Array.isArray(spec.enum) && !spec.enum.includes(args[key])) return { error: `"${key}" must be one of ${spec.enum.join(', ')}.` };
    }
  }
  for (const key of schema?.required ?? []) if (!(key in args)) return { error: `"${key}" is required by ${tool.name} but missing.` };
  if (JSON.stringify(args).length > 20000) return { error: 'The workout is too large to send.' };
  return { args };
}
