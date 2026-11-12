import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  LarkIntegrationError,
  NotFoundError,
  ValidationError,
} from '../../middleware/index.js';
import type { IBitableRepository } from '../../repositories/bitable/bitable.interface.js';
import type {
  BitableRecord,
  InventoryItem,
  InventoryListResult,
  DeviceCustodyTracking,
  CustodyJourneyStep,
  UserRole,
} from '../../types/index.js';
import { env } from '../../config/env.js';
import type {
  CreateBenchmarkInput,
  BenchmarkQuery,
  UpdateBenchmarkInput,
  BulkUploadBenchmarkInput,
  BulkUploadBenchmarkItem,
} from './benchmark.schemas.js';
import { auditService } from '../audit/audit.service.js';
import { AssignmentsService } from '../assignments/assignments.service.js';

// ---------------------------------------------------------------------------
// Lark field names — identical to main Inventory table structure
// ---------------------------------------------------------------------------
const FIELD = {
  itemId: 'item_id',
  brand: 'Brand',
  deviceModel: 'Device Model',
  sampleHwType: 'Sample HW Type',
  imei1: 'IMEI1',
  imei2: 'IMEI2',
  serialNumber: 'Serial Number',
  vcId: 'VC ID',
  color: 'Color',
  storageRam: 'Storage/Ram',
  assignedDate: 'Assigned Date',
  warehouseLocation: 'Warehouse/Location',
  inventoryHolder: 'Inventory Holder',
  owner: 'Owner',
  remarks: 'Remarks',
  status: 'Status',
} as const;

export interface BulkUploadBenchmarkResult {
  importedCount: number;
  blockedCount: number;
  totalProcessed: number;
  imported: InventoryItem[];
  blocked: Array<{ item: BulkUploadBenchmarkItem; reason: string }>;
}

export class BenchmarkService {
  constructor(private readonly repository: IBitableRepository) {}

  /** Returns a scoped AssignmentsService pointing to the separate Benchmark tables. */
  assignmentsService(): AssignmentsService {
    return new AssignmentsService(this.repository, {
      assignmentsTableId: this.assignmentsTableId(),
      inventoryTableId: this.tableId(),
      skipOwnerCheck: true,
      sourceLabel: 'Benchmark',
    });
  }

  async list(query: BenchmarkQuery): Promise<InventoryListResult> {
    const records = await this.readAll();
    const items = records.map(toInventoryItem);
    const search = query.search.toLowerCase();
    const filtered = items.filter((item) => {
      const searchable = [
        item.brand,
        item.deviceModel,
        item.imei1,
        item.imei2,
        item.serialNumber,
        item.vcId,
        item.warehouseLocation,
        item.inventoryHolder,
        item.owner || '',
        item.remarks || '',
      ]
        .join(' ')
        .toLowerCase();
      return (
        (search.length === 0 || searchable.includes(search)) &&
        (query.brand === undefined || item.brand === query.brand) &&
        (query.status === undefined || item.status === query.status) &&
        (query.owner === undefined || (item.owner || '').toLowerCase().includes(query.owner.toLowerCase()))
      );
    });

    const start = (query.page - 1) * query.pageSize;
    const byBrand = items.reduce<Record<string, number>>((counts, item) => {
      counts[item.brand] = (counts[item.brand] ?? 0) + 1;
      return counts;
    }, {});
    const byOwner = items.reduce<Record<string, number>>((counts, item) => {
      const o = item.owner || 'Benchmark Lab';
      counts[o] = (counts[o] ?? 0) + 1;
      return counts;
    }, {});
    const owners = Array.from(new Set(items.map((it) => it.owner || 'Benchmark Lab'))).sort();

    return {
      records: filtered.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      totalByBrand: byBrand,
      totalByOwner: byOwner,
      owners,
      activeCount: items.filter((item) => item.status === 'Active').length,
      inactiveCount: items.filter((item) => item.status === 'Inactive').length,
    };
  }

  async get(id: string): Promise<InventoryItem> {
    return (await this.resolveItem(id)).item;
  }

  async create(
    input: CreateBenchmarkInput,
    actor?: { empCode?: string; name?: string; role?: UserRole },
  ): Promise<InventoryItem> {
    const actorId = actor?.empCode || actor?.name || 'benchmark-controller';
    const actorRole = actor?.role || 'Admin';

    try {
      await this.ensureUniqueImeiAndVc(input.imei1, input.imei2 ?? '', input.vcId);
    } catch (err) {
      auditService.log({
        actorId,
        actorRole,
        action: 'DUPLICATE_BLOCKED',
        entityType: 'Inventory',
        entityId: input.imei1 || input.vcId || 'NEW_BENCHMARK',
        details: {
          source: 'benchmark',
          error: err instanceof Error ? err.message : 'Duplicate identifier',
          imei1: input.imei1,
          imei2: input.imei2,
          vcId: input.vcId,
        },
        status: 'BLOCKED',
      });
      throw err;
    }

    const owner = input.owner || 'Benchmark Lab';
    const hasInitialAssignee = Boolean(input.assignedTo?.trim() || input.employeeId?.trim());
    const holder = input.inventoryHolder || 'Benchmark Pool';

    // Always create as Inactive first so AssignmentsService can cleanly check out if initial assignee is specified
    const record = await this.repository.createRecord(this.tableId(), {
      ...toFields({
        ...input,
        inventoryHolder: holder,
        owner,
        status: 'Inactive',
      }),
      [FIELD.itemId]: randomUUID(),
      [FIELD.owner]: owner,
    });
    let item = toInventoryItem(record);

    if (hasInitialAssignee && env.LARK_TABLE_BENCHMARK_ASSIGNMENTS) {
      try {
        await this.assignmentsService().create(
          {
            itemId: item.imei1 || item.itemId,
            itemName: `${item.brand} ${item.deviceModel}`,
            employeeName: input.assignedTo?.trim() || input.employeeId?.trim() || 'Assigned User',
            employeeId: input.employeeId?.trim() || input.assignedTo?.trim() || 'EMP-UNKNOWN',
            assignedAt: input.assignedDate || new Date().toISOString().slice(0, 10),
            returnedAt: '',
            notes: input.remarks || `Initial benchmark allocation | Owner: ${owner}`,
            status: 'Active',
            assignedFrom: `Benchmark Pool (${item.warehouseLocation})`,
            assignedBy: actor?.name ? `${actor.name} (${actor.empCode || ''})` : actorId,
            assignedByRole: actorRole,
          },
          actor
            ? {
                role: actorRole,
                ...(actor.name ? { name: actor.name } : {}),
                ...(actor.empCode ? { empCode: actor.empCode } : {}),
              }
            : undefined,
        );
        item = (await this.resolveItem(item.itemId)).item;
      } catch (assignErr) {
        console.warn(`[BenchmarkService] Could not create initial assignment for ${item.imei1}:`, assignErr);
      }
    }

    auditService.log({
      actorId,
      actorRole,
      action: 'INVENTORY_CREATED',
      entityType: 'Inventory',
      entityId: item.itemId,
      details: {
        source: 'benchmark',
        brand: item.brand,
        deviceModel: item.deviceModel,
        imei1: item.imei1,
        vcId: item.vcId,
        owner: item.owner,
      },
      status: 'SUCCESS',
    });

    return item;
  }

  async bulkUpload(input: BulkUploadBenchmarkInput): Promise<BulkUploadBenchmarkResult> {
    const existingRecords = await this.readAll();
    const existingItems = existingRecords.map(toInventoryItem);

    const knownImeis = new Set<string>();
    const knownVcIds = new Set<string>();

    for (const item of existingItems) {
      if (item.imei1) knownImeis.add(item.imei1.trim());
      if (item.imei2) knownImeis.add(item.imei2.trim());
      if (item.vcId) knownVcIds.add(item.vcId.trim().toLowerCase());
    }

    const imported: InventoryItem[] = [];
    const blocked: Array<{ item: BulkUploadBenchmarkItem; reason: string }> = [];

    for (let index = 0; index < input.items.length; index++) {
      const item = input.items[index]!;
      const rowNum = index + 1;
      const imei1 = item.imei1?.trim();
      const imei2 = item.imei2?.trim() || '';
      const vcId = item.vcId?.trim() || '';

      // Checkpoint 0: VC ID Mandatory Check
      if (!vcId || vcId.length === 0) {
        const reason = `Row ${rowNum}: VC ID is mandatory. Missing or empty VC ID.`;
        blocked.push({ item, reason });
        auditService.log({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: 'DUPLICATE_BLOCKED',
          entityType: 'BulkUpload',
          entityId: imei1 || `ROW_${rowNum}`,
          details: { source: 'benchmark', row: rowNum, reason },
          status: 'BLOCKED',
        });
        continue;
      }

      // Checkpoint 1: IMEI1 format
      if (!imei1 || !/^\d{15}$/.test(imei1)) {
        const reason = `Row ${rowNum}: Invalid IMEI1 (${imei1 || 'empty'}). Exactly 15 digits required.`;
        blocked.push({ item, reason });
        auditService.log({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: 'DUPLICATE_BLOCKED',
          entityType: 'BulkUpload',
          entityId: imei1 || `ROW_${rowNum}`,
          details: { source: 'benchmark', row: rowNum, reason },
          status: 'BLOCKED',
        });
        continue;
      }

      // Checkpoint 2: Duplicate IMEI1
      if (knownImeis.has(imei1)) {
        const reason = `Row ${rowNum}: Duplicate IMEI1 '${imei1}' already exists in benchmark inventory or earlier in batch.`;
        blocked.push({ item, reason });
        auditService.log({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: 'DUPLICATE_BLOCKED',
          entityType: 'BulkUpload',
          entityId: imei1,
          details: { source: 'benchmark', row: rowNum, reason, duplicateType: 'IMEI1' },
          status: 'BLOCKED',
        });
        continue;
      }

      // Checkpoint 3: Duplicate IMEI2
      if (imei2 && /^\d{15}$/.test(imei2) && knownImeis.has(imei2)) {
        const reason = `Row ${rowNum}: Duplicate IMEI2 '${imei2}' already exists in benchmark inventory or earlier in batch.`;
        blocked.push({ item, reason });
        auditService.log({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: 'DUPLICATE_BLOCKED',
          entityType: 'BulkUpload',
          entityId: imei2,
          details: { source: 'benchmark', row: rowNum, reason, duplicateType: 'IMEI2' },
          status: 'BLOCKED',
        });
        continue;
      }

      // Checkpoint 4: Duplicate VC ID (case-insensitive)
      if (knownVcIds.has(vcId.toLowerCase())) {
        const reason = `Row ${rowNum}: Duplicate VC ID '${vcId}' already exists in benchmark inventory or earlier in batch.`;
        blocked.push({ item, reason });
        auditService.log({
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: 'DUPLICATE_BLOCKED',
          entityType: 'BulkUpload',
          entityId: vcId,
          details: { source: 'benchmark', row: rowNum, reason, duplicateType: 'VC_ID' },
          status: 'BLOCKED',
        });
        continue;
      }

      try {
        const assignedDate = item.assignedDate || new Date().toISOString().slice(0, 10);
        const itemOwner = item.owner || input.actorId || 'Benchmark Lab';
        const hasAssignee = Boolean(item.assignedTo?.trim() || item.employeeId?.trim());
        const holder = item.inventoryHolder || (hasAssignee ? item.assignedTo : 'Benchmark Pool') || itemOwner;
        const remarks = [
          item.remarks || '',
          item.sampleReceivedDate ? `Sample Received: ${item.sampleReceivedDate}` : '',
          item.dateOfReceipt ? `Receipt Date: ${item.dateOfReceipt}` : '',
          item.employeeId ? `Employee ID: ${item.employeeId}` : '',
          '[Benchmark Inventory]',
        ]
          .filter(Boolean)
          .join(' | ');

        // Create as Inactive first if an assignment will be created immediately below
        const initialStatus = hasAssignee && env.LARK_TABLE_BENCHMARK_ASSIGNMENTS
          ? 'Inactive'
          : (hasAssignee ? 'Active' : 'Inactive');

        const record = await this.repository.createRecord(this.tableId(), {
          [FIELD.itemId]: randomUUID(),
          [FIELD.brand]: item.brand,
          [FIELD.deviceModel]: item.deviceModel,
          [FIELD.sampleHwType]: item.sampleHwType || 'PRO',
          [FIELD.imei1]: imei1,
          [FIELD.imei2]: imei2,
          [FIELD.serialNumber]: item.serialNumber || '',
          [FIELD.vcId]: vcId,
          [FIELD.color]: item.color || '',
          [FIELD.storageRam]: item.storageRam || '',
          [FIELD.assignedDate]: dateToLarkTimestamp(assignedDate),
          [FIELD.warehouseLocation]: item.warehouseLocation || 'Benchmark Lab',
          [FIELD.inventoryHolder]: holder,
          [FIELD.owner]: itemOwner,
          [FIELD.remarks]: remarks,
          [FIELD.status]: initialStatus,
        });

        let createdItem = toInventoryItem(record);

        if (hasAssignee && env.LARK_TABLE_BENCHMARK_ASSIGNMENTS) {
          try {
            await this.assignmentsService().create(
              {
                itemId: imei1,
                itemName: `${item.brand} ${item.deviceModel}`,
                employeeName: item.assignedTo?.trim() || item.employeeId?.trim() || 'Assigned User',
                employeeId: item.employeeId?.trim() || item.assignedTo?.trim() || 'EMP-UNKNOWN',
                assignedAt: assignedDate,
                returnedAt: '',
                notes: `Benchmark bulk allocation: ${item.remarks || 'Benchmark test task'}`,
                status: 'Active',
                assignedFrom: `Benchmark Inventory (${item.warehouseLocation || 'Benchmark Lab'})`,
                assignedBy: input.actorId || 'Benchmark Controller',
                assignedByRole: input.actorRole || 'Admin',
              },
            );
            createdItem = (await this.resolveItem(createdItem.itemId)).item;
          } catch (assignErr) {
            console.warn(`[BenchmarkService] Auto-assignment failed for ${imei1}:`, assignErr);
          }
        }

        imported.push(createdItem);
        knownImeis.add(imei1);
        if (imei2) knownImeis.add(imei2);
        knownVcIds.add(vcId.toLowerCase());
      } catch (err) {
        const reason = `Row ${rowNum}: Failed to save - ${err instanceof Error ? err.message : 'Unknown error'}`;
        blocked.push({ item, reason });
      }
    }

    auditService.log({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'INVENTORY_BULK_UPLOAD',
      entityType: 'BulkUpload',
      entityId: `BENCHMARK_BATCH_${Date.now()}`,
      details: {
        source: 'benchmark',
        totalRows: input.items.length,
        importedCount: imported.length,
        blockedCount: blocked.length,
      },
      status: blocked.length > 0 ? 'FLAGGED' : 'SUCCESS',
    });

    return {
      importedCount: imported.length,
      blockedCount: blocked.length,
      totalProcessed: input.items.length,
      imported,
      blocked,
    };
  }

  async update(
    id: string,
    input: UpdateBenchmarkInput,
    actor?: { empCode?: string; name?: string; role?: UserRole },
  ): Promise<InventoryItem> {
    const { record, item: existing } = await this.resolveItem(id);

    if (env.LARK_TABLE_BENCHMARK_ASSIGNMENTS) {
      const hasActive = await this.assignmentsService().hasActiveAssignment(existing.itemId) ||
        (existing.imei1 ? await this.assignmentsService().hasActiveAssignment(existing.imei1) : false);

      if (input.status === 'Active' && existing.status !== 'Active' && !hasActive) {
        throw new ConflictError(
          `Benchmark device '${existing.itemId}' cannot be marked Active without a matching active benchmark assignment.`,
        );
      }

      if (input.status === 'Inactive' && existing.status === 'Active' && hasActive) {
        throw new ConflictError(
          `Benchmark device '${existing.itemId}' has an active assignment. Return the device before marking it Available/Inactive.`,
        );
      }
    }

    await this.ensureUniqueImeiAndVc(
      input.imei1 ?? existing.imei1,
      input.imei2 ?? existing.imei2,
      input.vcId ?? existing.vcId,
      existing.itemId,
    );

    const fieldsToUpdate = toFields(input);
    // Preserve immutable uploader/owner stamp
    if (existing.owner) {
      fieldsToUpdate[FIELD.owner] = existing.owner;
    }

    const updated = await this.repository.updateRecord(this.tableId(), record.recordId, fieldsToUpdate);
    const updatedItem = toInventoryItem(updated);

    auditService.log({
      actorId: actor?.empCode || actor?.name || 'benchmark-controller',
      actorRole: actor?.role || 'Admin',
      action: 'INVENTORY_UPDATED',
      entityType: 'Inventory',
      entityId: updatedItem.itemId,
      details: { source: 'benchmark', updatedFields: Object.keys(input) },
      status: 'SUCCESS',
    });

    return updatedItem;
  }

  async deactivate(
    id: string,
    actor?: { empCode?: string; name?: string; role?: UserRole },
  ): Promise<InventoryItem> {
    const { record, item } = await this.resolveItem(id);
    if (env.LARK_TABLE_BENCHMARK_ASSIGNMENTS) {
      const hasActive = await this.assignmentsService().hasActiveAssignment(item.itemId) ||
        (item.imei1 ? await this.assignmentsService().hasActiveAssignment(item.imei1) : false);
      if (hasActive) {
        throw new ConflictError(
          `Benchmark device '${item.itemId}' has an active assignment. Return the assignment before deactivating it.`,
        );
      }
    }

    const updated = await this.repository.updateRecord(this.tableId(), record.recordId, {
      [FIELD.status]: 'Inactive',
    });
    const updatedItem = toInventoryItem(updated);

    auditService.log({
      actorId: actor?.empCode || actor?.name || 'admin@inventory.internal',
      actorRole: actor?.role || 'Admin',
      action: 'INVENTORY_DEACTIVATED',
      entityType: 'Inventory',
      entityId: updatedItem.itemId,
      details: { source: 'benchmark', status: 'Inactive' },
      status: 'SUCCESS',
    });

    return updatedItem;
  }

  async delete(id: string, actorId = 'system'): Promise<never> {
    auditService.log({
      actorId,
      actorRole: 'Admin',
      action: 'DELETION_BLOCKED',
      entityType: 'Inventory',
      entityId: id,
      details: 'Attempted delete on benchmark inventory. Prohibited by policy.',
      status: 'BLOCKED',
    });
    throw new ConflictError(
      'Deletion is strictly prohibited by policy. No deletion rights for any inventory entry. Use deactivation instead.',
    );
  }

  async getCustodyTracking(idOrImei: string): Promise<DeviceCustodyTracking> {
    const records = await this.readAll();
    const items = records.map(toInventoryItem);
    const target = idOrImei.trim().toLowerCase();

    const item = items.find(
      (i) =>
        i.itemId.toLowerCase() === target ||
        i.imei1.toLowerCase() === target ||
        (i.imei2 && i.imei2.toLowerCase() === target) ||
        (i.serialNumber && i.serialNumber.toLowerCase() === target) ||
        (i.vcId && i.vcId.toLowerCase() === target),
    );

    if (!item) {
      throw new NotFoundError(`Benchmark device '${idOrImei}' not found.`);
    }

    const allAssignments = env.LARK_TABLE_BENCHMARK_ASSIGNMENTS
      ? await this.assignmentsService().listAll()
      : [];

    const matchingAssignments = allAssignments.filter((a) => {
      const aItemId = a.itemId.trim().toLowerCase();
      return (
        aItemId === item.itemId.toLowerCase() ||
        aItemId === item.imei1.toLowerCase() ||
        (item.imei2 && aItemId === item.imei2.toLowerCase()) ||
        (item.serialNumber && aItemId === item.serialNumber.toLowerCase()) ||
        (item.vcId && aItemId === item.vcId.toLowerCase())
      );
    });

    matchingAssignments.sort((a, b) => (a.assignedAt || '').localeCompare(b.assignedAt || ''));

    const allAudit = auditService.getAll();
    const relatedAudit = allAudit.filter((entry) => {
      const entId = (entry.entityId || '').toLowerCase();
      const detStr = JSON.stringify(entry.details || '').toLowerCase();
      return (
        entId === item.itemId.toLowerCase() ||
        entId === item.imei1.toLowerCase() ||
        (item.imei2 && entId === item.imei2.toLowerCase()) ||
        detStr.includes(item.imei1.toLowerCase()) ||
        detStr.includes(item.vcId.toLowerCase())
      );
    });

    const receiptDate =
      item.dateOfReceipt ||
      item.sampleReceivedDate ||
      (matchingAssignments.length > 0 ? matchingAssignments[0]?.assignedAt : '') ||
      item.assignedDate ||
      new Date().toISOString().slice(0, 10);

    const journey: CustodyJourneyStep[] = [
      {
        id: `ingest-${item.itemId}`,
        stage: 'INGESTION',
        title: `Benchmark Lab Ingestion — ${item.brand} ${item.deviceModel}`,
        timestamp: receiptDate,
        actor: item.owner || 'Benchmark Controller',
        actorRole: 'Controller',
        from: 'Benchmark Intake / OEM Sample',
        to: item.warehouseLocation || 'Benchmark Lab',
        condition: 'Benchmark Sample / Unallocated',
        details: {
          pool: 'Benchmark Inventory',
          brand: item.brand,
          deviceModel: item.deviceModel,
          sampleStage: item.sampleHwType || 'PRO',
          color: item.color,
          storageRam: item.storageRam,
          imei1: item.imei1,
          imei2: item.imei2,
          vcId: item.vcId,
          serialNumber: item.serialNumber,
          registeredBy: item.owner || 'Benchmark Lab',
        },
        verified: true,
      },
    ];

    matchingAssignments.forEach((asgn) => {
      if (asgn.requestedBy || asgn.requestId) {
        journey.push({
          id: `req-${asgn.id}`,
          stage: 'REQUISITION',
          title: `Benchmark Request by ${asgn.requestedBy || asgn.employeeName}`,
          timestamp: asgn.assignedAt,
          actor: asgn.requestedBy || asgn.employeeName,
          actorRole: 'Employee',
          from: 'R&D Testing Engineer',
          to: asgn.assignedBy || 'Benchmark Controller',
          details: { requestId: asgn.requestId, requester: asgn.requestedBy || asgn.employeeName },
          verified: true,
        });
      }

      journey.push({
        id: `asgn-${asgn.id}`,
        stage: 'ASSIGNMENT',
        title: `Checked Out to ${asgn.employeeName} (${asgn.employeeId})`,
        timestamp: asgn.assignedAt,
        actor: asgn.assignedBy || 'Benchmark Controller',
        actorRole: asgn.assignedByRole || 'Controller',
        from: asgn.assignedFrom || 'Benchmark Lab Stock',
        to: `${asgn.employeeName} (${asgn.employeeId})`,
        condition: 'In Benchmark Testing',
        details: {
          assignmentId: asgn.id,
          employeeId: asgn.employeeId,
          employeeName: asgn.employeeName,
          notes: asgn.notes,
          photos: asgn.assignmentPhotos,
        },
        verified: true,
      });

      if (asgn.status === 'Returned' && asgn.returnedAt) {
        journey.push({
          id: `ret-${asgn.id}`,
          stage: 'RETURN',
          title: `Returned by ${asgn.returnedBy || asgn.employeeName} to ${asgn.returnedTo || 'Benchmark Pool'}`,
          timestamp: asgn.returnedAt,
          actor: asgn.returnedTo || 'Benchmark Controller',
          actorRole: 'Controller',
          from: asgn.returnedBy || asgn.employeeName,
          to: asgn.returnLocation || 'Benchmark Lab',
          condition: asgn.returnCondition || 'Good / Fully Functional',
          details: {
            assignmentId: asgn.id,
            returnedBy: asgn.returnedBy || asgn.employeeName,
            returnedTo: asgn.returnedTo || 'Benchmark Pool',
            returnLocation: asgn.returnLocation || 'Benchmark Lab',
            returnCondition: asgn.returnCondition || 'Good',
            returnNotes: asgn.notes,
            photos: asgn.returnPhotos,
          },
          verified: true,
        });
      }
    });

    const activeAssignment = matchingAssignments.find((a) => a.status === 'Active');

    return {
      item,
      currentCustody: {
        holder: item.inventoryHolder || (activeAssignment ? activeAssignment.employeeName : 'Benchmark Pool'),
        location: item.warehouseLocation || 'Benchmark Lab',
        status: item.status === 'Active' ? 'Assigned / In Testing' : 'In Stock',
        since: item.assignedDate || (activeAssignment ? activeAssignment.assignedAt : receiptDate),
      },
      journey,
      activeAssignment,
      assignmentHistory: matchingAssignments,
      relatedRequests: [],
      auditTrail: relatedAudit.slice(-10),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private tableId(): string {
    const tableId = env.LARK_TABLE_BENCHMARK;
    if (!tableId || tableId.length === 0) {
      throw new LarkIntegrationError(
        'LARK_TABLE_BENCHMARK is not configured. Please set LARK_TABLE_BENCHMARK in .env',
        'BENCHMARK_TABLE_NOT_CONFIGURED',
      );
    }
    return tableId;
  }

  private assignmentsTableId(): string {
    const tableId = env.LARK_TABLE_BENCHMARK_ASSIGNMENTS;
    if (!tableId || tableId.length === 0) {
      throw new LarkIntegrationError(
        'LARK_TABLE_BENCHMARK_ASSIGNMENTS is not configured. Please set LARK_TABLE_BENCHMARK_ASSIGNMENTS in .env',
        'BENCHMARK_ASSIGNMENTS_TABLE_NOT_CONFIGURED',
      );
    }
    return tableId;
  }

  private async readAll(): Promise<BitableRecord[]> {
    const records: BitableRecord[] = [];
    let pageToken: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page = await this.repository.listRecords(this.tableId(), {
        pageSize: 100,
        ...(pageToken !== undefined && { pageToken }),
      });
      records.push(...page.records);
      pageToken = page.pageToken;
      hasMore = page.hasMore && pageToken !== undefined;
    }
    return records.filter((r) => {
      const fields = r.fields;
      if (!fields) return false;
      return (
        Boolean(fields[FIELD.deviceModel]) ||
        Boolean(fields[FIELD.imei1]) ||
        Boolean(fields[FIELD.itemId])
      );
    });
  }

  private async ensureUniqueImeiAndVc(
    imei1: string,
    imei2: string,
    vcId?: string,
    excludingId?: string,
  ): Promise<void> {
    if (!vcId || vcId.trim().length === 0) {
      throw new ValidationError('VC ID is mandatory.');
    }
    const cleanVcId = vcId.trim().toLowerCase();
    const records = await this.readAll();
    for (const record of records) {
      const item = toInventoryItem(record);
      if (item.itemId === excludingId) continue;

      if (item.imei1 === imei1 || (imei2 && item.imei1 === imei2)) {
        throw new ConflictError(`Duplicate Checkpoint: A device with IMEI '${imei1}' already exists in benchmark inventory.`);
      }
      if (imei2 && (item.imei2 === imei2 || item.imei1 === imei2)) {
        throw new ConflictError(`Duplicate Checkpoint: A device with IMEI '${imei2}' already exists in benchmark inventory.`);
      }
      if (item.vcId && item.vcId.trim().toLowerCase() === cleanVcId) {
        throw new ConflictError(`Duplicate Checkpoint: A device with VC ID '${vcId}' already exists in benchmark inventory.`);
      }
    }
  }

  private async resolveItem(id: string): Promise<{ record: BitableRecord; item: InventoryItem }> {
    const tableId = this.tableId();
    const byItemId = await this.repository.findRecordByField(tableId, FIELD.itemId, id);
    const record = byItemId ?? (await this.repository.getRecord(tableId, id));
    if (record === null) throw new NotFoundError('Benchmark device');
    return { record, item: toInventoryItem(record) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const fieldName = FIELD[key as keyof typeof FIELD];
    if (fieldName !== undefined && value !== undefined) {
      fields[fieldName] =
        key === 'assignedDate' && typeof value === 'string'
          ? dateToLarkTimestamp(value)
          : value;
    }
  }
  return fields;
}

function text(fields: BitableRecord['fields'], key: string): string {
  const value = fields[key];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && key === FIELD.assignedDate) return larkTimestampToDate(value);
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first !== null) {
      const named = first as { name?: unknown; text?: unknown };
      return typeof named.name === 'string' ? named.name : typeof named.text === 'string' ? named.text : '';
    }
  }
  if (typeof value === 'object') {
    const named = value as { name?: unknown; text?: unknown; value?: unknown };
    if (typeof named.name === 'string') return named.name;
    if (typeof named.text === 'string') return named.text;
    if (typeof named.value === 'string') return named.value;
  }
  return String(value);
}

function dateToLarkTimestamp(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    throw new LarkIntegrationError('Date must be valid YYYY-MM-DD.', 'INVALID_DATE');
  }
  return timestamp;
}

function larkTimestampToDate(value: number): string {
  const timestamp = value < 100000000000 ? value * 1000 : value;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toInventoryItem(record: BitableRecord): InventoryItem {
  const fields = record.fields;
  return {
    itemId: text(fields, FIELD.itemId) || record.recordId,
    brand: text(fields, FIELD.brand),
    deviceModel: text(fields, FIELD.deviceModel),
    sampleHwType:
      text(fields, FIELD.sampleHwType) ||
      text(fields, 'Sample/HW') ||
      text(fields, 'Sample HW Type') ||
      text(fields, 'Sample / HW Type'),
    imei1: text(fields, FIELD.imei1),
    imei2: text(fields, FIELD.imei2),
    serialNumber: text(fields, FIELD.serialNumber),
    vcId: text(fields, FIELD.vcId),
    color: text(fields, FIELD.color),
    storageRam: text(fields, FIELD.storageRam),
    assignedDate: text(fields, FIELD.assignedDate),
    warehouseLocation: text(fields, FIELD.warehouseLocation),
    inventoryHolder: text(fields, FIELD.inventoryHolder),
    owner: text(fields, FIELD.owner) || 'Benchmark Lab',
    remarks: text(fields, FIELD.remarks),
    status: text(fields, FIELD.status) === 'Inactive' ? 'Inactive' : 'Active',
  };
}
