/**
 * Demo seed data extracted verbatim from the design prototype
 * (`Plynth.dc.html` → `class Component extends DCLogic`).
 *
 * - Project/doc names, descriptions, colors, types and ids are exact.
 * - Each doc's `model` is the prototype's `this.SEEDS[docId]` object, reproduced
 *   field-for-field, with an added `type` discriminator so it satisfies
 *   `DiagramModel = { type: DiagramType } & Record<string, unknown>`.
 * - The prototype used relative `updated` labels ("2h ago", "yesterday", …);
 *   these are converted to ISO timestamps relative to a fixed base (`NOW`).
 */
import type { Project } from '@plynth/shared';

const NOW = new Date('2026-06-26T15:00:00Z').getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Relative label → ISO timestamp (offset subtracted from NOW). */
const ago = (offsetMs: number): string => new Date(NOW - offsetMs).toISOString();

/* ------------------------------------------------------------------------- *
 * Seed models — one per demo document, reproduced verbatim from the prototype.
 * ------------------------------------------------------------------------- */

// d_ecom — E-Commerce Domain (class)
const ecommerce = {
  type: 'class' as const,
  classes: [
    { id: 1, name: 'Customer', stereotype: null, x: 40, y: 300, attrs: ['- id: UUID', '- name: String', '- email: String'], methods: ['+ placeOrder(): Order', '+ orders(): List<Order>'] },
    { id: 2, name: 'Order', stereotype: null, x: 400, y: 260, attrs: ['- id: UUID', '- placedAt: Date', '- status: OrderStatus'], methods: ['+ total(): Money', '+ addLine(p, qty)'] },
    { id: 3, name: 'OrderLine', stereotype: null, x: 780, y: 300, attrs: ['- quantity: int', '- unitPrice: Money'], methods: ['+ subtotal(): Money'] },
    { id: 4, name: 'Product', stereotype: null, x: 1120, y: 260, attrs: ['- sku: String', '- title: String', '- price: Money'], methods: ['+ inStock(): boolean'] },
    { id: 5, name: 'Payable', stereotype: 'interface', x: 420, y: 40, attrs: [], methods: ['+ amount(): Money'] },
    { id: 6, name: 'Payment', stereotype: 'abstract', x: 400, y: 540, attrs: ['# id: UUID', '# paidAt: Date'], methods: ['+ amount(): Money', '+ capture(): boolean'] },
    { id: 7, name: 'CardPayment', stereotype: null, x: 200, y: 760, attrs: ['- last4: String', '- brand: String'], methods: ['+ capture(): boolean'] },
    { id: 8, name: 'PayPalPayment', stereotype: null, x: 600, y: 760, attrs: ['- account: String'], methods: ['+ capture(): boolean'] },
    { id: 9, name: 'Address', stereotype: null, x: 40, y: 560, attrs: ['- street: String', '- city: String', '- postal: String'], methods: [] },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2, type: 'association', fromMult: '1', toMult: '*', label: 'places' },
    { id: 'r2', from: 2, to: 3, type: 'composition', toMult: '1..*' },
    { id: 'r3', from: 3, to: 4, type: 'association', toMult: '1', label: 'refers to' },
    { id: 'r4', from: 2, to: 6, type: 'association', toMult: '0..1', label: 'paid by' },
    { id: 'r5', from: 6, to: 5, type: 'realization' },
    { id: 'r6', from: 7, to: 6, type: 'generalization' },
    { id: 'r7', from: 8, to: 6, type: 'generalization' },
    { id: 'r8', from: 1, to: 9, type: 'aggregation', toMult: '*', label: 'ships to' },
  ],
  frames: [
    { id: 'fc1', type: 'frame', label: 'Checkout', x: 140, y: 210, w: 700, h: 700 },
    { id: 'fp1', type: 'package', label: 'payments', x: 170, y: 500, w: 640, h: 380 },
  ],
};

// d_cat — Catalog Model (class)
const catalog = {
  type: 'class' as const,
  classes: [
    { id: 1, name: 'Catalog', stereotype: null, x: 40, y: 40, attrs: ['- id: UUID'], methods: ['+ search(q): List<Item>'] },
    { id: 2, name: 'Item', stereotype: null, x: 360, y: 40, attrs: ['- sku: String', '- name: String', '- price: Money'], methods: ['+ inStock(): boolean'] },
    { id: 3, name: 'Category', stereotype: null, x: 360, y: 300, attrs: ['- slug: String', '- title: String'], methods: [] },
    { id: 4, name: 'Warehouse', stereotype: null, x: 40, y: 300, attrs: ['- code: String', '- region: String'], methods: ['+ stock(item): int'] },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2, type: 'aggregation', toMult: '*' },
    { id: 'r2', from: 2, to: 3, type: 'association', toMult: '1', label: 'in' },
    { id: 'r3', from: 4, to: 2, type: 'association', toMult: '*', label: 'stocks' },
  ],
};

// d_orders — Orders Schema (erd)
const ordersErd = {
  type: 'erd' as const,
  entities: [
    { id: 1, name: 'customers', x: 40, y: 60, cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'name', type: 'varchar', key: '' }, { name: 'email', type: 'varchar', key: '' }, { name: 'created_at', type: 'timestamptz', key: '' }], weak: false },
    { id: 2, name: 'orders', x: 430, y: 40, cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'customer_id', type: 'uuid', key: 'FK' }, { name: 'status', type: 'varchar', key: '' }, { name: 'placed_at', type: 'timestamptz', key: '' }, { name: 'total', type: 'numeric', key: '' }], weak: false },
    { id: 3, name: 'order_items', x: 860, y: 30, cols: [{ name: 'order_id', type: 'uuid', key: 'PK FK' }, { name: 'product_id', type: 'uuid', key: 'PK FK' }, { name: 'qty', type: 'int', key: '' }, { name: 'unit_price', type: 'numeric', key: '' }], weak: true },
    { id: 4, name: 'products', x: 860, y: 360, cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'sku', type: 'varchar', key: '' }, { name: 'title', type: 'varchar', key: '' }, { name: 'price', type: 'numeric', key: '' }], weak: false },
    { id: 5, name: 'payments', x: 430, y: 400, cols: [{ name: 'id', type: 'uuid', key: 'PK' }, { name: 'order_id', type: 'uuid', key: 'FK' }, { name: 'amount', type: 'numeric', key: '' }, { name: 'method', type: 'varchar', key: '' }, { name: 'paid_at', type: 'timestamptz', key: '' }], weak: false },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2, fromCard: 'one', toCard: 'zmany', identifying: false, label: 'places' },
    { id: 'r2', from: 2, to: 3, fromCard: 'one', toCard: 'many', identifying: true, label: 'contains' },
    { id: 'r3', from: 4, to: 3, fromCard: 'one', toCard: 'zmany', identifying: true, label: 'in' },
    { id: 'r4', from: 2, to: 5, fromCard: 'one', toCard: 'zone', identifying: false, label: 'paid by' },
  ],
};

// d_topo — Warehouse Topology (deployment)
const warehouseDep = {
  type: 'deployment' as const,
  nodes: [
    { id: 1, name: 'Edge Scanner', kind: 'node', stereotype: 'device', x: 40, y: 60, items: [] },
    { id: 2, name: 'API Gateway', kind: 'node', stereotype: 'device', x: 330, y: 40, items: [] },
    { id: 3, name: 'App Server', kind: 'node', stereotype: 'executionEnvironment', x: 330, y: 260, items: ['Inventory REST API'] },
    { id: 4, name: 'Sync Worker', kind: 'node', stereotype: 'executionEnvironment', x: 640, y: 300, items: ['Stock Job Runner'] },
    { id: 5, name: 'Inventory DB', kind: 'node', stereotype: 'database', x: 960, y: 160, items: ['PostgreSQL 15'] },
    { id: 6, name: 'inventory-api.jar', kind: 'artifact', stereotype: 'artifact', x: 330, y: 470, items: [] },
    { id: 7, name: 'stock-sync.jar', kind: 'artifact', stereotype: 'artifact', x: 640, y: 500, items: [] },
    { id: 8, name: 'AWS S3', kind: 'node', stereotype: 'cloud', x: 960, y: 400, items: ['nightly backups'] },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2, type: 'comm', label: 'TLS' },
    { id: 'r2', from: 2, to: 3, type: 'comm', label: 'HTTPS' },
    { id: 'r3', from: 3, to: 5, type: 'comm', label: 'JDBC' },
    { id: 'r4', from: 4, to: 5, type: 'comm', label: 'JDBC' },
    { id: 'r5', from: 3, to: 4, type: 'dependency', label: 'enqueue' },
    { id: 'r6', from: 6, to: 3, type: 'deploy' },
    { id: 'r7', from: 7, to: 4, type: 'deploy' },
    { id: 'r8', from: 5, to: 8, type: 'comm', label: 'backup' },
  ],
};

// d_payseq — Payment Capture Flow (sequence)
const paymentSeq = {
  type: 'sequence' as const,
  lifelines: [
    { id: 1, name: 'Customer', kind: 'actor', x: 120 },
    { id: 2, name: 'Checkout API', kind: 'participant', x: 360 },
    { id: 3, name: 'Payment Gateway', kind: 'participant', x: 620 },
    { id: 4, name: 'Ledger', kind: 'participant', x: 870 },
  ],
  messages: [
    { id: 'm1', from: 1, to: 2, name: 'submitOrder(cart)', kind: 'sync', y: 150, self: false },
    { id: 'm2', from: 2, to: 3, name: 'charge(amount)', kind: 'sync', y: 216, self: false },
    { id: 'm3', from: 3, to: 3, name: 'authorize()', kind: 'sync', y: 282, self: true },
    { id: 'm4', from: 3, to: 2, name: 'paymentId', kind: 'reply', y: 348, self: false },
    { id: 'm5', from: 2, to: 4, name: 'recordSale()', kind: 'async', y: 414, self: false },
    { id: 'm6', from: 2, to: 1, name: 'confirmation', kind: 'reply', y: 480, self: false },
  ],
  activations: [
    { id: 'a1', lifelineId: 2, top: 150, bottom: 486 },
    { id: 'a2', lifelineId: 3, top: 216, bottom: 354 },
  ],
  frames: [
    { id: 'frm1', op: 'alt', x: 300, y: 194, w: 392, h: 182, guard: 'authorized', sections: [{ id: 's1', offset: 120, guard: 'declined' }] },
  ],
};

// d_arch — Service Architecture (component)
const serviceArch = {
  type: 'component' as const,
  components: [
    { id: 1, kind: 'web', name: 'Storefront SPA', x: 40, y: 80, items: ['HTTP/JSON'] },
    { id: 2, kind: 'service', name: 'API Gateway', x: 360, y: 80, items: ['REST', 'GraphQL'] },
    { id: 3, kind: 'service', name: 'Order Service', x: 700, y: 40, items: ['OrderAPI'] },
    { id: 4, kind: 'service', name: 'Payment Service', x: 700, y: 300, items: ['PaymentAPI'] },
    { id: 5, kind: 'database', name: 'Orders DB', x: 1040, y: 40, items: ['PostgreSQL 15'] },
    { id: 6, kind: 'queue', name: 'Event Bus', x: 700, y: 540, items: ['orders.events'] },
    { id: 7, kind: 'cloud', name: 'Stripe', x: 1040, y: 300, items: ['Payments API'] },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2, type: 'dependency', label: 'HTTPS' },
    { id: 'r2', from: 2, to: 3, type: 'dependency' },
    { id: 'r3', from: 2, to: 4, type: 'dependency' },
    { id: 'r4', from: 3, to: 5, type: 'assembly', label: 'JDBC' },
    { id: 'r5', from: 3, to: 6, type: 'assembly' },
    { id: 'r6', from: 4, to: 7, type: 'dependency', label: 'REST' },
  ],
};

// d_loginflow — Login Flow (flowchart)
const loginFlow = {
  type: 'flowchart' as const,
  nodes: [
    { id: 1, kind: 'start', name: 'Start', x: 212, y: 104 },
    { id: 2, kind: 'io', name: 'Enter credentials', x: 176, y: 188 },
    { id: 3, kind: 'process', name: 'Validate credentials', x: 404, y: 188 },
    { id: 4, kind: 'decision', name: 'Valid?', x: 440, y: 300 },
    { id: 5, kind: 'process', name: 'Create session', x: 430, y: 452 },
    { id: 6, kind: 'process', name: 'Show error', x: 214, y: 300 },
    { id: 7, kind: 'document', name: 'Show dashboard', x: 648, y: 452 },
    { id: 8, kind: 'start', name: 'End', x: 678, y: 566 },
  ],
  rels: [
    { id: 'r1', from: 1, to: 2 },
    { id: 'r2', from: 2, to: 3 },
    { id: 'r3', from: 3, to: 4 },
    { id: 'r4', from: 4, to: 5, label: 'Yes' },
    { id: 'r5', from: 4, to: 6, label: 'No' },
    { id: 'r6', from: 6, to: 2 },
    { id: 'r7', from: 5, to: 7 },
    { id: 'r8', from: 7, to: 8 },
  ],
  pool: {
    on: true,
    orient: 'v',
    x: 160,
    y: 40,
    len: 600,
    lanes: [
      { id: 'l1', label: 'Customer', color: '#3a5bff', size: 220 },
      { id: 'l2', label: 'System', color: '#0e9488', size: 240 },
      { id: 'l3', label: 'Outcome', color: '#7c3aed', size: 220 },
    ],
  },
};

// d_shopuc — Shopping Use Cases (usecase)
const shopUseCases = {
  type: 'usecase' as const,
  nodes: [
    { id: 1, kind: 'actor', name: 'Customer', x: 60, y: 250 },
    { id: 2, kind: 'actor', name: 'Admin', x: 60, y: 560 },
    { id: 3, kind: 'actor', name: 'Payment Gateway', x: 960, y: 360 },
    { id: 10, kind: 'usecase', name: 'Browse Catalog', x: 420, y: 150 },
    { id: 11, kind: 'usecase', name: 'Add to Cart', x: 420, y: 250 },
    { id: 12, kind: 'usecase', name: 'Checkout', x: 420, y: 350 },
    { id: 13, kind: 'usecase', name: 'Apply Coupon', x: 420, y: 460 },
    { id: 14, kind: 'usecase', name: 'Make Payment', x: 690, y: 350 },
    { id: 15, kind: 'usecase', name: 'Track Order', x: 420, y: 565 },
    { id: 16, kind: 'usecase', name: 'Manage Products', x: 690, y: 565 },
  ],
  rels: [
    { id: 'r1', from: 1, to: 10, type: 'association' },
    { id: 'r2', from: 1, to: 11, type: 'association' },
    { id: 'r3', from: 1, to: 12, type: 'association' },
    { id: 'r4', from: 1, to: 15, type: 'association' },
    { id: 'r5', from: 12, to: 14, type: 'include' },
    { id: 'r6', from: 13, to: 12, type: 'extend' },
    { id: 'r7', from: 14, to: 3, type: 'association' },
    { id: 'r8', from: 2, to: 16, type: 'association' },
  ],
  system: { on: true, x: 360, y: 100, w: 520, h: 560, label: 'Shop System' },
};

/* ------------------------------------------------------------------------- *
 * Default projects (used when the store is empty).
 * ------------------------------------------------------------------------- */

export const SEED_PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Checkout Platform',
    desc: 'Domain model and payment flows for the order + checkout services.',
    color: '#3a5bff',
    updatedAt: ago(2 * HOUR),
    docs: [
      {
        id: 'd_ecom',
        name: 'E-Commerce Domain',
        type: 'class',
        desc: 'Core domain classes for customers, orders and payments — the shared model the checkout services build on.',
        updatedAt: ago(2 * HOUR),
        model: ecommerce,
      },
      {
        id: 'd_payseq',
        name: 'Payment Capture Flow',
        type: 'sequence',
        desc: 'Happy-path authorize + capture across the checkout API, gateway and ledger.',
        updatedAt: ago(1 * DAY), // "yesterday"
        model: paymentSeq,
      },
      {
        id: 'd_orders',
        name: 'Orders Schema',
        type: 'erd',
        desc: 'Relational schema backing the order and payment tables.',
        updatedAt: ago(3 * DAY),
        model: ordersErd,
      },
      {
        id: 'd_arch',
        name: 'Service Architecture',
        type: 'component',
        updatedAt: ago(4 * HOUR),
        model: serviceArch,
      },
      {
        id: 'd_loginflow',
        name: 'Login Flow',
        type: 'flowchart',
        updatedAt: ago(1 * HOUR),
        model: loginFlow,
      },
      {
        id: 'd_shopuc',
        name: 'Shopping Use Cases',
        type: 'usecase',
        desc: 'Actors and the goals the checkout system supports — from browsing the catalog through paying.',
        updatedAt: ago(30 * MINUTE),
        model: shopUseCases,
      },
    ],
  },
  {
    id: 'p2',
    name: 'Inventory Service',
    desc: 'Catalog, stock and warehouse topology for the inventory domain.',
    color: '#0e9488',
    updatedAt: ago(1 * DAY),
    docs: [
      {
        id: 'd_cat',
        name: 'Catalog Model',
        type: 'class',
        updatedAt: ago(1 * DAY),
        model: catalog,
      },
      {
        id: 'd_topo',
        name: 'Warehouse Topology',
        type: 'deployment',
        updatedAt: ago(5 * DAY),
        model: warehouseDep,
      },
    ],
  },
  {
    id: 'p3',
    name: 'Notifications',
    desc: 'Email, push and webhook delivery — modeling in progress.',
    color: '#a21caf',
    updatedAt: ago(1 * WEEK),
    docs: [],
  },
];
