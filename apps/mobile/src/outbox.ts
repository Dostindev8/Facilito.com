/**
 * Offline-first outbox: sync movements (append-only), never balances.
 * Critical conflicts go to human review — never silent.
 */
export type OutboxOp = {
  clientUuid: string;
  type: 'sale' | 'movement';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type SyncConflict = {
  clientUuid: string;
  reason: 'price_conflict' | 'insufficient_stock' | 'other';
  local: unknown;
  remote: unknown;
};

export class OutboxEngine {
  private queue: OutboxOp[] = [];
  private conflicts: SyncConflict[] = [];
  private online = true;

  setOnline(v: boolean): void {
    this.online = v;
  }

  isOnline(): boolean {
    return this.online;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  enqueue(op: OutboxOp): void {
    if (this.queue.some((q) => q.clientUuid === op.clientUuid)) return;
    this.queue.push(op);
  }

  listConflicts(): SyncConflict[] {
    return [...this.conflicts];
  }

  /** Returns ops to send; caller reports results. */
  drain(): OutboxOp[] {
    const batch = [...this.queue];
    this.queue = [];
    return batch;
  }

  requeue(ops: OutboxOp[]): void {
    for (const op of ops) this.enqueue(op);
  }

  addConflict(c: SyncConflict): void {
    this.conflicts.push(c);
  }

  resolveConflict(clientUuid: string): void {
    this.conflicts = this.conflicts.filter((c) => c.clientUuid !== clientUuid);
  }
}
