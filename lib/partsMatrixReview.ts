import { readCache, writeCache } from '@/lib/cache';

export interface PartsMatrixReviewEntry {
  id: string;
  // snapshot of the part so the review log is self-contained
  roId: number;
  roNumber: number;
  shopNum: string;
  shopName: string;
  jobName: string;
  partName: string;
  partNumber: string;
  varianceCents: number;
  retailCents: number;
  matrixCents: number;
  // review state
  status: 'pending' | 'approved' | 'rejected';
  notes: string;
  reviewedAt?: string;
  reviewedBy?: string;
  firstSeenAt: string;
}

const CACHE_KEY = 'parts_matrix_review_v1';

export async function getPartsMatrixReview(): Promise<Map<string, PartsMatrixReviewEntry>> {
  const entries = (await readCache<PartsMatrixReviewEntry[]>(CACHE_KEY)) ?? [];
  return new Map(entries.map((e) => [e.id, e]));
}

export async function updatePartsMatrixReviewEntry(
  id: string,
  patch: {
    partData?: Pick<PartsMatrixReviewEntry, 'roId' | 'roNumber' | 'shopNum' | 'shopName' | 'jobName' | 'partName' | 'partNumber' | 'varianceCents' | 'retailCents' | 'matrixCents'>;
    status?: 'pending' | 'approved' | 'rejected';
    notes?: string;
    reviewedBy?: string;
  },
): Promise<PartsMatrixReviewEntry> {
  const map = await getPartsMatrixReview();
  const now = new Date().toISOString();
  const existing = map.get(id);

  const entry: PartsMatrixReviewEntry = existing
    ? { ...existing }
    : {
        id,
        ...(patch.partData ?? ({} as any)),
        status: 'pending',
        notes: '',
        firstSeenAt: now,
      };

  if (patch.status !== undefined) {
    entry.status = patch.status;
    entry.reviewedAt = now;
    entry.reviewedBy = patch.reviewedBy;
  }
  if (patch.notes !== undefined) entry.notes = patch.notes;
  // refresh snapshot if provided (part data can update after RO edits)
  if (patch.partData) Object.assign(entry, patch.partData);

  map.set(id, entry);
  await writeCache(CACHE_KEY, [...map.values()]);
  return entry;
}
