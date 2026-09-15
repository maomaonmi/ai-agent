import type { CodeGenerationEvent } from '../lib/api';

/**
 * Consumes the transport envelope at the browser boundary.
 * The backend sequence is authoritative for one Agent run; local timeline
 * sequence allocation is only a fallback for legacy events without metadata.
 */
export class CodeAgentEventBuffer {
  private readonly seenEventIds = new Set<string>();
  private lastSequence = 0;
  private readonly expectedRunId?: string;

  constructor(expectedRunId?: string) {
    this.expectedRunId = expectedRunId;
  }

  get lastAcceptedSequence(): number {
    return this.lastSequence;
  }

  accept(event: CodeGenerationEvent): CodeGenerationEvent[] {
    if (this.expectedRunId && event.run_id && event.run_id !== this.expectedRunId) {
      return [];
    }

    if (event.event_id) {
      if (this.seenEventIds.has(event.event_id)) return [];
      this.seenEventIds.add(event.event_id);
    }

    if (typeof event.sequence === 'number') {
      if (event.sequence <= this.lastSequence) return [];
      this.lastSequence = event.sequence;
    }

    return [event];
  }
}
