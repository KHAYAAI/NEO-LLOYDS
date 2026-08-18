/**
 * Split out of actions.ts deliberately: a `'use server'` file may only
 * export async functions (Next.js enforces this at build time — a plain
 * object export like a shared initial state fails with "a 'use server' file
 * can only export async functions, found object"), so the shared
 * `ActionState` shape and its initial value live in their own plain module.
 */
export interface ActionState {
  error?: string;
  success?: string;
}

export const initialActionState: ActionState = {};
