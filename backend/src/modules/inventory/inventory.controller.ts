import type { NextFunction, Request, Response } from 'express';
import type { ApiResponse, InventoryItem, InventoryListResult, DeviceCustodyTracking } from '../../types/index.js';
import { LarkBitableRepository } from '../../repositories/bitable/lark-bitable.repository.js';
import { InventoryService, type BulkUploadResult } from './inventory.service.js';
import {
  createInventorySchema,
  updateInventorySchema,
  bulkUploadSchema,
  type InventoryQuery,
} from './inventory.schemas.js';

import { ValidationError, ForbiddenError } from '../../middleware/error-handler.js';
import { authService } from '../auth/auth.service.js';

const service = (): InventoryService => new InventoryService(new LarkBitableRepository());

function isValidOwner(ownerName: string): boolean {
  if (!ownerName) return false;
  const clean = ownerName.trim().toLowerCase();
  if (clean === 'it stock' || clean === 'it stock / pool') return true;

  const reviewers = authService.getReviewers();
  return reviewers.some((r) => {
    const rName = r.name.toLowerCase();
    const rCode = r.empCode.toLowerCase();
    return clean.includes(rName) || clean.includes(rCode) || rName.includes(clean);
  });
}

export async function listInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service().list(req.query as unknown as InventoryQuery);
    const response: ApiResponse<InventoryListResult> = { success: true, data: result };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().get(req.params.id as string);
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getDeviceTracking(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tracking = await service().getCustodyTracking(req.params.id as string);
    const response: ApiResponse<DeviceCustodyTracking> = { success: true, data: tracking };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function createInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = createInventorySchema.parse(req.body);
    let owner: string;

    if (req.user?.role === 'TL') {
      // Sole owner is strictly and automatically the TL who created/uploaded it
      owner = `${req.user.name}${req.user.empCode ? ` (${req.user.empCode})` : ''}`;
    } else if (req.user?.role === 'Admin') {
      if (raw.owner && raw.owner !== 'IT Stock' && raw.owner !== 'IT Stock / Pool') {
        if (!isValidOwner(raw.owner)) {
          throw new ValidationError(
            `Invalid inventory owner '${raw.owner}'. The sole owner must be an active registered Team Leader (TL) or Admin in the organization.`,
          );
        }
        owner = raw.owner;
      } else {
        owner = req.user?.name
          ? `${req.user.name}${req.user.empCode ? ` (${req.user.empCode})` : ''}`
          : 'IT Stock';
      }
    } else {
      throw new ForbiddenError('Only Team Leaders (TL) or Admins can register inventory hardware.');
    }

    const item = await service().create({
      ...raw,
      owner,
      inventoryHolder: raw.inventoryHolder || owner,
    });
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function bulkUploadInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawInput = bulkUploadSchema.parse(req.body);
    const actorRole = req.user?.role || rawInput.actorRole;
    const actorId = req.user?.empCode || req.user?.email || rawInput.actorId;

    if (req.user && req.user.role !== 'Admin' && req.user.role !== 'TL') {
      throw new ForbiddenError('Only Team Leaders (TL) or Admins can upload batch inventory hardware.');
    }

    // Automatic name of the TL or Admin by whom it was uploaded (immutable sole owner)
    const uploaderOwner = req.user?.name
      ? `${req.user.name}${req.user.empCode ? ` (${req.user.empCode})` : ''}`
      : undefined;

    // Sole owner for all items uploaded in this batch
    const items = rawInput.items.map((it) => {
      let owner: string;
      if (req.user?.role === 'TL') {
        owner = uploaderOwner!;
      } else if (it.owner && it.owner !== 'IT Stock' && it.owner !== 'IT Stock / Pool') {
        if (!isValidOwner(it.owner)) {
          throw new ValidationError(
            `Invalid inventory owner '${it.owner}' in bulk upload. The owner must be an active registered Team Leader (TL) or Admin.`,
          );
        }
        owner = it.owner;
      } else {
        owner = uploaderOwner || 'IT Stock';
      }

      return {
        ...it,
        owner,
        inventoryHolder: it.assignedTo || it.inventoryHolder || owner,
      };
    });

    const input = {
      items,
      actorId,
      actorRole,
    };
    const result = await service().bulkUpload(input);
    const response: ApiResponse<BulkUploadResult> = { success: true, data: result };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function updateInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().update(req.params.id as string, updateInventorySchema.parse(req.body), req.user);
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function deactivateInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().deactivate(req.params.id as string);
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function deleteInventory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service().delete(req.params.id as string, (req.query.actor as string) || 'unknown');
  } catch (error) {
    next(error);
  }
}
