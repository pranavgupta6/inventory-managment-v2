import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const envRaw = readFileSync('c:/Users/hp/OneDrive/Desktop/Inventoy V2/inventory-managment-main/.env', 'utf8');
const envMap = {};
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) {
    envMap[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const appId = envMap.LARK_APP_ID;
const appSecret = envMap.LARK_APP_SECRET;
const appToken = envMap.LARK_BITABLE_APP_TOKEN;

async function larkFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  return data;
}

const tokenData = await larkFetch(
  'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  },
);

if (tokenData.code !== 0) {
  console.error('Failed to get Lark token:', tokenData);
  process.exit(1);
}
const token = tokenData.tenant_access_token;
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

// 1. Check existing tables
const existingTablesRes = await larkFetch(
  `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables`,
  { headers },
);
if (existingTablesRes.code !== 0) {
  console.error('Failed to list tables:', existingTablesRes);
  process.exit(1);
}

const existingTables = existingTablesRes.data?.items ?? [];
let benchmarkTable = existingTables.find((t) => t.name === 'Benchmark Inventory');
let benchmarkAssignTable = existingTables.find((t) => t.name === 'Benchmark Assignments');

// 2. Create "Benchmark Inventory" table if it doesn't exist
if (!benchmarkTable) {
  console.log('Creating "Benchmark Inventory" table in Lark Base...');
  const createRes = await larkFetch(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        table: {
          name: 'Benchmark Inventory',
          default_view_name: 'All Benchmark Devices',
          fields: [
            { field_name: 'Device Model', type: 1 },
            {
              field_name: 'Brand',
              type: 3,
              property: {
                options: [
                  { name: 'Itel' },
                  { name: 'Tecno' },
                  { name: 'Infinix' },
                  { name: 'Oraimo' },
                  { name: 'Villaon' },
                  { name: 'Other' },
                ],
              },
            },
            {
              field_name: 'Sample HW Type',
              type: 3,
              property: {
                options: [
                  { name: 'PRO' },
                  { name: 'PRO-1' },
                  { name: 'PR1' },
                  { name: 'PR1-1' },
                  { name: 'PR2' },
                  { name: 'PIR' },
                  { name: 'MPR' },
                ],
              },
            },
            { field_name: 'IMEI1', type: 1 },
            { field_name: 'IMEI2', type: 1 },
            { field_name: 'Serial Number', type: 1 },
            { field_name: 'VC ID', type: 1 },
            { field_name: 'Color', type: 1 },
            { field_name: 'Storage/Ram', type: 1 },
            {
              field_name: 'Assigned Date',
              type: 5,
              property: { auto_fill: false, date_formatter: 'dd/MM/yyyy' },
            },
            { field_name: 'Warehouse/Location', type: 1 },
            { field_name: 'Inventory Holder', type: 1 },
            { field_name: 'Remarks', type: 1 },
            {
              field_name: 'Status',
              type: 3,
              property: {
                options: [{ name: 'Active' }, { name: 'Inactive' }],
              },
            },
            { field_name: 'item_id', type: 1 },
            { field_name: 'Owner', type: 1 },
          ],
        },
      }),
    },
  );
  if (createRes.code !== 0) {
    console.error('Failed to create Benchmark Inventory table:', JSON.stringify(createRes, null, 2));
    process.exit(1);
  }
  benchmarkTable = { table_id: createRes.data.table_id, name: 'Benchmark Inventory' };
  console.log('✓ Created "Benchmark Inventory":', benchmarkTable.table_id);
} else {
  console.log('✓ Found existing "Benchmark Inventory":', benchmarkTable.table_id);
}

// 3. Create "Benchmark Assignments" table if it doesn't exist
if (!benchmarkAssignTable) {
  console.log('Creating "Benchmark Assignments" table in Lark Base...');
  const createAssignRes = await larkFetch(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        table: {
          name: 'Benchmark Assignments',
          default_view_name: 'Benchmark Checkouts',
          fields: [
            { field_name: 'assignment_id', type: 1 },
            { field_name: 'item_id', type: 1 },
            { field_name: 'Item Name', type: 1 },
            { field_name: 'Employee ID', type: 1 },
            { field_name: 'Employee Name', type: 1 },
            {
              field_name: 'Assigned At',
              type: 5,
              property: { auto_fill: false, date_formatter: 'yyyy/MM/dd' },
            },
            {
              field_name: 'Returned At',
              type: 5,
              property: { auto_fill: false, date_formatter: 'yyyy/MM/dd' },
            },
            { field_name: 'Notes', type: 1 },
            {
              field_name: 'Status',
              type: 3,
              property: {
                options: [{ name: 'Active' }, { name: 'Returned' }],
              },
            },
            { field_name: 'Assignment Photos', type: 17 },
            { field_name: 'Return Photos', type: 17 },
          ],
        },
      }),
    },
  );
  if (createAssignRes.code !== 0) {
    console.error('Failed to create Benchmark Assignments table:', JSON.stringify(createAssignRes, null, 2));
    process.exit(1);
  }
  benchmarkAssignTable = { table_id: createAssignRes.data.table_id, name: 'Benchmark Assignments' };
  console.log('✓ Created "Benchmark Assignments":', benchmarkAssignTable.table_id);
} else {
  console.log('✓ Found existing "Benchmark Assignments":', benchmarkAssignTable.table_id);
}

// 4. Seed initial Benchmark Inventory records if empty
const existingBenchRecordsRes = await larkFetch(
  `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables/${benchmarkTable.table_id}/records`,
  { headers },
);
const existingBenchRecords = existingBenchRecordsRes.data?.items ?? [];

if (existingBenchRecords.length === 0) {
  console.log('Seeding initial Benchmark devices into Lark...');
  const todayTs = Date.parse('2026-11-12T00:00:00Z');
  const assign1ItemId = randomUUID();
  const assign2ItemId = randomUUID();

  const seedDevices = [
    {
      fields: {
        item_id: randomUUID(),
        Brand: 'Tecno',
        'Device Model': 'Camon 30 Ultra 5G',
        'Sample HW Type': 'PRO',
        IMEI1: '869910000000001',
        IMEI2: '869910000000011',
        'Serial Number': 'BM-SN-2026-001',
        'VC ID': 'BM-VC-2026-001',
        Color: 'Alps White',
        'Storage/Ram': '12GB / 512GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Rack A1',
        'Inventory Holder': 'Benchmark Pool',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'Dedicated Camera & AnTuTu v10 Golden Sample [Benchmark Pool]',
        Status: 'Inactive',
      },
    },
    {
      fields: {
        item_id: randomUUID(),
        Brand: 'Infinix',
        'Device Model': 'GT 20 Pro 5G',
        'Sample HW Type': 'PR1',
        IMEI1: '869910000000002',
        IMEI2: '869910000000012',
        'Serial Number': 'BM-SN-2026-002',
        'VC ID': 'BM-VC-2026-002',
        Color: 'Mecha Orange',
        'Storage/Ram': '12GB / 256GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Rack A2',
        'Inventory Holder': 'Benchmark Pool',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'GFXBench & 120FPS Sustained Thermal Benchmark Unit [Benchmark Pool]',
        Status: 'Inactive',
      },
    },
    {
      fields: {
        item_id: randomUUID(),
        Brand: 'Itel',
        'Device Model': 'RS4 Gaming Edition',
        'Sample HW Type': 'MPR',
        IMEI1: '869910000000003',
        IMEI2: '',
        'Serial Number': 'BM-SN-2026-003',
        'VC ID': 'BM-VC-2026-003',
        Color: 'Elegant Black',
        'Storage/Ram': '8GB / 256GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Rack B1',
        'Inventory Holder': 'Benchmark Pool',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'PCMark Work 3.0 & Memory I/O Baseline Reference [Benchmark Pool]',
        Status: 'Inactive',
      },
    },
    {
      fields: {
        item_id: randomUUID(),
        Brand: 'Tecno',
        'Device Model': 'Phantom V Fold2 5G',
        'Sample HW Type': 'PRO-1',
        IMEI1: '869910000000004',
        IMEI2: '869910000000014',
        'Serial Number': 'BM-SN-2026-004',
        'VC ID': 'BM-VC-2026-004',
        Color: 'Karst Green',
        'Storage/Ram': '12GB / 512GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Vault 1',
        'Inventory Holder': 'Benchmark Pool',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'Flagship Display Power & Foldable Hinge Cycle Benchmark [Benchmark Pool]',
        Status: 'Inactive',
      },
    },
    {
      fields: {
        item_id: assign1ItemId,
        Brand: 'Infinix',
        'Device Model': 'Zero 40 5G',
        'Sample HW Type': 'PR2',
        IMEI1: '869910000000005',
        IMEI2: '869910000000015',
        'Serial Number': 'BM-SN-2026-005',
        'VC ID': 'BM-VC-2026-005',
        Color: 'Violet Garden',
        'Storage/Ram': '12GB / 256GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Station 3',
        'Inventory Holder': 'Rohan Raj Singh',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'Assigned on 2026-11-12 to Rohan Raj Singh for 3DMark Wild Life Extreme Run',
        Status: 'Active',
      },
    },
    {
      fields: {
        item_id: assign2ItemId,
        Brand: 'Tecno',
        'Device Model': 'Pova 6 Pro 5G',
        'Sample HW Type': 'PR1-1',
        IMEI1: '869910000000006',
        IMEI2: '',
        'Serial Number': 'BM-SN-2026-006',
        'VC ID': 'BM-VC-2026-006',
        Color: 'Comet Green',
        'Storage/Ram': '12GB / 256GB',
        'Assigned Date': todayTs,
        'Warehouse/Location': 'Benchmark Lab - Station 5',
        'Inventory Holder': 'Harshit Bhatnagar',
        Owner: 'Vinod Kundra (19101269)',
        Remarks: 'Assigned on 2026-11-12 to Harshit Bhatnagar for Geekbench 6 & Battery Drain Suite',
        Status: 'Active',
      },
    },
  ];

  const batchCreateRes = await larkFetch(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables/${benchmarkTable.table_id}/records/batch_create`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ records: seedDevices }),
    },
  );
  if (batchCreateRes.code !== 0) {
    console.error('Failed to seed Benchmark Inventory records:', JSON.stringify(batchCreateRes, null, 2));
    process.exit(1);
  }
  console.log(`✓ Seeded ${seedDevices.length} Benchmark devices into Lark.`);

  // 5. Seed matching Active assignments in Benchmark Assignments
  const seedAssignments = [
    {
      fields: {
        assignment_id: randomUUID(),
        item_id: '869910000000005',
        'Item Name': 'Infinix Zero 40 5G',
        'Employee ID': '19101020',
        'Employee Name': 'Rohan Raj Singh',
        'Assigned At': todayTs,
        Notes: '[Source: Benchmark Lab - Station 3] [Assigned by: Vinod Kundra (19101269)] 3DMark Wild Life Extreme Benchmark Run <!--TRACKING:{"assignedFrom":"Benchmark Lab","assignedBy":"Vinod Kundra (19101269)","assignedByRole":"Admin"}-->',
        Status: 'Active',
      },
    },
    {
      fields: {
        assignment_id: randomUUID(),
        item_id: '869910000000006',
        'Item Name': 'Tecno Pova 6 Pro 5G',
        'Employee ID': '19105163',
        'Employee Name': 'Harshit Bhatnagar',
        'Assigned At': todayTs,
        Notes: '[Source: Benchmark Lab - Station 5] [Assigned by: Vinod Kundra (19101269)] Geekbench 6 & Battery Drain Suite <!--TRACKING:{"assignedFrom":"Benchmark Lab","assignedBy":"Vinod Kundra (19101269)","assignedByRole":"Admin"}-->',
        Status: 'Active',
      },
    },
  ];

  const batchAssignRes = await larkFetch(
    `https://open.larksuite.com/open-apis/bitable/v1/apps/${appToken}/tables/${benchmarkAssignTable.table_id}/records/batch_create`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ records: seedAssignments }),
    },
  );
  if (batchAssignRes.code !== 0) {
    console.error('Failed to seed Benchmark Assignments:', JSON.stringify(batchAssignRes, null, 2));
    process.exit(1);
  }
  console.log(`✓ Seeded ${seedAssignments.length} Benchmark assignment records into Lark.`);
} else {
  console.log(`Benchmark Inventory already has ${existingBenchRecords.length} records; skipping seed.`);
}

console.log('\n=== LARK TABLE IDS ===');
console.log(`LARK_TABLE_BENCHMARK="${benchmarkTable.table_id}"`);
console.log(`LARK_TABLE_BENCHMARK_ASSIGNMENTS="${benchmarkAssignTable.table_id}"`);
