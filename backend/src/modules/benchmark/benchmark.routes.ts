import { Router } from 'express';
import { validate } from '../../middleware/index.js';
import { requireRole } from '../../middleware/auth.middleware.js';
import {
  createBenchmarkSchema,
  benchmarkIdSchema,
  benchmarkQuerySchema,
  updateBenchmarkSchema,
  bulkUploadBenchmarkSchema,
  assignControllerSchema,
} from './benchmark.schemas.js';
import {
  assignmentIdSchema,
  assignmentQuerySchema,
  createAssignmentSchema,
  returnAssignmentSchema,
} from '../assignments/assignments.schemas.js';
import {
  assignBenchmarkController,
  clearBenchmarkController,
  getBenchmarkController,
  getBenchmarkAssignees,
  createBenchmark,
  bulkUploadBenchmark,
  deactivateBenchmark,
  deleteBenchmark,
  getBenchmark,
  getBenchmarkDeviceTracking,
  listBenchmark,
  updateBenchmark,
  listBenchmarkAssignments,
  createBenchmarkAssignment,
  returnBenchmarkAssignment,
  exportBenchmarkAssignments,
} from './benchmark.controller.js';

const router = Router();

const asyncRoute =
  (handler: typeof listBenchmark) =>
  (
    req: Parameters<typeof listBenchmark>[0],
    res: Parameters<typeof listBenchmark>[1],
    next: Parameters<typeof listBenchmark>[2],
  ): void => {
    void handler(req, res, next);
  };

// ── Controller management ────────────────────────────────────────────────────
router.get('/controller', asyncRoute(getBenchmarkController));
router.post(
  '/controller/assign',
  requireRole('Admin'),
  validate(assignControllerSchema),
  asyncRoute(assignBenchmarkController),
);
router.post(
  '/controller/clear',
  requireRole('Admin'),
  asyncRoute(clearBenchmarkController),
);

// ── Assignee directory (Admin or designated Controller) ──────────────────────
router.get('/assignees', asyncRoute(getBenchmarkAssignees));

// ── Separate Benchmark Assignments (Admin or designated Controller for write) ─
router.get('/assignments', validate(assignmentQuerySchema, 'query'), asyncRoute(listBenchmarkAssignments));
router.get('/assignments/export', asyncRoute(exportBenchmarkAssignments));
router.post('/assignments', validate(createAssignmentSchema), asyncRoute(createBenchmarkAssignment));
router.post(
  '/assignments/:id/return',
  validate(assignmentIdSchema, 'params'),
  validate(returnAssignmentSchema),
  asyncRoute(returnBenchmarkAssignment),
);

// ── Read operations — all authenticated users ─────────────────────────────────
router.get('/', validate(benchmarkQuerySchema, 'query'), asyncRoute(listBenchmark));
router.get('/:id/tracking', asyncRoute(getBenchmarkDeviceTracking));
router.get('/:id', validate(benchmarkIdSchema, 'params'), asyncRoute(getBenchmark));

// ── Write operations — Admin or designated Controller (enforced in controller) ─
router.post('/bulk-upload', validate(bulkUploadBenchmarkSchema), asyncRoute(bulkUploadBenchmark));
router.post('/', validate(createBenchmarkSchema), asyncRoute(createBenchmark));
router.patch(
  '/:id',
  validate(benchmarkIdSchema, 'params'),
  validate(updateBenchmarkSchema),
  asyncRoute(updateBenchmark),
);

// ── Admin-only operations ─────────────────────────────────────────────────────
router.post(
  '/:id/deactivate',
  requireRole('Admin'),
  validate(benchmarkIdSchema, 'params'),
  asyncRoute(deactivateBenchmark),
);
router.delete(
  '/:id',
  requireRole('Admin'),
  validate(benchmarkIdSchema, 'params'),
  asyncRoute(deleteBenchmark),
);

export { router as benchmarkRouter };
