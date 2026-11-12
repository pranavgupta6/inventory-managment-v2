import type { NextFunction, Request, Response } from 'express';
import type {
  ApiResponse,
  Assignment,
  AssignmentListResult,
  DeviceCustodyTracking,
  InventoryItem,
  InventoryListResult,
} from '../../types/index.js';
import { LarkBitableRepository } from '../../repositories/bitable/lark-bitable.repository.js';
import { BenchmarkService, type BulkUploadBenchmarkResult } from './benchmark.service.js';
import {
  createBenchmarkSchema,
  updateBenchmarkSchema,
  bulkUploadBenchmarkSchema,
  assignControllerSchema,
  type BenchmarkQuery,
} from './benchmark.schemas.js';
import {
  createAssignmentSchema,
  returnAssignmentSchema,
  type AssignmentQuery,
} from '../assignments/assignments.schemas.js';
import { ValidationError, ForbiddenError } from '../../middleware/error-handler.js';
import { authService } from '../auth/auth.service.js';
import { auditService } from '../audit/audit.service.js';
import {
  getBenchmarkControllerConfig,
  setBenchmarkControllerConfig,
  isBenchmarkController,
  type BenchmarkControllerConfig,
} from './benchmark-config.js';

const service = (): BenchmarkService => new BenchmarkService(new LarkBitableRepository());

/** Enforce that only Admin or the SINGLE designated Benchmark Controller can mutate Benchmark Inventory. */
function assertWriteAccess(req: Request): void {
  if (!req.user) throw new ForbiddenError('Authentication required.');
  if (req.user.role === 'Admin') return;
  if (req.user.role !== 'TL' && req.user.role !== 'Employee') {
    throw new ForbiddenError('Only the designated Benchmark Controller or Admin can control Benchmark Inventory.');
  }
  if (!isBenchmarkController(req.user)) {
    const config = getBenchmarkControllerConfig();
    const controllerLabel = config
      ? `${config.controllerName} (${config.controllerId})`
      : 'None assigned yet';
    throw new ForbiddenError(
      `Access denied. Only the designated Benchmark Controller (${controllerLabel}) or Admin can add, edit, or assign devices in Benchmark Inventory.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Controller Assignment (Admin Only)
// ---------------------------------------------------------------------------

export async function assignBenchmarkController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'Admin') {
      throw new ForbiddenError('Only Admins can assign the Benchmark Controller.');
    }

    const { controllerId } = assignControllerSchema.parse(req.body);
    const allUsers = authService.getAllUsers();
    const targetUser = allUsers.find(
      (u) =>
        u.empCode.toLowerCase() === controllerId.toLowerCase() ||
        u.id.toLowerCase() === controllerId.toLowerCase() ||
        u.email.toLowerCase() === controllerId.toLowerCase(),
    );

    if (!targetUser) {
      throw new ValidationError(`User with ID '${controllerId}' not found in the system.`);
    }

    const previous = getBenchmarkControllerConfig();
    const config: BenchmarkControllerConfig = {
      controllerId: targetUser.empCode,
      controllerName: targetUser.name,
      controllerEmail: targetUser.email,
      controllerRole: targetUser.role,
      assignedAt: new Date().toISOString(),
      assignedBy: `${req.user.name} (${req.user.empCode})`,
    };

    setBenchmarkControllerConfig(config);

    auditService.log({
      actorId: req.user.empCode,
      actorName: req.user.name,
      actorRole: 'Admin',
      action: 'INVENTORY_UPDATED',
      entityType: 'Inventory',
      entityId: 'BENCHMARK_CONTROLLER',
      details: {
        action: 'Benchmark Controller Assigned',
        previousController: previous ? `${previous.controllerName} (${previous.controllerId})` : 'None',
        newController: `${config.controllerName} (${config.controllerId}, ${config.controllerRole})`,
      },
      status: 'SUCCESS',
    });

    const response: ApiResponse<BenchmarkControllerConfig> = {
      success: true,
      data: config,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function clearBenchmarkController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'Admin') {
      throw new ForbiddenError('Only Admins can revoke the Benchmark Controller.');
    }
    const previous = getBenchmarkControllerConfig();
    setBenchmarkControllerConfig(null);

    if (previous) {
      auditService.log({
        actorId: req.user.empCode,
        actorName: req.user.name,
        actorRole: 'Admin',
        action: 'INVENTORY_UPDATED',
        entityType: 'Inventory',
        entityId: 'BENCHMARK_CONTROLLER',
        details: {
          action: 'Benchmark Controller Revoked',
          previousController: `${previous.controllerName} (${previous.controllerId})`,
        },
        status: 'SUCCESS',
      });
    }

    const response: ApiResponse<null> = { success: true, data: null };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getBenchmarkController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const config = getBenchmarkControllerConfig();
    const response: ApiResponse<BenchmarkControllerConfig | null> = {
      success: true,
      data: config,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getBenchmarkAssignees(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const users = authService.getAllUsers();
    const response: ApiResponse<typeof users> = { success: true, data: users };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Benchmark Devices CRUD
// ---------------------------------------------------------------------------

export async function listBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service().list(req.query as unknown as BenchmarkQuery);
    const response: ApiResponse<InventoryListResult> = { success: true, data: result };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().get(req.params.id as string);
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getBenchmarkDeviceTracking(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tracking = await service().getCustodyTracking(req.params.id as string);
    const response: ApiResponse<DeviceCustodyTracking> = { success: true, data: tracking };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function createBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const raw = createBenchmarkSchema.parse(req.body);

    const uploaderOwner = req.user!.name
      ? `${req.user!.name}${req.user!.empCode ? ` (${req.user!.empCode})` : ''}`
      : 'Benchmark Lab';

    const item = await service().create(
      {
        ...raw,
        owner: uploaderOwner,
        inventoryHolder: raw.inventoryHolder || 'Benchmark Pool',
      },
      { empCode: req.user!.empCode, name: req.user!.name, role: req.user!.role },
    );
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function bulkUploadBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const rawInput = bulkUploadBenchmarkSchema.parse(req.body);
    const actorId = req.user?.empCode || req.user?.email || rawInput.actorId;
    const actorRole = req.user?.role || rawInput.actorRole;

    const uploaderOwner = req.user?.name
      ? `${req.user.name}${req.user.empCode ? ` (${req.user.empCode})` : ''}`
      : 'Benchmark Lab';

    const items = rawInput.items.map((it) => ({
      ...it,
      owner: uploaderOwner,
      inventoryHolder: it.assignedTo || it.inventoryHolder || 'Benchmark Pool',
    }));

    const result = await service().bulkUpload({ items, actorId, actorRole });
    const response: ApiResponse<BulkUploadBenchmarkResult> = { success: true, data: result };
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function updateBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const item = await service().update(
      req.params.id as string,
      updateBenchmarkSchema.parse(req.body),
      req.user ? { empCode: req.user.empCode, name: req.user.name, role: req.user.role } : undefined,
    );
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function deactivateBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'Admin') {
      throw new ForbiddenError('Only Admins can deactivate Benchmark Inventory items.');
    }
    const item = await service().deactivate(req.params.id as string, {
      empCode: req.user.empCode,
      name: req.user.name,
      role: req.user.role,
    });
    const response: ApiResponse<InventoryItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function deleteBenchmark(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'Admin') {
      throw new ForbiddenError('Only Admins can attempt this action.');
    }
    await service().delete(req.params.id as string, req.user?.empCode || 'unknown');
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Benchmark Assignments (Separate Table & Controller-Enforced)
// ---------------------------------------------------------------------------

export async function listBenchmarkAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service().assignmentsService().list(req.query as unknown as AssignmentQuery);
    const response: ApiResponse<AssignmentListResult> = { success: true, data: result };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function createBenchmarkAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const raw = createAssignmentSchema.parse(req.body);
    const item = await service().assignmentsService().create(
      {
        ...raw,
        assignedBy: raw.assignedBy || (req.user ? `${req.user.name} (${req.user.empCode})` : 'Benchmark Controller'),
        assignedByRole: raw.assignedByRole || req.user?.role || 'Controller',
      },
      req.user,
    );
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function returnBenchmarkAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertWriteAccess(req);
    const raw = returnAssignmentSchema.parse(req.body);
    const item = await service().assignmentsService().returnAssignment(req.params.id as string, {
      ...raw,
      returnedTo: raw.returnedTo || (req.user ? `${req.user.name} (${req.user.empCode}, ${req.user.role})` : 'Benchmark Pool'),
    });
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function exportBenchmarkAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filename, csv } = await service().assignmentsService().exportCsv();
    const benchFilename = filename.replace('Device_Assignments_Export', 'Benchmark_Assignments_Export');
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${benchFilename}"`);
      res.send(csv);
      return;
    }
    res.json({ success: true, data: { filename: benchFilename, csv } });
  } catch (error) {
    next(error);
  }
}
