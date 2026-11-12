import type { NextFunction, Request, Response } from 'express';
import type { ApiResponse, Assignment, AssignmentListResult } from '../../types/index.js';
import { LarkBitableRepository } from '../../repositories/bitable/lark-bitable.repository.js';
import { AssignmentsService } from './assignments.service.js';
import { authService } from '../auth/auth.service.js';
import {
  createAssignmentSchema,
  returnAssignmentSchema,
  updateAssignmentSchema,
  type AssignmentQuery,
} from './assignments.schemas.js';

const service = (): AssignmentsService => new AssignmentsService(new LarkBitableRepository());

export async function listAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let allowedEmpCodes: string[] | undefined;
    if (req.user) {
      if (req.user.role === 'Employee') {
        allowedEmpCodes = [req.user.empCode, req.user.email, req.user.name];
      } else if (req.user.role === 'TL') {
        const teamMembers = authService.listTeamMembers(req.user.userId);
        allowedEmpCodes = [
          req.user.empCode,
          req.user.name,
          req.user.email,
          ...teamMembers.map((m) => m.empCode),
          ...teamMembers.map((m) => m.name),
          ...teamMembers.map((m) => m.email),
        ];
      }
      // Admin sees all -> allowedEmpCodes undefined
    }

    const result = await service().list(req.query as unknown as AssignmentQuery, allowedEmpCodes);
    const response: ApiResponse<AssignmentListResult> = { success: true, data: result };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().get(req.params.id as string);
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function createAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = createAssignmentSchema.parse(req.body);
    const item = await service().create(
      {
        ...raw,
        assignedBy: raw.assignedBy || (req.user ? `${req.user.name} (${req.user.empCode})` : 'System Admin'),
        assignedByRole: raw.assignedByRole || req.user?.role || 'Admin',
      },
      req.user,
    );
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function updateAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const item = await service().update(req.params.id as string, updateAssignmentSchema.parse(req.body));
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function returnAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = returnAssignmentSchema.parse(req.body);
    const item = await service().returnAssignment(req.params.id as string, {
      ...raw,
      returnedTo: raw.returnedTo || (req.user ? `${req.user.name} (${req.user.empCode}, ${req.user.role})` : 'IT Stock'),
    });
    const response: ApiResponse<Assignment> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function exportAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { filename, csv } = await service().exportCsv();
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
      return;
    }
    res.json({ success: true, data: { filename, csv } });
  } catch (error) {
    next(error);
  }
}

export async function deleteAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service().delete(req.params.id as string, (req.query.actor as string) || 'unknown');
  } catch (error) {
    next(error);
  }
}

export async function getAssignmentPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fileToken = req.params['fileToken'] as string;
    if (!fileToken || !/^[A-Za-z0-9_-]+$/.test(fileToken)) {
      res.status(400).send('Invalid photo token');
      return;
    }
    const { buffer, contentType } = await service().getPhoto(fileToken);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
}

