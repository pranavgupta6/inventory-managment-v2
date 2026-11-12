import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BitableRecord, ListBitableRecordsOptions, ListBitableRecordsResult } from '../../types/index.js';
import type { IBitableRepository } from '../../repositories/bitable/bitable.interface.js';
import { BenchmarkService } from './benchmark.service.js';
import { createBenchmarkSchema } from './benchmark.schemas.js';
import { ConflictError } from '../../middleware/error-handler.js';

const envSetup = vi.hoisted(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['LARK_TABLE_BENCHMARK'] = 'tbl_benchmark_test';
  process.env['LARK_TABLE_BENCHMARK_ASSIGNMENTS'] = 'tbl_benchmark_assignments_test';
  return {};
});
void envSetup;

class FakeBenchmarkRepository implements IBitableRepository {
  tables: Record<string, BitableRecord[]> = {
    tbl_benchmark_test: [],
    tbl_benchmark_assignments_test: [],
  };
  private seq = 1;

  private store(tableId: string): BitableRecord[] {
    if (!this.tables[tableId]) this.tables[tableId] = [];
    return this.tables[tableId]!;
  }

  async listRecords(tableId: string, _options?: ListBitableRecordsOptions): Promise<ListBitableRecordsResult> {
    return { records: [...this.store(tableId)], hasMore: false };
  }

  async findRecordByField(tableId: string, fieldName: string, value: string): Promise<BitableRecord | null> {
    return this.store(tableId).find((r) => r.fields[fieldName] === value) ?? null;
  }

  async getRecord(tableId: string, recordId: string): Promise<BitableRecord | null> {
    return this.store(tableId).find((r) => r.recordId === recordId) ?? null;
  }

  async createRecord(tableId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const record: BitableRecord = {
      recordId: `rec-${this.seq++}`,
      fields: { ...fields },
    };
    this.store(tableId).push(record);
    return record;
  }

  async updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
    const rec = this.store(tableId).find((r) => r.recordId === recordId);
    if (!rec) throw new Error(`Record ${recordId} not found`);
    rec.fields = { ...rec.fields, ...fields };
    return rec;
  }

  async deleteRecord(): Promise<void> {}
  async checkConnectivity(): Promise<boolean> {
    return true;
  }
}

const validDevice = {
  brand: 'Tecno' as const,
  deviceModel: 'Camon 30 Ultra 5G',
  sampleHwType: 'PRO' as const,
  imei1: '358901100000101',
  imei2: '',
  serialNumber: 'SN-BM-101',
  vcId: 'BM-VC-TEST-001',
  color: 'Alps White',
  storageRam: '12GB / 256GB',
  assignedDate: '2026-11-10',
  warehouseLocation: 'Benchmark Lab',
  inventoryHolder: 'Benchmark Pool',
  remarks: 'Camera benchmark suite',
  status: 'Inactive' as const,
  sampleReceivedDate: '2026-11-10',
  dateOfReceipt: '2026-11-10',
  employeeId: '',
  assignedTo: '',
};

describe('benchmark schemas', () => {
  it('enforces mandatory VC ID, 15-digit IMEI1, and defaults status to Inactive', () => {
    const parsed = createBenchmarkSchema.parse({
      brand: 'Tecno',
      deviceModel: 'Phantom V Fold2',
      sampleHwType: 'PRO',
      imei1: '358901100000999',
      vcId: 'BM-VC-999',
      assignedDate: '2026-11-10',
      warehouseLocation: 'Benchmark Lab',
      inventoryHolder: 'Benchmark Pool',
    });
    expect(parsed.status).toBe('Inactive');
    expect(() => createBenchmarkSchema.parse({ ...validDevice, vcId: '   ' })).toThrow(/VC ID is mandatory/);
    expect(() => createBenchmarkSchema.parse({ ...validDevice, imei1: '12345' })).toThrow(/15 digits/);
  });
});

describe('BenchmarkService', () => {
  let repo: FakeBenchmarkRepository;
  let service: BenchmarkService;

  beforeEach(() => {
    repo = new FakeBenchmarkRepository();
    service = new BenchmarkService(repo);
  });

  it('creates unassigned device as Inactive and checks out automatically when initial assignee is set', async () => {
    const unassigned = await service.create(
      { ...validDevice, owner: 'Rohan Raj Singh (19101020)' },
      { empCode: '19101020', name: 'Rohan Raj Singh', role: 'Employee' },
    );
    expect(unassigned.status).toBe('Inactive');
    expect(repo.tables['tbl_benchmark_assignments_test']).toHaveLength(0);

    const assigned = await service.create(
      {
        ...validDevice,
        imei1: '358901100000102',
        vcId: 'BM-VC-TEST-002',
        deviceModel: 'GT 20 Pro 5G',
        assignedTo: 'Harshit Bhatnagar',
        employeeId: '19105163',
        owner: 'Rohan Raj Singh (19101020)',
      },
      { empCode: '19101020', name: 'Rohan Raj Singh', role: 'Employee' },
    );
    expect(assigned.status).toBe('Active');
    expect(repo.tables['tbl_benchmark_assignments_test']).toHaveLength(1);

    const list = await service.list({ page: 1, pageSize: 10, search: 'camera', brand: undefined, status: undefined });
    expect(list.total).toBe(2);
    expect(list.owners).toContain('Rohan Raj Singh (19101020)');
  });

  it('enforces all duplicate checkpoints and mandatory VC ID in bulkUpload', async () => {
    await service.create(validDevice);

    const result = await service.bulkUpload({
      actorId: '19101020',
      actorRole: 'Employee',
      items: [
        // Missing VC ID -> blocked (Checkpoint 0)
        { ...validDevice, vcId: '', imei1: '358901100000201', owner: 'Rohan' },
        // Duplicate VC ID -> blocked (Checkpoint 4)
        { ...validDevice, vcId: 'BM-VC-TEST-001', imei1: '358901100000202', owner: 'Rohan' },
        // Duplicate IMEI1 -> blocked (Checkpoint 2)
        { ...validDevice, vcId: 'BM-VC-TEST-003', imei1: '358901100000101', owner: 'Rohan' },
        // Valid new item with assignee
        {
          ...validDevice,
          vcId: 'BM-VC-TEST-004',
          imei1: '358901100000204',
          deviceModel: 'Zero 40 5G',
          assignedTo: 'Harshit Bhatnagar',
          employeeId: '19105163',
          owner: 'Rohan Raj Singh (19101020)',
        },
        // Cross-row duplicate IMEI1 -> blocked (Checkpoint 3)
        { ...validDevice, vcId: 'BM-VC-TEST-005', imei1: '358901100000204', owner: 'Rohan' },
      ],
    });

    expect(result.totalProcessed).toBe(5);
    expect(result.importedCount).toBe(1);
    expect(result.blockedCount).toBe(4);
    expect(result.imported[0]?.status).toBe('Active');
  });

  it('blocks deactivation while active assignment exists, preserves immutable owner, and blocks deletion', async () => {
    const created = await service.create({
      ...validDevice,
      owner: 'Rohan Raj Singh (19101020)',
      assignedTo: 'Harshit Bhatnagar',
      employeeId: '19105163',
    });

    // Update attempts to change owner must preserve original owner
    const updated = await service.update(created.itemId, {
      owner: 'Another Person',
      remarks: 'Updated thermal test note',
    });
    expect(updated.owner).toBe('Rohan Raj Singh (19101020)');
    expect(updated.remarks).toBe('Updated thermal test note');

    // Cannot deactivate while active assignment exists
    await expect(service.deactivate(created.itemId)).rejects.toThrow(ConflictError);

    // Return assignment via benchmark assignmentsService then deactivate succeeds
    const activeAssignments = await service.assignmentsService().listAll();
    expect(activeAssignments).toHaveLength(1);
    await service.assignmentsService().returnAssignment(activeAssignments[0]!.id, {
      returnLocation: 'Benchmark Lab',
      returnCondition: 'Good',
      returnedTo: 'Rohan Raj Singh (19101020)',
    });

    const deactivated = await service.deactivate(created.itemId);
    expect(deactivated.status).toBe('Inactive');

    // Custody tracking includes INGESTION, ASSIGNMENT, RETURN
    const tracking = await service.getCustodyTracking(created.imei1);
    expect(tracking.journey.map((step) => step.stage)).toEqual(['INGESTION', 'ASSIGNMENT', 'RETURN']);

    // Deletion is always blocked
    await expect(service.delete(created.itemId, '19101269')).rejects.toThrow(/prohibited by policy/i);
  });
});
