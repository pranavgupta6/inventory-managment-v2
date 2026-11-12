import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client.js';
import type { InventoryItem, InventoryListResult, InventoryStatus, AuthUser } from '@/types/api.js';

export function useTeamLeads() {
  return useQuery<AuthUser[]>({
    queryKey: ['team-leads'],
    queryFn: () => apiClient.get<AuthUser[]>('/auth/team-leads'),
    staleTime: 30_000,
  });
}

export interface InventoryFilters {
  page: number;
  pageSize: number;
  search: string;
  brand: string;
  status: InventoryStatus | '';
  owner?: string;
}

const key = (filters: InventoryFilters) => ['inventory', filters] as const;

export function useInventory(filters: InventoryFilters) {
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
    queryFn: () => apiClient.get<InventoryListResult>(`/inventory?${params.toString()}`),
  });
}

export type InventoryInput = Omit<InventoryItem, 'itemId'>;

export function useInventoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inventory'] });
  const create = useMutation({
    mutationFn: (input: InventoryInput) => apiClient.post<InventoryItem>('/inventory', input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<InventoryInput> }) =>
      apiClient.patch<InventoryItem>(`/inventory/${encodeURIComponent(id)}`, input),
    onSuccess: invalidate,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => apiClient.post<InventoryItem>(`/inventory/${encodeURIComponent(id)}/deactivate`, {}),
    onSuccess: invalidate,
  });
  const bulkUpload = useMutation({
    mutationFn: (data: { items: any[]; actorId?: string; actorRole?: string }) =>
      apiClient.post<import('@/types/api.js').BulkUploadResult>('/inventory/bulk-upload', data),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['audit-duplicates'] });
    },
  });
  return { create, update, deactivate, bulkUpload };
}

export function useDeviceCustodyTracking(idOrImei?: string) {
  return useQuery({
    queryKey: ['inventory-tracking', idOrImei],
    queryFn: () =>
      apiClient.get<import('@/types/api.js').DeviceCustodyTracking>(
        `/inventory/${encodeURIComponent(idOrImei!)}/tracking`,
      ),
    enabled: !!idOrImei && idOrImei.length > 0,
  });
}
