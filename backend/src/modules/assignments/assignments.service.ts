import { randomUUID } from 'node:crypto';
import { ConflictError, ForbiddenError, LarkIntegrationError, NotFoundError } from '../../middleware/index.js';
import type { IBitableRepository } from '../../repositories/bitable/bitable.interface.js';
import { LarkBitableRepository } from '../../repositories/bitable/lark-bitable.repository.js';
import type { Assignment, AssignmentListResult, BitableRecord, UserRole } from '../../types/index.js';
import {
  notifyDeviceAssigned,
  notifyDeviceReturned,
} from '../../services/email/notification.service.js';
import { env } from '../../config/env.js';
import { auditService } from '../audit/audit.service.js';
import { authService } from '../auth/auth.service.js';
import type {
  AssignmentQuery,
  CreateAssignmentInput,
  ReturnAssignmentInput,
  UpdateAssignmentInput,
} from './assignments.schemas.js';

const FIELD = {
  assignmentId: 'assignment_id',
  itemId: 'item_id',
  itemName: 'Item Name',
  employeeId: 'Employee ID',
  employeeName: 'Employee Name',
  assignedAt: 'Assigned At',
  returnedAt: 'Returned At',
  notes: 'Notes',
  status: 'Status',
  assignmentPhotos: 'Assignment Photos',
  returnPhotos: 'Return Photos',
} as const;

const INVENTORY_FIELD = {
  itemId: 'item_id',
  imei1: 'IMEI1',
  imei2: 'IMEI2',
  serialNumber: 'Serial Number',
  status: 'Status',
  inventoryHolder: 'Inventory Holder',
  assignedDate: 'Assigned Date',
  warehouseLocation: 'Warehouse/Location',
  remarks: 'Remarks',
} as const;


// PhotoRecord as sent from the frontend (includes base64 dataUri)
export interface PhotoRecord {
  label: 'front' | 'back' | 'extra_1' | 'extra_2' | 'extra_3';
  mimeType: string;
  sizeBytes: number;
  dataUri: string;  // base64 data URI from frontend; converted to Lark attachment on backend
  capturedAt: string; // ISO date
}

// Lightweight metadata stored in Notes (no base64 — just descriptive info)
interface PhotoMeta {
  label: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  fileName: string;   // Lark filename used during upload (for correlation)
}

interface EmbeddedTracking {
  assignedFrom?: string | undefined;
  assignedBy?: string | undefined;
  assignedByRole?: string | undefined;
  requestedBy?: string | undefined;
  requestId?: string | undefined;
  returnedBy?: string | undefined;
  returnedTo?: string | undefined;
  returnLocation?: string | undefined;
  returnCondition?: string | undefined;
}

interface EmbeddedPhotoMeta {
  assignmentPhotos?: PhotoMeta[] | undefined;
  returnPhotos?: PhotoMeta[] | undefined;
}

function parseNotesTracking(rawNotes: string): { cleanNotes: string; tracking: EmbeddedTracking; photoMeta: EmbeddedPhotoMeta; legacyPhotos?: { assignmentPhotos?: PhotoRecord[]; returnPhotos?: PhotoRecord[] } } {
  if (!rawNotes) return { cleanNotes: '', tracking: {}, photoMeta: {} };

  // Extract lightweight PHOTOMETA block (no base64, just metadata)
  let photoMeta: EmbeddedPhotoMeta = {};
  const photoMetaMatch = rawNotes.match(/<!--PHOTOMETA:(.*?)-->/s);
  if (photoMetaMatch && photoMetaMatch[1]) {
    try {
      photoMeta = JSON.parse(photoMetaMatch[1]) as EmbeddedPhotoMeta;
    } catch {
      photoMeta = {};
    }
  }

  // Also handle legacy PHOTOS blocks (for backward-compat with old records that embedded base64)
  let legacyPhotos: { assignmentPhotos?: PhotoRecord[]; returnPhotos?: PhotoRecord[] } | undefined;
  const legacyPhotosMatch = rawNotes.match(/<!--PHOTOS:(.*?)-->/s);
  if (legacyPhotosMatch && legacyPhotosMatch[1]) {
    try {
      legacyPhotos = JSON.parse(legacyPhotosMatch[1]);
    } catch {
      legacyPhotos = undefined;
    }
  }

  // Strip them out so they don't pollute Notes display
  const notesWithoutPhotos = rawNotes
    .replace(/<!--PHOTOMETA:.*?-->/s, '')
    .replace(/<!--PHOTOS:.*?-->/s, '')
    .trim();

  const match = notesWithoutPhotos.match(/<!--TRACKING:(.*?)-->/);
  if (!match || !match[1]) {
    const tracking: EmbeddedTracking = {};
    const fromMatch = notesWithoutPhotos.match(/\[(?:Source|From):\s*([^\]]+)\]/i);
    if (fromMatch && fromMatch[1]) tracking.assignedFrom = fromMatch[1].trim();
    const byMatch = notesWithoutPhotos.match(/\[Assigned by:\s*([^\]]+)\]/i);
    if (byMatch && byMatch[1]) tracking.assignedBy = byMatch[1].trim();
    const reqMatch = notesWithoutPhotos.match(/\[Requested by:\s*([^\]]+)\]/i);
    if (reqMatch && reqMatch[1]) tracking.requestedBy = reqMatch[1].trim();
    const retToMatch = notesWithoutPhotos.match(/\[Returned to:\s*([^\]]+)\]/i);
    if (retToMatch && retToMatch[1]) tracking.returnedTo = retToMatch[1].trim();
    const condMatch = notesWithoutPhotos.match(/\[Condition:\s*([^\]]+)\]/i);
    if (condMatch && condMatch[1]) tracking.returnCondition = condMatch[1].trim();
    return { cleanNotes: notesWithoutPhotos, tracking, photoMeta, ...(legacyPhotos ? { legacyPhotos } : {}) };
  }
  try {
    const tracking = JSON.parse(match[1]) as EmbeddedTracking;
    const cleanNotes = notesWithoutPhotos.replace(/<!--TRACKING:.*?-->/, '').trim();
    return { cleanNotes, tracking, photoMeta };
  } catch {
    return { cleanNotes: notesWithoutPhotos, tracking: {}, photoMeta };
  }
}

function formatNotesWithTracking(userNotes: string, tracking: EmbeddedTracking, photoMeta?: EmbeddedPhotoMeta): string {
  const parts: string[] = [];
  if (tracking.assignedFrom) parts.push(`[Source: ${tracking.assignedFrom}]`);
  if (tracking.assignedBy) parts.push(`[Assigned by: ${tracking.assignedBy}]`);
  if (tracking.requestedBy) parts.push(`[Requested by: ${tracking.requestedBy}]`);
  if (tracking.returnedTo) parts.push(`[Returned to: ${tracking.returnedTo}]`);
  if (tracking.returnCondition) parts.push(`[Condition: ${tracking.returnCondition}]`);
  if (userNotes && userNotes.trim().length > 0) parts.push(userNotes.trim());

  const humanReadable = parts.join(' ');
  const embeddedTag = `<!--TRACKING:${JSON.stringify(tracking)}-->`;

  let result = `${humanReadable} ${embeddedTag}`.trim();

  // Append lightweight photo metadata (no base64 — just label/size/timestamp info)
  if (photoMeta && (photoMeta.assignmentPhotos?.length || photoMeta.returnPhotos?.length)) {
    result = `${result} <!--PHOTOMETA:${JSON.stringify(photoMeta)}-->`.trim();
  }

  return result;
}

/**
 * Uploads photos (base64 data URIs) to Lark's media API via the repository,
 * then returns:
 *  - fileTokens: string[]  (for the Bitable attachment field)
 *  - meta: PhotoMeta[]     (lightweight metadata for Notes — no base64)
 */
async function uploadPhotosToLark(
  photos: PhotoRecord[],
  context: 'assignment' | 'return',
  repository: IBitableRepository,
): Promise<{ fileTokens: string[]; meta: PhotoMeta[] }> {
  if (!(repository instanceof LarkBitableRepository)) {
    // In tests / mock repos, skip upload and return empty tokens with metadata only
    return {
      fileTokens: [],
      meta: photos.map((p) => ({
        label: p.label,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        capturedAt: p.capturedAt,
        fileName: `${context}_${p.label}.${p.mimeType.split('/')[1] || 'jpg'}`,
      })),
    };
  }

  // Now we have the concrete LarkBitableRepository — safe to call uploadImageToLark
  const larkRepo: LarkBitableRepository = repository;
  const fileTokens: string[] = [];
  const meta: PhotoMeta[] = [];

  for (const photo of photos) {
    const ext = photo.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const fileName = `${context}_${photo.label}_${Date.now()}.${ext}`;
    try {
      const token = await larkRepo.uploadImageToLark(photo.dataUri, fileName);
      fileTokens.push(token);
      meta.push({
        label: photo.label,
        mimeType: photo.mimeType,
        sizeBytes: photo.sizeBytes,
        capturedAt: photo.capturedAt,
        fileName,
      });
    } catch (err) {
      // Log but don't block assignment — photo upload failure is non-fatal
      console.warn(`[AssignmentsService] Photo upload failed for ${fileName}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return { fileTokens, meta };
}


/**
 * Reads Lark attachment field values and converts them back to PhotoRecord[]
 * using the lightweight metadata from Notes to restore label/mimeType/sizeBytes/capturedAt.
 * The `dataUri` is set to the Lark temporary URL so images still display in the browser.
 */
function attachmentsToPhotoRecords(
  attachmentField: unknown,
  meta: PhotoMeta[],
): PhotoRecord[] {
  if (!Array.isArray(attachmentField) || attachmentField.length === 0) return [];

  return attachmentField.map((att: unknown, idx: number) => {
    const attachment = att as { file_token?: string; name?: string; type?: string; size?: number; url?: string; tmp_url?: string };
    const matchedMeta = meta[idx] ?? meta.find((m) => {
      const ext = m.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      return (attachment.name ?? '').includes(m.label) || (attachment.name ?? '').endsWith(`.${ext}`);
    });

    const fileToken = attachment.file_token || '';

    return {
      label: (matchedMeta?.label ?? 'extra_1') as PhotoRecord['label'],
      mimeType: matchedMeta?.mimeType ?? attachment.type ?? 'image/jpeg',
      sizeBytes: matchedMeta?.sizeBytes ?? attachment.size ?? 0,
      capturedAt: matchedMeta?.capturedAt ?? new Date().toISOString(),
      // Point to backend photo endpoint so browser can display it without Lark authentication
      dataUri: fileToken ? `/api/assignments/photos/${fileToken}` : '',
    };
  });
}


export interface AssignmentsServiceOptions {
  assignmentsTableId?: string;
  inventoryTableId?: string;
  skipOwnerCheck?: boolean;
  sourceLabel?: string;
}

export class AssignmentsService {
  private static photoCache = new Map<string, { buffer: Buffer; contentType: string; cachedAt: number }>();

  constructor(
    private readonly repository: IBitableRepository,
    private readonly options?: AssignmentsServiceOptions,
  ) {}

  async getPhoto(fileToken: string): Promise<{ buffer: Buffer; contentType: string }> {
    const cached = AssignmentsService.photoCache.get(fileToken);
    if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
      return { buffer: cached.buffer, contentType: cached.contentType };
    }

    if (this.repository instanceof LarkBitableRepository) {
      const { buffer, contentType } = await this.repository.downloadMediaBuffer(fileToken);
      if (AssignmentsService.photoCache.size > 200) {
        AssignmentsService.photoCache.clear();
      }
      AssignmentsService.photoCache.set(fileToken, { buffer, contentType, cachedAt: Date.now() });
      return { buffer, contentType };
    }

    throw new NotFoundError(`Photo '${fileToken}'`);
  }


  async listAll(): Promise<Assignment[]> {
    const records = await this.readAll();
    return records.map(toAssignment);
  }

  async list(query: AssignmentQuery, allowedEmpCodes?: string[]): Promise<AssignmentListResult> {
    const records = await this.readAll();
    let items = records.map(toAssignment);

    if (allowedEmpCodes && allowedEmpCodes.length > 0) {
      const lowerAllowed = allowedEmpCodes
        .map((c) => (c || '').trim().toLowerCase())
        .filter((c) => c.length > 0);

      if (lowerAllowed.length > 0) {
        items = items.filter((item) => {
          const empIdLower = item.employeeId.toLowerCase();
          const empNameLower = item.employeeName.toLowerCase();
          return lowerAllowed.some(
            (code) =>
              empIdLower === code ||
              empNameLower === code ||
              empIdLower.includes(code) ||
              empNameLower.includes(code),
          );
        });
      }
    }

    const search = (query.search || '').toLowerCase();

    const filtered = items.filter((item) => {
      const searchable = [
        item.itemName,
        item.employeeName,
        item.employeeId,
        item.notes || '',
      ].join(' ').toLowerCase();

      return (
        (search.length === 0 || searchable.includes(search)) &&
        (query.status === undefined || item.status === query.status)
      );
    });

    const start = (query.page - 1) * query.pageSize;

    return {
      records: filtered.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      activeCount: items.filter((item) => item.status === 'Active').length,
      returnedCount: items.filter((item) => item.status === 'Returned').length,
    };
  }

  async get(id: string): Promise<Assignment> {
    return (await this.resolveItem(id)).item;
  }

  async create(input: CreateAssignmentInput, user?: { role: string; name?: string; empCode?: string }): Promise<Assignment> {
    if (input.status !== 'Active') {
      throw new ConflictError('New assignments must use Active status. Return an assignment through the return workflow.');
    }

    // Duplicate Checkpoint: Assigned devices cannot be reassigned until marked as Returned.
    const all = await this.readAll();
    const active = all.map(toAssignment).filter((a) => a.status === 'Active');
    const existingActive = active.find(
      (a) => a.itemId.toLowerCase() === input.itemId.trim().toLowerCase(),
    );

    if (existingActive) {
      auditService.log({
        actorId: input.employeeId || 'tl@company.com',
        actorRole: 'TL',
        action: 'DUPLICATE_BLOCKED',
        entityType: 'Assignment',
        entityId: input.itemId,
        details: {
          reason: `Device '${input.itemId}' is already actively assigned to ${existingActive.employeeName} (${existingActive.employeeId}). Cannot reassign until marked Returned.`,
          attemptedAssignee: input.employeeName,
        },
        status: 'BLOCKED',
      });

      throw new ConflictError(
        `Duplicate Entry Checkpoint: Device '${input.itemId}' is currently assigned to ${existingActive.employeeName}. Assigned devices cannot be reassigned until marked as Returned.`,
      );
    }

    const inventory = await this.resolveInventoryDevice(input.itemId);
    const inventoryStatus = text(inventory.fields, INVENTORY_FIELD.status);
    if (inventoryStatus !== 'Inactive') {
      throw new ConflictError(
        `Device '${input.itemId}' is not available in inventory. Only Inactive devices can be assigned.`,
      );
    }

    const existingOwner = text(inventory.fields, 'Owner') || text(inventory.fields, 'TL Owner') || '';

    // Sole Owner Permission Enforcement:
    // Any inventory can be seen by anyone, but only the owner of the device (or Admin) can assign it!
    // (Skipped for Benchmark Inventory where controller access is already enforced at controller layer.)
    if (!this.options?.skipOwnerCheck && user && user.role !== 'Admin') {
      const cleanOwner = existingOwner.trim().toLowerCase();
      const isOwner = cleanOwner && (
        (user.empCode && cleanOwner.includes(user.empCode.trim().toLowerCase())) ||
        (user.name && cleanOwner.includes(user.name.trim().toLowerCase()))
      );
      if (!isOwner) {
        auditService.log({
          actorId: user.empCode || user.name || 'unauthorized_tl',
          actorRole: (user.role as UserRole) || 'TL',
          action: 'DUPLICATE_BLOCKED',
          entityType: 'Assignment',
          entityId: input.itemId,
          details: {
            reason: `Unauthorized assignment attempt: Device belongs to '${existingOwner || 'IT Stock'}', but user '${user.name} (${user.empCode})' attempted assignment.`,
            attemptedAssignee: input.employeeName,
          },
          status: 'BLOCKED',
        });
        throw new ForbiddenError(
          `Permission Denied: Device '${input.itemId}' is part of ${existingOwner || 'another TL'}'s inventory. Only the device owner or an Admin can assign this device to employees for tasks.`
        );
      }
    }

    const tracking: EmbeddedTracking = {
      assignedFrom: input.assignedFrom || 'IT Stock',
      assignedBy: input.assignedBy || 'Admin',
      assignedByRole: input.assignedByRole || 'Admin',
      requestedBy: input.requestedBy,
      requestId: input.requestId,
    };

    // Upload photos to Lark's media API, get file_tokens for the attachment field
    // and lightweight metadata for Notes (no base64 stored in Notes)
    let assignmentPhotoTokens: string[] = [];
    let assignmentPhotoMeta: PhotoMeta[] = [];
    if (input.assignmentPhotos && input.assignmentPhotos.length > 0) {
      const uploaded = await uploadPhotosToLark(
        input.assignmentPhotos as PhotoRecord[],
        'assignment',
        this.repository,
      );
      assignmentPhotoTokens = uploaded.fileTokens;
      assignmentPhotoMeta = uploaded.meta;
    }

    const photoMeta: EmbeddedPhotoMeta | undefined = assignmentPhotoMeta.length > 0
      ? { assignmentPhotos: assignmentPhotoMeta }
      : undefined;
    const formattedNotes = formatNotesWithTracking(input.notes || '', tracking, photoMeta);

    await this.repository.updateRecord(this.inventoryTableId(), inventory.recordId, {
      [INVENTORY_FIELD.status]: 'Active',
      [INVENTORY_FIELD.inventoryHolder]: input.employeeName,
      ...(existingOwner ? { ['Owner']: existingOwner } : {}),
      [INVENTORY_FIELD.assignedDate]: dateToLarkTimestamp(input.assignedAt),
      [INVENTORY_FIELD.remarks]: `Assigned on ${input.assignedAt} by ${input.assignedBy || 'Admin'} to ${input.employeeName} (Task assignment | Sole Owner: ${existingOwner || 'IT Stock'})${input.notes ? ' | ' + input.notes : ''}`,
    });

    let record: BitableRecord;
    try {
      const recordFields: Record<string, unknown> = {
        ...toFields({
          ...input,
          notes: formattedNotes,
        }),
        [FIELD.assignmentId]: randomUUID(),
      };

      // Attach uploaded photo file tokens as Lark attachment field values
      if (assignmentPhotoTokens.length > 0) {
        recordFields[FIELD.assignmentPhotos] = assignmentPhotoTokens.map((token) => ({ file_token: token }));
      }

      try {
        record = await this.repository.createRecord(this.tableId(), recordFields);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isFieldNotFound = errMsg.includes('1254045') || errMsg.includes('FieldNameNotFound');

        if (isFieldNotFound && typeof this.repository.ensureAttachmentField === 'function') {
          console.warn(`[AssignmentsService] Field '${FIELD.assignmentPhotos}' not found in Lark table. Attempting auto-creation...`);
          await this.repository.ensureAttachmentField(this.tableId(), FIELD.assignmentPhotos);
          try {
            record = await this.repository.createRecord(this.tableId(), recordFields);
          } catch (retryErr) {
            console.warn('[AssignmentsService] Retry with attachment field failed. Retrying without attachment field...', retryErr);
            delete recordFields[FIELD.assignmentPhotos];
            record = await this.repository.createRecord(this.tableId(), recordFields);
          }
        } else if (isFieldNotFound && recordFields[FIELD.assignmentPhotos]) {
          console.warn(`[AssignmentsService] Field '${FIELD.assignmentPhotos}' not found. Retrying without attachment field...`);
          delete recordFields[FIELD.assignmentPhotos];
          record = await this.repository.createRecord(this.tableId(), recordFields);
        } else {
          throw err;
        }
      }
    } catch (error) {
      await this.repository.updateRecord(this.inventoryTableId(), inventory.recordId, {
        [INVENTORY_FIELD.status]: 'Inactive',
        [INVENTORY_FIELD.inventoryHolder]: existingOwner || 'IT Stock',
        ...(existingOwner ? { ['Owner']: existingOwner } : {}),
      });
      throw error;
    }



    const created = toAssignment(record);

    auditService.log({
      actorId: input.assignedBy || input.employeeId || 'tl@company.com',
      actorRole: (input.assignedByRole as UserRole) || 'TL',
      action: 'DEVICE_ASSIGNED',
      entityType: 'Assignment',
      entityId: created.id,
      details: {
        itemName: input.itemName,
        itemId: input.itemId,
        employeeName: input.employeeName,
        employeeId: input.employeeId,
        assignedFrom: input.assignedFrom || 'IT Stock',
        assignedBy: input.assignedBy,
        requestedBy: input.requestedBy,
        requestId: input.requestId,
      },
      status: 'SUCCESS',
    });

    // Notify employee of assignment
    const empUser =
      authService.findUser(input.employeeId) || authService.findUser(input.employeeName);
    const targetEmail =
      empUser?.email || (input.employeeId && input.employeeId.includes('@') ? input.employeeId : undefined);

    if (targetEmail) {
      void notifyDeviceAssigned({
        to: targetEmail,
        employeeName: input.employeeName,
        itemName: input.itemName,
        itemId: input.itemId,
        assignedAt: input.assignedAt,
        notes: input.notes,
      });
    }

    return created;
  }

  async update(id: string, input: UpdateAssignmentInput): Promise<Assignment> {
    const { record } = await this.resolveItem(id);

    if (input.status === 'Returned' && input.status !== undefined) {
      return this.returnAssignment(id, {
        returnedAt: input.returnedAt || '',
        returnLocation: input.returnLocation || 'Main Warehouse',
        returnCondition: input.returnCondition || 'Good',
        ...(input.returnedBy !== undefined && { returnedBy: input.returnedBy }),
        ...(input.returnedTo !== undefined && { returnedTo: input.returnedTo }),
        ...(input.notes !== undefined && { notes: input.notes }),
      });
    }

    if (input.status === 'Active' && input.status !== undefined) {
      const existing = toAssignment(record);
      if (existing.status === 'Returned') {
        throw new ConflictError(
          `Assignment '${existing.id}' is already Returned. Create a new assignment record for a reassignment.`,
        );
      }
    }

    const updated = await this.repository.updateRecord(this.tableId(), record.recordId, toFields(input));
    return toAssignment(updated);
  }

  async hasActiveAssignment(itemId: string): Promise<boolean> {
    const target = itemId.trim().toLowerCase();
    const records = await this.readAll();
    return records.some((record) => {
      const assignment = toAssignment(record);
      return assignment.status === 'Active' && assignment.itemId.trim().toLowerCase() === target;
    });
  }

  async getActiveAssignmentsForEmployee(identifiers: string[]): Promise<Assignment[]> {
    const targets = identifiers.map((id) => (id || '').trim().toLowerCase()).filter(Boolean);
    if (targets.length === 0) return [];
    const records = await this.readAll();
    const assignments = records.map(toAssignment);
    return assignments.filter((a) => {
      if (a.status !== 'Active') return false;
      const empIdLower = a.employeeId.toLowerCase();
      const empNameLower = a.employeeName.toLowerCase();
      return targets.some(
        (t) =>
          empIdLower === t ||
          empNameLower === t ||
          empIdLower.includes(t) ||
          empNameLower.includes(t),
      );
    });
  }

  async returnAssignment(id: string, input: ReturnAssignmentInput): Promise<Assignment> {
    const { record, item: existing } = await this.resolveItem(id);
    let inventory = await this.findInventoryDevice(existing.itemId);
    const returnedAt = input.returnedAt || new Date().toISOString().slice(0, 10);
    const rawNotes = text(record.fields, FIELD.notes);
    const { cleanNotes, tracking: existingTracking, photoMeta: existingPhotoMeta } = parseNotesTracking(rawNotes);

    const updatedTracking: EmbeddedTracking = {
      ...existingTracking,
      returnedBy: input.returnedBy || existing.employeeName,
      returnedTo: input.returnedTo || 'IT Stock (Admin)',
      returnLocation: input.returnLocation || 'WH-1 (Main Hub)',
      returnCondition: input.returnCondition || 'Good',
    };

    const combinedUserNotes = [
      cleanNotes,
      input.notes ? `Return notes: ${input.notes}` : '',
      input.returnCondition ? `Condition: ${input.returnCondition}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    // Upload return photos to Lark's media API
    let returnPhotoTokens: string[] = [];
    let returnPhotoMeta: PhotoMeta[] = [];
    if (input.returnPhotos && input.returnPhotos.length > 0) {
      const uploaded = await uploadPhotosToLark(
        input.returnPhotos as PhotoRecord[],
        'return',
        this.repository,
      );
      returnPhotoTokens = uploaded.fileTokens;
      returnPhotoMeta = uploaded.meta;
    }

    // Merge existing photo metadata with new return photo metadata (no base64 in Notes)
    const updatedPhotoMeta: EmbeddedPhotoMeta = {
      ...(existingPhotoMeta.assignmentPhotos?.length ? { assignmentPhotos: existingPhotoMeta.assignmentPhotos } : {}),
      ...(returnPhotoMeta.length > 0 ? { returnPhotos: returnPhotoMeta } : {}),
    };

    const formattedNotes = formatNotesWithTracking(
      combinedUserNotes,
      updatedTracking,
      (updatedPhotoMeta.assignmentPhotos?.length || updatedPhotoMeta.returnPhotos?.length)
        ? updatedPhotoMeta
        : undefined,
    );

    const patch: Record<string, unknown> = {
      [FIELD.status]: 'Returned',
      [FIELD.returnedAt]: dateToLarkTimestamp(returnedAt),
      [FIELD.notes]: formattedNotes,
    };

    // Attach uploaded return photo file tokens to the Return Photos attachment field
    if (returnPhotoTokens.length > 0) {
      patch[FIELD.returnPhotos] = returnPhotoTokens.map((token) => ({ file_token: token }));
    }


    // Update Master Inventory:
    // 1. If device is in inventory, flip status to Inactive (Available in stock), set holder to IT Stock/receiver
    // 2. If device was NOT in inventory table, automatically create it into inventory so it is stored in stock!
    const existingOwner = inventory ? (text(inventory.fields, 'Owner') || text(inventory.fields, 'TL Owner')) : '';
    const returnTarget = existingOwner && existingOwner !== 'IT Stock' ? existingOwner : (input.returnedTo || 'IT Stock');

    if (!inventory) {
      const words = (existing.itemName || 'Device').trim().split(/\s+/);
      const possibleBrand = ['Itel', 'Tecno', 'Infinix', 'Oraimo', 'Villaon'].find(
        (b) => b.toLowerCase() === words[0]?.toLowerCase(),
      ) || 'Other';
      const deviceModel = words.length > 1 ? words.slice(1).join(' ') : existing.itemName || 'Returned Mobile';
      const cleanImei = existing.itemId.replace(/^[^\d]+/, '').trim() || existing.itemId;

      inventory = await this.repository.createRecord(this.inventoryTableId(), {
        [INVENTORY_FIELD.itemId]: randomUUID(),
        ['Brand']: possibleBrand,
        ['Device Model']: deviceModel,
        ['Sample HW Type']: 'PRO',
        [INVENTORY_FIELD.imei1]: cleanImei.length === 15 ? cleanImei : existing.itemId,
        [INVENTORY_FIELD.status]: 'Inactive',
        [INVENTORY_FIELD.inventoryHolder]: returnTarget,
        ['Owner']: returnTarget,
        [INVENTORY_FIELD.warehouseLocation]: input.returnLocation || 'WH-1 (Main Hub)',
        [INVENTORY_FIELD.assignedDate]: dateToLarkTimestamp(returnedAt),
        [INVENTORY_FIELD.remarks]: `Stored in inventory upon return from ${input.returnedBy || existing.employeeName} to ${returnTarget} (Condition: ${input.returnCondition || 'Good'})${input.notes ? ' | ' + input.notes : ''}`,
      });
    } else {
      await this.repository.updateRecord(this.inventoryTableId(), inventory.recordId, {
        [INVENTORY_FIELD.status]: 'Inactive',
        [INVENTORY_FIELD.inventoryHolder]: returnTarget,
        ...(existingOwner ? { ['Owner']: existingOwner } : {}),
        [INVENTORY_FIELD.warehouseLocation]: input.returnLocation || 'WH-1 (Main Hub)',
        [INVENTORY_FIELD.remarks]: `Returned on ${returnedAt} by ${input.returnedBy || existing.employeeName} to ${returnTarget} (Condition: ${input.returnCondition || 'Good'})${input.notes ? ' | ' + input.notes : ''}`,
      });
    }

    let updated: BitableRecord;
    try {
      try {
        updated = await this.repository.updateRecord(this.tableId(), record.recordId, patch);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isFieldNotFound = errMsg.includes('1254045') || errMsg.includes('FieldNameNotFound');

        if (isFieldNotFound && typeof this.repository.ensureAttachmentField === 'function') {
          console.warn(`[AssignmentsService] Field '${FIELD.returnPhotos}' not found in Lark table. Attempting auto-creation...`);
          await this.repository.ensureAttachmentField(this.tableId(), FIELD.returnPhotos);
          try {
            updated = await this.repository.updateRecord(this.tableId(), record.recordId, patch);
          } catch (retryErr) {
            console.warn('[AssignmentsService] Retry with return attachment field failed. Retrying without attachment field...', retryErr);
            delete patch[FIELD.returnPhotos];
            updated = await this.repository.updateRecord(this.tableId(), record.recordId, patch);
          }
        } else if (isFieldNotFound && patch[FIELD.returnPhotos]) {
          console.warn(`[AssignmentsService] Field '${FIELD.returnPhotos}' not found. Retrying without attachment field...`);
          delete patch[FIELD.returnPhotos];
          updated = await this.repository.updateRecord(this.tableId(), record.recordId, patch);
        } else {
          throw err;
        }
      }
    } catch (error) {
      if (inventory) {
        await this.repository.updateRecord(this.inventoryTableId(), inventory.recordId, {
          [INVENTORY_FIELD.status]: 'Active',
          [INVENTORY_FIELD.inventoryHolder]: existing.employeeName,
          ...(existingOwner ? { ['Owner']: existingOwner } : {}),
        });
      }
      throw error;
    }
    const returned = toAssignment(updated);

    auditService.log({
      actorId: input.returnedTo || existing.employeeId || 'admin@inventory.internal',
      actorRole: 'Admin',
      action: 'DEVICE_RETURNED',
      entityType: 'Assignment',
      entityId: id,
      details: {
        itemName: existing.itemName,
        itemId: existing.itemId,
        employeeName: existing.employeeName,
        employeeId: existing.employeeId,
        returnedBy: input.returnedBy || existing.employeeName,
        returnedTo: input.returnedTo || 'IT Stock',
        returnLocation: input.returnLocation || 'WH-1 (Main Hub)',
        returnCondition: input.returnCondition || 'Good',
        returnedAt,
        notes: input.notes,
      },
      status: 'SUCCESS',
    });

    // Notify employee of returned confirmation
    if (existing.employeeId && existing.employeeId.includes('@')) {
      void notifyDeviceReturned({
        to: existing.employeeId,
        employeeName: existing.employeeName,
        itemName: existing.itemName,
        returnedAt,
        ...(input.notes ? { notes: input.notes } : {}),
      });
    }

    return returned;
  }

  async exportCsv(): Promise<{ filename: string; csv: string }> {
    const records = await this.readAll();
    const items = records.map(toAssignment);

    const headers = [
      'Assignment ID',
      'Item Name',
      'IMEI / Device Identifier',
      'Employee Name',
      'Employee ID',
      'Assigned At',
      'Returned At',
      'Status',
      'Notes',
    ];

    const rows = items.map((item) => [
      item.id,
      item.itemName,
      item.itemId,
      item.employeeName,
      item.employeeId,
      item.assignedAt,
      item.returnedAt || '-',
      item.status,
      item.notes || '-',
    ]);

    const escapeCell = (cell: string | number) => {
      const str = String(cell ?? '').replace(/"/g, '""');
      return /[",\n\r]/.test(str) ? `"${str}"` : str;
    };

    const headerLine = headers.map(escapeCell).join(',');
    const rowLines = rows.map((r) => r.map(escapeCell).join(','));
    const csv = [headerLine, ...rowLines].join('\r\n');
    const filename = `Device_Assignments_Export_${new Date().toISOString().slice(0, 10)}.csv`;

    return { filename, csv };
  }

  async delete(id: string, actorId = 'system'): Promise<never> {
    auditService.log({
      actorId,
      actorRole: 'Admin',
      action: 'DELETION_BLOCKED',
      entityType: 'Assignment',
      entityId: id,
      details: 'Attempted delete on assignment entry. Prohibited by policy.',
      status: 'BLOCKED',
    });
    throw new ConflictError(
      'Deletion is strictly prohibited by policy. No deletion rights for any assignment record. Devices must be marked as Returned.',
    );
  }

  private tableId(): string {
    if (this.options?.assignmentsTableId && this.options.assignmentsTableId.length > 0) {
      return this.options.assignmentsTableId;
    }
    if (!env.LARK_TABLE_ASSIGNMENTS || env.LARK_TABLE_ASSIGNMENTS.length === 0) {
      throw new LarkIntegrationError('LARK_TABLE_ASSIGNMENTS is not configured.', 'ASSIGNMENTS_TABLE_NOT_CONFIGURED');
    }
    return env.LARK_TABLE_ASSIGNMENTS;
  }

  private inventoryTableId(): string {
    if (this.options?.inventoryTableId && this.options.inventoryTableId.length > 0) {
      return this.options.inventoryTableId;
    }
    if (!env.LARK_TABLE_INVENTORY || env.LARK_TABLE_INVENTORY.length === 0) {
      throw new LarkIntegrationError('LARK_TABLE_INVENTORY is not configured.', 'INVENTORY_TABLE_NOT_CONFIGURED');
    }
    return env.LARK_TABLE_INVENTORY;
  }

  private async findInventoryDevice(itemId: string): Promise<BitableRecord | undefined> {
    const target = itemId.trim().toLowerCase();
    const cleanTarget = target.replace(/^[^\d]+/, '').trim();
    const records: BitableRecord[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await this.repository.listRecords(this.inventoryTableId(), {
        pageSize: 100,
        ...(pageToken !== undefined && { pageToken }),
      });
      records.push(...page.records);
      pageToken = page.pageToken;
      hasMore = page.hasMore && pageToken !== undefined;
    }

    return records.find((candidate) =>
      [INVENTORY_FIELD.itemId, INVENTORY_FIELD.imei1, INVENTORY_FIELD.imei2, INVENTORY_FIELD.serialNumber]
        .some((field) => {
          const val = text(candidate.fields, field).trim().toLowerCase();
          return val === target || (cleanTarget.length > 0 && val === cleanTarget);
        }),
    );
  }

  private async resolveInventoryDevice(itemId: string): Promise<BitableRecord> {
    const record = await this.findInventoryDevice(itemId);
    if (record === undefined) {
      throw new NotFoundError(`Inventory device '${itemId}'`);
    }
    return record;
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
    return records;
  }

  private async resolveItem(id: string): Promise<{ record: BitableRecord; item: Assignment }> {
    const tableId = this.tableId();
    const byId = await this.repository.findRecordByField(tableId, FIELD.assignmentId, id);
    const record = byId ?? (await this.repository.getRecord(tableId, id));
    if (record === null) throw new NotFoundError('Assignment');
    return { record, item: toAssignment(record) };
  }
}

function toFields(input: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const fieldName = FIELD[key as keyof typeof FIELD];
    if (fieldName === undefined || value === undefined) {
      continue;
    }

    if ((key === 'assignedAt' || key === 'returnedAt') && typeof value === 'string') {
      if (value.length === 0) {
        continue;
      }
      fields[fieldName] = dateToLarkTimestamp(value);
      continue;
    }

    fields[fieldName] = value;
  }
  return fields;
}

function text(fields: BitableRecord['fields'], key: string): string {
  const value = fields[key];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && (key === FIELD.assignedAt || key === FIELD.returnedAt)) {
    return larkTimestampToDate(value);
  }
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
    throw new LarkIntegrationError('Date must be valid.', 'INVALID_DATE');
  }
  return timestamp;
}

function larkTimestampToDate(value: number): string {
  const timestamp = value < 100000000000 ? value * 1000 : value;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toAssignment(record: BitableRecord): Assignment {
  const fields = record.fields;
  const rawStatus = text(fields, FIELD.status);
  const returnedAt = text(fields, FIELD.returnedAt);
  const rawNotes = text(fields, FIELD.notes);
  const { cleanNotes, tracking, photoMeta, legacyPhotos } = parseNotesTracking(rawNotes);

  // Read photos from Lark attachment fields (new approach)
  // Fall back gracefully if the fields don't exist in the table yet
  const assignmentPhotoAttachments = fields[FIELD.assignmentPhotos];
  const returnPhotoAttachments = fields[FIELD.returnPhotos];

  const assignmentPhotos = attachmentsToPhotoRecords(
    assignmentPhotoAttachments,
    photoMeta.assignmentPhotos ?? [],
  );
  const returnPhotos = attachmentsToPhotoRecords(
    returnPhotoAttachments,
    photoMeta.returnPhotos ?? [],
  );

  const finalAssignmentPhotos = assignmentPhotos.length > 0 ? assignmentPhotos : (legacyPhotos?.assignmentPhotos ?? []);
  const finalReturnPhotos = returnPhotos.length > 0 ? returnPhotos : (legacyPhotos?.returnPhotos ?? []);

  return {
    id: text(fields, FIELD.assignmentId) || record.recordId,
    itemId: text(fields, FIELD.itemId),
    itemName: text(fields, FIELD.itemName),
    employeeId: text(fields, FIELD.employeeId),
    employeeName: text(fields, FIELD.employeeName),
    assignedAt: text(fields, FIELD.assignedAt),
    status: (rawStatus === 'Returned' ? 'Returned' : 'Active') as Assignment['status'],
    ...(returnedAt.length > 0 ? { returnedAt } : {}),
    ...(cleanNotes.length > 0 ? { notes: cleanNotes } : {}),
    ...(tracking.assignedFrom ? { assignedFrom: tracking.assignedFrom } : {}),
    ...(tracking.assignedBy ? { assignedBy: tracking.assignedBy } : {}),
    ...(tracking.assignedByRole ? { assignedByRole: tracking.assignedByRole } : {}),
    ...(tracking.requestedBy ? { requestedBy: tracking.requestedBy } : {}),
    ...(tracking.requestId ? { requestId: tracking.requestId } : {}),
    ...(tracking.returnedBy ? { returnedBy: tracking.returnedBy } : {}),
    ...(tracking.returnedTo ? { returnedTo: tracking.returnedTo } : {}),
    ...(tracking.returnLocation ? { returnLocation: tracking.returnLocation } : {}),
    ...(tracking.returnCondition ? { returnCondition: tracking.returnCondition } : {}),
    ...(finalAssignmentPhotos.length > 0 ? { assignmentPhotos: finalAssignmentPhotos } : {}),
    ...(finalReturnPhotos.length > 0 ? { returnPhotos: finalReturnPhotos } : {}),
  };
}
