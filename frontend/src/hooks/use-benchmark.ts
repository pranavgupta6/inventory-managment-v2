import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client.js';
import type {
  Assignment,
  AssignmentListResult,
  AuthUser,
  BenchmarkControllerConfig,
  BulkUploadResult,
  DeviceCustodyTracking,
  PhotoRecord,
  InventoryItem,
  InventoryListResult,
  InventoryStatus,
} from '@/types/api.js';

// ---------------------------------------------------------------------------
// Benchmark Inventory Filters
// ---------------------------------------------------------------------------
export interface BenchmarkFilters {
  page: number;
  pageSize: number;
  search: string;
  brand: string;
  status: InventoryStatus | '';
  owner?: string;
}

export interface BenchmarkAssignmentFilters {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}

const key = (filters: BenchmarkFilters) => ['benchmark', filters] as const;

export function useBenchmark(filters: BenchmarkFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    search: filters.search,
    brand: filters.brand,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.owner ? { owner: filters.owner } : {}),
  });
  return useQuery({
    queryKey: key(filters),
    queryFn: () => apiClient.get<InventoryListResult>(`/benchmark?${params.toString()}`),
  });
}

// ---------------------------------------------------------------------------
// Benchmark Controller assignment config & eligible assignees
// ---------------------------------------------------------------------------
export function useBenchmarkController() {
  return useQuery({
    queryKey: ['benchmark-controller'],
    queryFn: () => apiClient.get<BenchmarkControllerConfig | null>('/benchmark/controller'),
    staleTime: 15_000,
  });
}

export function useBenchmarkAssignees(enabled = true) {
  return useQuery({
    queryKey: ['benchmark-assignees'],
    queryFn: () => apiClient.get<AuthUser[]>('/benchmark/assignees'),
    enabled,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Benchmark Device Custody Tracking & Assignments
// ---------------------------------------------------------------------------
export function useBenchmarkDeviceTracking(deviceIdentifier: string | null) {
  return useQuery({
    queryKey: ['benchmark-tracking', deviceIdentifier],
    queryFn: () =>
      apiClient.get<DeviceCustodyTracking>(
        `/benchmark/${encodeURIComponent(deviceIdentifier!)}/tracking`,
      ),
    enabled: Boolean(deviceIdentifier),
  });
}

export function useBenchmarkAssignments(filters: BenchmarkAssignmentFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    search: filters.search,
    ...(filters.status ? { status: filters.status } : {}),
  });
  return useQuery({
    queryKey: ['benchmark-assignments', filters],
    queryFn: () => apiClient.get<AssignmentListResult>(`/benchmark/assignments?${params.toString()}`),
  });
}

// ---------------------------------------------------------------------------
// Benchmark Mutations
// ---------------------------------------------------------------------------
export type BenchmarkInput = Omit<InventoryItem, 'itemId'> & {
  initialEmployeeName?: string;
  initialEmployeeId?: string;
  initialAssignedFrom?: string;
  initialNotes?: string;
};

export interface CreateBenchmarkAssignmentInput {
  itemId: string;
  itemName: string;
  employeeName: string;
  employeeId: string;
  assignedAt: string;
  assignedFrom?: string;
  assignedBy?: string;
  assignedByRole?: string;
  requestedBy?: string;
  notes?: string;
  status: 'Active' | 'Returned';
  assignmentPhotos?: PhotoRecord[];
}

export interface ReturnBenchmarkAssignmentInput {
  returnLocation?: string;
  returnCondition?: 'Good' | 'Minor Wear' | 'Damaged';
  notes?: string;
  returnPhotos?: PhotoRecord[];
}

export function useBenchmarkMutations() {
  const queryClient = useQueryClient();
  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['benchmark'] });
    void queryClient.invalidateQueries({ queryKey: ['benchmark-assignments'] });
    void queryClient.invalidateQueries({ queryKey: ['benchmark-tracking'] });
    void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
  };

  const create = useMutation({
    mutationFn: (input: BenchmarkInput) => apiClient.post<InventoryItem>('/benchmark', input),
    onSuccess: invalidateAll,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<BenchmarkInput> }) =>
      apiClient.patch<InventoryItem>(`/benchmark/${encodeURIComponent(id)}`, input),
    onSuccess: invalidateAll,
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => apiClient.post<InventoryItem>(`/benchmark/${encodeURIComponent(id)}/deactivate`, {}),
    onSuccess: invalidateAll,
  });

  const bulkUpload = useMutation({
    mutationFn: (data: { items: unknown[]; actorId?: string; actorRole?: string }) =>
      apiClient.post<BulkUploadResult>('/benchmark/bulk-upload', data),
    onSuccess: invalidateAll,
  });

  const assignController = useMutation({
    mutationFn: (data: { controllerId: string }) =>
      apiClient.post<BenchmarkControllerConfig>('/benchmark/controller/assign', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['benchmark-controller'] });
      void queryClient.invalidateQueries({ queryKey: ['benchmark-assignees'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  const clearController = useMutation({
    mutationFn: () => apiClient.post<null>('/benchmark/controller/clear', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['benchmark-controller'] });
      void queryClient.invalidateQueries({ queryKey: ['benchmark-assignees'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });

  return { create, update, deactivate, bulkUpload, assignController, clearController };
}

export function useBenchmarkAssignmentMutations() {
  const queryClient = useQueryClient();
  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['benchmark'] });
    void queryClient.invalidateQueries({ queryKey: ['benchmark-assignments'] });
    void queryClient.invalidateQueries({ queryKey: ['benchmark-tracking'] });
    void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
  };

  const create = useMutation({
    mutationFn: (input: CreateBenchmarkAssignmentInput) =>
      apiClient.post<Assignment>('/benchmark/assignments', input),
    onSuccess: invalidateAll,
  });

  const returnDevice = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReturnBenchmarkAssignmentInput }) =>
      apiClient.post<Assignment>(`/benchmark/assignments/${encodeURIComponent(id)}/return`, input),
    onSuccess: invalidateAll,
  });

  const exportCsv = () => apiClient.get<{ filename: string; csv: string }>('/benchmark/assignments/export');

  return { create, returnDevice, exportCsv };
}
