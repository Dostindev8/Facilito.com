import { v7 as uuidv7 } from 'uuid';

export function newUuidsV7(): string {
  return uuidv7();
}

export type RoleCode = 'owner' | 'manager' | 'cashier' | 'warehouse' | 'accountant' | 'viewer';

export const ROLE_HIERARCHY: Record<RoleCode, number> = {
  owner: 100,
  manager: 80,
  cashier: 40,
  warehouse: 50,
  accountant: 60,
  viewer: 10,
};

export type CopilotActionLevel = 0 | 1 | 2 | 3;

/** Level 3 is always forbidden for Copilot — no exceptions. */
export const COPILOT_FORBIDDEN_LEVEL: CopilotActionLevel = 3;

export const COPILOT_LEVEL3_ACTIONS = [
  'move_money',
  'adjust_inventory_direct',
  'issue_ecf',
  'void_ecf',
  'change_roles',
  'delete_data',
] as const;

export type CopilotLevel3Action = (typeof COPILOT_LEVEL3_ACTIONS)[number];

export function isCopilotLevel3Action(action: string): action is CopilotLevel3Action {
  return (COPILOT_LEVEL3_ACTIONS as readonly string[]).includes(action);
}

export type FiscalStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'accepted'
  | 'accepted_conditional'
  | 'rejected'
  | 'contingency';

export type ContentStatus = 'draft' | 'review' | 'published' | 'archived';

export type CostingMethod = 'fifo' | 'weighted_average';

export const DISPLAY_TIMEZONE = 'America/Santo_Domingo';
