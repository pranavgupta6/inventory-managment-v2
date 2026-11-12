import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { BitableRecord, ListBitableRecordsOptions, ListBitableRecordsResult, UserRole } from '../../types/index.js';
import type { BenchmarkControllerConfig } from './benchmark-config.js';

const testState = vi.hoisted(() => {
  process.env['NODE_ENV'] = 'test';
  process.env['LARK_APP_ID'] = 'test-app';
  process.env['LARK_APP_SECRET'] = 'test-secret';
  process.env['LARK_BITABLE_APP_TOKEN'] = 'test-base';
  process.env['LARK_TABLE_INVENTORY'] = 'tbl_inventory_test';
  process.env['LARK_TABLE_ASSIGNMENTS'] = 'tbl_assignments_test';
  process.env['LARK_TABLE_BENCHMARK'] = 'tbl_benchmark_test';
  process.env['LARK_TABLE_BENCHMARK_ASSIGNMENTS'] = 'tbl_benchmark_assignments_test';

  return {
    tables: {
      tbl_benchmark_test: [] as BitableRecord[],
      tbl_benchmark_assignments_test: [] as BitableRecord[],
    } as Record<string, BitableRecord[]>,
    seq: 1,
    controllerConfig: null as BenchmarkControllerConfig | null,
  };
});

vi.mock('./benchmark-config.js', () => ({
  getBenchmarkControllerConfig: () => testState.controllerConfig,
  setBenchmarkControllerConfig: (cfg: BenchmarkControllerConfig | null) => {
    testState.controllerConfig = cfg;
  },
  isBenchmarkController: (user?: { userId?: string; empCode?: string; email?: string }) => {
    const cfg = testState.controllerConfig;
    if (!user || !cfg || !cfg.controllerId) return false;
    const id = cfg.controllerId.trim().toLowerCase();
    const email = (cfg.controllerEmail || '').trim().toLowerCase();
    return (
      (Boolean(user.empCode) && user.empCode!.trim().toLowerCase() === id) ||
      (Boolean(user.userId) && user.userId!.trim().toLowerCase() === id) ||
      (Boolean(user.email) && Boolean(email) && user.email!.trim().toLowerCase() === email)
    );
  },
}));

vi.mock('../../repositories/bitable/lark-bitable.repository.js', () => ({
  LarkBitableRepository: class {
    private store(tableId: string): BitableRecord[] {
      if (!testState.tables[tableId]) testState.tables[tableId] = [];
      return testState.tables[tableId]!;
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
      const record: BitableRecord = { recordId: `rec-${testState.seq++}`, fields: { ...fields } };
      this.store(tableId).push(record);
      return record;
    }
    async updateRecord(tableId: string, recordId: string, fields: Record<string, unknown>): Promise<BitableRecord> {
      const rec = this.store(tableId).find((r) => r.recordId === recordId);
      if (!rec) throw new Error('not found');
      rec.fields = { ...rec.fields, ...fields };
      return rec;
    }
    async deleteRecord(): Promise<void> {}
    async uploadImageToLark(): Promise<string> {
      return 'mock_file_token';
    }
    async checkConnectivity(): Promise<boolean> {
      return true;
    }
  },
}));

import { createApp } from '../../app.js';
import { env } from '../../config/index.js';

function signUser(empCode: string, name: string, email: string, role: UserRole) {
  return jwt.sign(
    { userId: empCode, empCode, email, role, team: 'India Team', name },
    env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

const dummyPhoto = (label: 'front' | 'back') => ({
  label,
  mimeType: 'image/jpeg',
  sizeBytes: 120,
  dataUri: 'data:image/jpeg;base64,dGVzdA==',
  capturedAt: '2026-11-12T10:00:00.000Z',
});

describe('benchmark inventory routes & controller access control', () => {
  const adminToken = signUser('19101269', 'Vinod Kundra', 'vinod.kundra@transsion.com', 'Admin');
  const tlToken = signUser('19100009', 'Mohd.Shane Alam', 'shane.alam@transsion.com', 'TL');
  const empControllerToken = signUser('19101020', 'Rohan Raj Singh', 'rohan.singh@transsion.com', 'Employee');
  const otherEmployeeToken = signUser('19105163', 'Harshit Bhatnagar', 'harshit.bhatnagar@transsion.com', 'Employee');

  beforeEach(() => {
    testState.tables = {
      tbl_benchmark_test: [],
      tbl_benchmark_assignments_test: [],
    };
    testState.seq = 1;
    testState.controllerConfig = null;
  });

  it('enforces single-controller authorization across create, assign, return, tracking, deactivate, delete, and revoke', async () => {
    const app = createApp();

    const baseDevice = {
      brand: 'Tecno',
      deviceModel: 'Camon 30 Ultra 5G',
      sampleHwType: 'PRO',
      imei1: '358901100000501',
      imei2: '',
      serialNumber: 'SN-BM-501',
      vcId: 'BM-VC-2026-501',
      color: 'Alps White',
      storageRam: '12GB / 256GB',
      assignedDate: '2026-11-12',
      warehouseLocation: 'Benchmark Lab',
      inventoryHolder: 'Benchmark Pool',
      remarks: 'Benchmark route test',
    };

    // 1. Before any controller is assigned, TLs and Employees have read-only access
    expect((await request(app).get('/api/benchmark').set('Authorization', `Bearer ${tlToken}`)).status).toBe(200);
    expect((await request(app).get('/api/benchmark').set('Authorization', `Bearer ${empControllerToken}`)).status).toBe(200);
    expect(
      (await request(app).post('/api/benchmark').set('Authorization', `Bearer ${tlToken}`).send(baseDevice)).status,
    ).toBe(403);
    expect(
      (await request(app).post('/api/benchmark').set('Authorization', `Bearer ${empControllerToken}`).send(baseDevice))
        .status,
    ).toBe(403);

    // 2. Non-Admin cannot assign a controller
    expect(
      (
        await request(app)
          .post('/api/benchmark/controller/assign')
          .set('Authorization', `Bearer ${tlToken}`)
          .send({ controllerId: '19101020' })
      ).status,
    ).toBe(403);

    // 3. Admin designates Employee Rohan Raj Singh (19101020) as the sole Benchmark Controller
    const assignedController = await request(app)
      .post('/api/benchmark/controller/assign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ controllerId: '19101020' });
    expect(assignedController.status).toBe(200);
    expect(assignedController.body.data.controllerId).toBe('19101020');
    expect(assignedController.body.data.controllerRole).toBe('Employee');

    // 4. Mandatory VC ID enforced on create
    expect(
      (
        await request(app)
          .post('/api/benchmark')
          .set('Authorization', `Bearer ${empControllerToken}`)
          .send({ ...baseDevice, vcId: '' })
      ).status,
    ).toBe(400);

    // 5. Designated Employee Controller can create devices; non-controller TL/Employee are blocked (403)
    const createdRes = await request(app)
      .post('/api/benchmark')
      .set('Authorization', `Bearer ${empControllerToken}`)
      .send(baseDevice);
    expect(createdRes.status).toBe(201);
    const createdItemId = createdRes.body.data.itemId as string;

    expect(
      (
        await request(app)
          .post('/api/benchmark')
          .set('Authorization', `Bearer ${tlToken}`)
          .send({ ...baseDevice, imei1: '358901100000502', vcId: 'BM-VC-2026-502' })
      ).status,
    ).toBe(403);

    // 6. Controller can fetch eligible assignees & assign device to another employee with photos
    expect(
      (await request(app).get('/api/benchmark/assignees').set('Authorization', `Bearer ${empControllerToken}`)).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/benchmark/assignees').set('Authorization', `Bearer ${otherEmployeeToken}`)).status,
    ).toBe(403);

    const checkoutRes = await request(app)
      .post('/api/benchmark/assignments')
      .set('Authorization', `Bearer ${empControllerToken}`)
      .send({
        itemId: baseDevice.imei1,
        itemName: 'Tecno Camon 30 Ultra 5G',
        employeeName: 'Harshit Bhatnagar',
        employeeId: '19105163',
        assignedAt: '2026-11-12',
        assignedFrom: 'Benchmark Lab Pool',
        status: 'Active',
        assignmentPhotos: [dummyPhoto('front'), dummyPhoto('back')],
      });
    expect(checkoutRes.status).toBe(201);
    const assignmentId = checkoutRes.body.data.id as string;

    // 7. Device status is now Active and custody tracking shows INGESTION + ASSIGNMENT
    const activeDeviceRes = await request(app)
      .get(`/api/benchmark/${createdItemId}`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`);
    expect(activeDeviceRes.status).toBe(200);
    expect(activeDeviceRes.body.data.status).toBe('Active');

    // 8. Controller returns device with photos -> status goes back to Inactive
    const returnRes = await request(app)
      .post(`/api/benchmark/assignments/${assignmentId}/return`)
      .set('Authorization', `Bearer ${empControllerToken}`)
      .send({
        returnLocation: 'Benchmark Lab',
        returnCondition: 'Good',
        returnPhotos: [dummyPhoto('front'), dummyPhoto('back')],
      });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.data.status).toBe('Returned');

    const trackingRes = await request(app)
      .get(`/api/benchmark/${baseDevice.imei1}/tracking`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`);
    expect(trackingRes.status).toBe(200);
    expect(trackingRes.body.data.journey.map((j: { stage: string }) => j.stage)).toEqual([
      'INGESTION',
      'ASSIGNMENT',
      'RETURN',
    ]);

    // 9. Controller cannot deactivate (Admin-only) -> 403; Admin CAN deactivate -> 200
    expect(
      (
        await request(app)
          .post(`/api/benchmark/${createdItemId}/deactivate`)
          .set('Authorization', `Bearer ${empControllerToken}`)
      ).status,
    ).toBe(403);

    const deactivatedRes = await request(app)
      .post(`/api/benchmark/${createdItemId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivatedRes.status).toBe(200);
    expect(deactivatedRes.body.data.status).toBe('Inactive');

    // 10. Hard delete is blocked with 409 Conflict
    const deleteRes = await request(app)
      .delete(`/api/benchmark/${createdItemId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(409);

    // 11. Admin clears controller -> Employee immediately loses write access (403)
    const clearRes = await request(app)
      .post('/api/benchmark/controller/clear')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(clearRes.status).toBe(200);

    expect(
      (
        await request(app)
          .post('/api/benchmark')
          .set('Authorization', `Bearer ${empControllerToken}`)
          .send({ ...baseDevice, imei1: '358901100000503', vcId: 'BM-VC-2026-503' })
      ).status,
    ).toBe(403);
  }, 15_000);
});
