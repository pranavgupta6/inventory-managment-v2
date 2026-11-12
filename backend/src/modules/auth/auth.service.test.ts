import { describe, it, expect, beforeEach } from 'vitest';
import { authService } from './auth.service.js';
import { ConflictError } from '../../middleware/error-handler.js';

describe('AuthService - Team Leads and Ownership Protection', () => {
  it('returns all 5 initial seed TLs', () => {
    const tls = authService.getTeamLeads();
    expect(tls.length).toBeGreaterThanOrEqual(5);
    const tlNames = tls.map((t) => t.name);
    expect(tlNames).toContain('Mohd.Shane Alam');
    expect(tlNames).toContain('Pranav Kumar');
    expect(tlNames).toContain('Kamal Sharma');
    expect(tlNames).toContain('Gurdeep');
    expect(tlNames).toContain('Beerendra Kumar Saraswat');
  });

  it('blocks demotion of a TL if they own devices in inventory', async () => {
    const tls = authService.getTeamLeads();
    const targetTl = tls[0]!;

    // Demotion check callback returning count > 0
    await expect(
      authService.updateUserRole(targetTl.id, 'Employee', async () => 3),
    ).rejects.toThrow(ConflictError);

    // Verify role was not changed
    const userAfter = authService.findUser(targetTl.id);
    expect(userAfter?.role).toBe('TL');
  });

  it('blocks removal of a TL if they own devices in inventory', async () => {
    const tls = authService.getTeamLeads();
    const targetTl = tls[1]!;

    // Remove check callback returning count > 0
    await expect(
      authService.removeEmployee(
        targetTl.id,
        { userId: 'admin-id', email: 'admin@transsion.com' },
        async () => false, // no active assignments
        async () => 2, // owns 2 devices
      ),
    ).rejects.toThrow(ConflictError);

    // Verify user is still in the system
    const userAfter = authService.findUser(targetTl.id);
    expect(userAfter).toBeDefined();
  });

  it('updates TL list dynamically when a new TL is added and removed', async () => {
    const initialTls = authService.getTeamLeads().length;
    const testCode = 'TL999999';

    // 1. Create a new TL
    const created = await authService.createEmployee(
      {
        name: 'Dynamic New TL',
        email: 'dynamic.tl@transsion.com',
        empCode: testCode,
        team: 'Test Engineering',
        department: 'India Overseas Station - R&D Testing',
        role: 'TL',
      },
      { userId: 'admin-id' },
    );
    expect(created.user.role).toBe('TL');

    // 2. Verify getTeamLeads reflects the addition
    const tlsAfterAdd = authService.getTeamLeads();
    expect(tlsAfterAdd.length).toBe(initialTls + 1);
    expect(tlsAfterAdd.some((t) => t.empCode === testCode)).toBe(true);

    // 3. Remove the new TL (no owned devices)
    await authService.removeEmployee(
      testCode,
      { userId: 'admin-id' },
      async () => false,
      async () => 0,
    );

    // 4. Verify getTeamLeads reflects the deletion
    const tlsAfterDelete = authService.getTeamLeads();
    expect(tlsAfterDelete.length).toBe(initialTls);
    expect(tlsAfterDelete.some((t) => t.empCode === testCode)).toBe(false);
  });
});
