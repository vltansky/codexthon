export interface BulkCheckInParticipant {
  id: string;
  email: string;
}

export interface BulkCheckInResult {
  email: string;
  success: boolean;
  error?: string;
}

export async function runBulkCheckIn<T extends BulkCheckInParticipant>(
  participants: readonly T[],
  batchSize: number,
  sendBatch: (batch: readonly T[]) => Promise<BulkCheckInResult[]>,
): Promise<{ results: BulkCheckInResult[]; unprocessed: T[]; error?: string }> {
  if (batchSize < 1) throw new Error("Batch size must be positive");
  const results: BulkCheckInResult[] = [];
  for (let index = 0; index < participants.length; index += batchSize) {
    const batch = participants.slice(index, index + batchSize);
    try {
      results.push(...await sendBatch(batch));
    } catch (caught) {
      return {
        results,
        unprocessed: participants.slice(index),
        error: caught instanceof Error ? caught.message : "Bulk check-in was interrupted",
      };
    }
  }
  return { results, unprocessed: [] };
}
