/**
 * Integration tests for bridge composition with realistic mock data.
 *
 * Tests the full round-trip:
 *   1. Build a realistic WorldModel (5+ entities, 5+ relations, 2+ processes, 2+ constraints)
 *   2. worldModelToCompilerSeed() — verify entity mapping, constraints, contexts, workflows
 *   3. Build a mock Blueprint and call blueprintToEnrichedModel()
 *   4. Verify enriched model carries all fields correctly
 *
 * No LLM calls required.
 */

import {
  worldModelToCompilerSeed,
  blueprintToEnrichedModel,
} from "../src/compose.js";

import type { WorldModelType } from "@swm/core";
import type { Blueprint, EntityMap, ProcessFlow } from "@swm/compiler";
import type { PostcodeAddress } from "@swm/provenance";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function makePostcode(): PostcodeAddress {
  return {
    prefix: "ML",
    coordinate: {
      layer: "L2I",
      concern: "ENT",
      scope: "GLO",
      dimension: "WHT",
      domain: "SFT",
    },
    hash: "int123",
    version: 1,
    raw: "ML.L2I.ENT.GLO.WHT.SFT.int123/v1",
  };
}

// ─── Realistic WorldModel ────────────────────────────────────────────────────

function makeRealisticWorldModel(): WorldModelType {
  return {
    id: "wm_integ01",
    name: "E-Commerce Platform",
    description:
      "An e-commerce platform with orders, payments, and fulfillment",
    version: "1.0.0",
    created_at: "2026-04-08T00:00:00.000Z",
    entities: [
      // Cluster 1: Order domain (actor, concept, event, object, resource)
      {
        id: "ent_c01",
        name: "Customer",
        type: "actor",
        description: "A registered customer who places orders",
        properties: { email: "string", tier: "standard|premium" },
      },
      {
        id: "ent_o01",
        name: "Order",
        type: "object",
        description: "A purchase order containing line items",
        properties: { total: "number", currency: "string", status: "string" },
      },
      {
        id: "ent_p01",
        name: "Payment",
        type: "resource",
        description: "A payment instrument or transaction",
        properties: { amount: "number", method: "string" },
      },
      {
        id: "ent_e01",
        name: "OrderPlaced",
        type: "event",
        description: "Fired when a customer submits an order",
      },
      {
        id: "ent_q01",
        name: "Discount",
        type: "concept",
        description: "A pricing discount applied to an order",
        properties: { percentage: "number", code: "string" },
      },
      // Cluster 2: Fulfillment domain (location, group, system)
      {
        id: "ent_w01",
        name: "Warehouse",
        type: "location",
        description: "A physical warehouse storing inventory",
        properties: { capacity: "number", region: "string" },
      },
      {
        id: "ent_i01",
        name: "InventoryItem",
        type: "object",
        description: "A trackable inventory unit",
        properties: { sku: "string", quantity: "number" },
      },
      {
        id: "ent_s01",
        name: "ShippingCarrier",
        type: "system",
        description: "External shipping service integration",
      },
      // Isolated entity (no relations) — should not form its own context
      {
        id: "ent_iso",
        name: "AuditLog",
        type: "object",
        description: "Immutable audit log entries",
      },
    ],
    relations: [
      // Cluster 1 connections
      {
        id: "rel_001",
        source: "ent_c01",
        target: "ent_o01",
        type: "creates",
        label: "Customer creates Order",
      },
      {
        id: "rel_002",
        source: "ent_o01",
        target: "ent_p01",
        type: "requires",
        label: "Order requires Payment",
      },
      {
        id: "rel_003",
        source: "ent_o01",
        target: "ent_e01",
        type: "triggers",
        label: "Order triggers OrderPlaced event",
      },
      {
        id: "rel_004",
        source: "ent_q01",
        target: "ent_o01",
        type: "applies_to",
        label: "Discount applies to Order",
      },
      {
        id: "rel_005",
        source: "ent_c01",
        target: "ent_p01",
        type: "owns",
        label: "Customer owns Payment method",
      },
      // Cluster 2 connections
      {
        id: "rel_006",
        source: "ent_w01",
        target: "ent_i01",
        type: "stores",
        label: "Warehouse stores InventoryItem",
      },
      {
        id: "rel_007",
        source: "ent_s01",
        target: "ent_w01",
        type: "picks_from",
        label: "ShippingCarrier picks from Warehouse",
      },
    ],
    processes: [
      {
        id: "proc_001",
        name: "PlaceOrder",
        description: "Customer places a new order",
        trigger: "Customer submits cart",
        steps: [
          { order: 1, action: "Validate cart contents", actor: "ent_c01" },
          { order: 2, action: "Apply discount codes", actor: "ent_q01" },
          { order: 3, action: "Calculate total", actor: "ent_o01" },
          { order: 4, action: "Process payment", actor: "ent_p01" },
          { order: 5, action: "Emit OrderPlaced event", actor: "ent_e01" },
        ],
        outcome: "Order confirmed and payment captured",
      },
      {
        id: "proc_002",
        name: "FulfillOrder",
        description: "Warehouse fulfills a confirmed order",
        trigger: "OrderPlaced event received",
        steps: [
          { order: 1, action: "Reserve inventory", actor: "ent_i01" },
          { order: 2, action: "Pick and pack items", actor: "ent_w01" },
          { order: 3, action: "Hand off to carrier", actor: "ent_s01" },
        ],
        outcome: "Shipment dispatched",
      },
    ],
    constraints: [
      {
        id: "cstr_001",
        name: "PositiveOrderTotal",
        type: "rule",
        description: "Order total must be greater than zero",
        scope: ["ent_o01"],
        severity: "hard",
      },
      {
        id: "cstr_002",
        name: "PaymentMatchesOrder",
        type: "rule",
        description: "Payment amount must equal order total after discounts",
        scope: ["ent_p01", "ent_o01"],
        severity: "hard",
      },
      {
        id: "cstr_003",
        name: "InventoryNonNegative",
        type: "rule",
        description: "Inventory quantity must never go below zero",
        scope: ["ent_i01"],
        severity: "hard",
      },
      {
        id: "cstr_004",
        name: "DiscountMaxPercent",
        type: "rule",
        description: "Discount percentage should not exceed 50%",
        scope: ["ent_q01"],
        severity: "soft",
      },
    ],
    metadata: {
      source_type: "text",
      source_summary: "E-commerce platform integration test model",
      confidence: 0.92,
    },
  };
}

// ─── Realistic Blueprint ─────────────────────────────────────────────────────

function makeRealisticBlueprint(): Blueprint {
  const pc = makePostcode();

  const dataModel: EntityMap = {
    entities: [
      {
        name: "Customer",
        category: "substance",
        properties: [
          { name: "email", type: "string", required: true },
          { name: "tier", type: "string", required: false },
        ],
        invariants: [
          {
            predicate: "customer.email != null",
            description: "Customer must have email",
          },
        ],
      },
      {
        name: "Order",
        category: "substance",
        properties: [
          { name: "total", type: "number", required: true },
          { name: "currency", type: "string", required: true },
          { name: "status", type: "string", required: true },
        ],
        invariants: [
          {
            predicate: "order.total > 0",
            description: "Order total must be positive",
          },
          {
            predicate: "order.status in ['pending','confirmed','shipped']",
            description: "Order status must be valid",
          },
        ],
      },
      {
        name: "Payment",
        category: "substance",
        properties: [{ name: "amount", type: "number", required: true }],
        invariants: [
          {
            predicate: "payment.amount == order.total",
            description: "Payment must match order",
          },
        ],
      },
      {
        name: "Warehouse",
        category: "state",
        properties: [{ name: "capacity", type: "number", required: true }],
        invariants: [],
      },
      {
        name: "InventoryItem",
        category: "substance",
        properties: [{ name: "quantity", type: "number", required: true }],
        invariants: [
          {
            predicate: "inventory.quantity >= 0",
            description: "Non-negative inventory",
          },
        ],
      },
    ],
    boundedContexts: [
      {
        name: "ordering",
        rootEntity: "Customer",
        entities: ["Customer", "Order", "Payment"],
        invariants: [
          {
            predicate: "order.total > 0",
            description: "Order total must be positive",
          },
        ],
      },
      {
        name: "fulfillment",
        rootEntity: "Warehouse",
        entities: ["Warehouse", "InventoryItem"],
        invariants: [
          {
            predicate: "inventory.quantity >= 0",
            description: "Non-negative inventory",
          },
        ],
      },
    ],
    challenges: [],
    postcode: pc,
  };

  const processModel: ProcessFlow = {
    workflows: [
      {
        name: "PlaceOrder",
        trigger: "Customer submits cart",
        steps: [
          {
            name: "step-1",
            hoareTriple: {
              precondition: "Customer submits cart",
              action: "Validate cart contents",
              postcondition: 'Ready for "Apply discount codes"',
            },
            failureModes: [
              {
                class: "precondition",
                description: "Cart is empty",
                handler: "Return error to customer",
              },
            ],
            temporalRelation: "enables",
          },
          {
            name: "step-2",
            hoareTriple: {
              precondition: 'Step "Validate cart contents" completed',
              action: "Apply discount codes",
              postcondition: 'Ready for "Calculate total"',
            },
            failureModes: [],
            temporalRelation: "enables",
          },
          {
            name: "step-3",
            hoareTriple: {
              precondition: 'Step "Apply discount codes" completed',
              action: "Calculate total",
              postcondition: 'Ready for "Process payment"',
            },
            failureModes: [],
            temporalRelation: "enables",
          },
          {
            name: "step-4",
            hoareTriple: {
              precondition: 'Step "Calculate total" completed',
              action: "Process payment",
              postcondition: 'Ready for "Emit OrderPlaced event"',
            },
            failureModes: [
              {
                class: "action",
                description: "Payment declined",
                handler: "Retry or abort order",
              },
            ],
            temporalRelation: "enables",
          },
          {
            name: "step-5",
            hoareTriple: {
              precondition: 'Step "Process payment" completed',
              action: "Emit OrderPlaced event",
              postcondition: "Process outcome achieved",
            },
            failureModes: [],
            temporalRelation: "enables",
          },
        ],
      },
      {
        name: "FulfillOrder",
        trigger: "OrderPlaced event received",
        steps: [
          {
            name: "step-1",
            hoareTriple: {
              precondition: "OrderPlaced event received",
              action: "Reserve inventory",
              postcondition: 'Ready for "Pick and pack items"',
            },
            failureModes: [
              {
                class: "precondition",
                description: "Insufficient stock",
                handler: "Backorder notification",
              },
            ],
            temporalRelation: "enables",
          },
          {
            name: "step-2",
            hoareTriple: {
              precondition: 'Step "Reserve inventory" completed',
              action: "Pick and pack items",
              postcondition: 'Ready for "Hand off to carrier"',
            },
            failureModes: [],
            temporalRelation: "enables",
          },
          {
            name: "step-3",
            hoareTriple: {
              precondition: 'Step "Pick and pack items" completed',
              action: "Hand off to carrier",
              postcondition: "Process outcome achieved",
            },
            failureModes: [],
            temporalRelation: "enables",
          },
        ],
      },
    ],
    stateMachines: [
      {
        entity: "Order",
        states: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
        transitions: [
          {
            from: "pending",
            to: "confirmed",
            trigger: "PaymentCaptured",
            guard: "payment.amount > 0",
          },
          {
            from: "confirmed",
            to: "shipped",
            trigger: "CarrierPickup",
            guard: "shipment.tracking != null",
          },
          {
            from: "shipped",
            to: "delivered",
            trigger: "DeliveryConfirmed",
            guard: "true",
          },
          {
            from: "pending",
            to: "cancelled",
            trigger: "CustomerCancel",
            guard: "true",
          },
        ],
      },
    ],
    challenges: [],
    postcode: pc,
  };

  return {
    summary: "E-commerce ordering and fulfillment blueprint",
    scope: {
      inScope: [
        "Order placement",
        "Payment processing",
        "Inventory management",
        "Shipping",
      ],
      outOfScope: ["Returns", "Customer support chat"],
      assumptions: ["Single currency per order", "Inventory is pre-stocked"],
    },
    architecture: {
      pattern: "event-driven",
      rationale: "Decoupled ordering and fulfillment via domain events",
      components: [
        {
          name: "OrderService",
          responsibility: "Manages order lifecycle",
          interfaces: ["POST /orders", "GET /orders/:id"],
          dependencies: ["PaymentService"],
          boundedContext: "ordering",
        },
        {
          name: "FulfillmentService",
          responsibility: "Manages warehouse and shipping",
          interfaces: ["POST /fulfillments"],
          dependencies: ["OrderService"],
          boundedContext: "fulfillment",
        },
      ],
    },
    dataModel,
    processModel,
    nonFunctional: [
      {
        category: "reliability",
        requirement: "Orders must be persisted before payment is attempted",
        scope: "ordering",
        verification:
          "Integration test: order record exists before payment call",
      },
      {
        category: "performance",
        requirement: "Order placement must complete within 3 seconds",
        scope: "ordering",
        verification: "Load test: p99 < 3000ms",
      },
    ],
    openQuestions: ["Should discounts stack?"],
    resolvedConflicts: [
      {
        entity: "Order",
        process: "PlaceOrder",
        resolution:
          "Order status transitions are authoritative from the entity model",
        authoritative: "entity",
      },
    ],
    challenges: [],
    audit: {
      coverageScore: 91,
      coherenceScore: 88,
      gatePassRate: 0.97,
      iterationCount: 3,
      governorDecision: "ACCEPT",
      confidence: 0.93,
      driftCount: 0,
      gapCount: 2,
      violationCount: 0,
    },
    postcode: pc,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

function run(): void {
  console.log("═══ Bridge: Integration Tests (realistic mock data) ═══\n");

  const model = makeRealisticWorldModel();
  const seed = worldModelToCompilerSeed(model);

  // ── 1. Entity type mapping ────────────────────────────────────────────────

  console.log("── Entity Type Mapping ──\n");

  const entities = seed.entitySeed.entities ?? [];

  assert(
    entities.length === 9,
    `All 9 entities are mapped (got ${entities.length})`,
  );

  const customer = entities.find((e) => e.name === "Customer");
  assert(customer?.category === "substance", "actor (Customer) → substance");

  const order = entities.find((e) => e.name === "Order");
  assert(order?.category === "substance", "object (Order) → substance");

  const payment = entities.find((e) => e.name === "Payment");
  assert(payment?.category === "substance", "resource (Payment) → substance");

  const orderPlaced = entities.find((e) => e.name === "OrderPlaced");
  assert(orderPlaced?.category === "event", "event (OrderPlaced) → event");

  const discount = entities.find((e) => e.name === "Discount");
  assert(discount?.category === "quality", "concept (Discount) → quality");

  const warehouse = entities.find((e) => e.name === "Warehouse");
  assert(warehouse?.category === "state", "location (Warehouse) → state");

  const carrier = entities.find((e) => e.name === "ShippingCarrier");
  assert(
    carrier?.category === "substance",
    "system (ShippingCarrier) → substance",
  );

  const inventoryItem = entities.find((e) => e.name === "InventoryItem");
  assert(
    inventoryItem?.category === "substance",
    "object (InventoryItem) → substance",
  );

  const auditLog = entities.find((e) => e.name === "AuditLog");
  assert(auditLog?.category === "substance", "object (AuditLog) → substance");

  // ── 2. Entity properties are preserved ────────────────────────────────────

  console.log("\n── Entity Properties ──\n");

  const orderProps = order?.properties ?? [];
  assert(
    orderProps.length === 3,
    `Order has 3 properties (got ${orderProps.length})`,
  );
  assert(
    orderProps.some((p) => p.name === "total" && p.type === "number"),
    "Order has total:number property",
  );
  assert(
    orderProps.some((p) => p.name === "currency"),
    "Order has currency property",
  );

  const discountProps = discount?.properties ?? [];
  assert(
    discountProps.some((p) => p.name === "percentage"),
    "Discount has percentage property",
  );

  // ── 3. Constraint → Invariant mapping ─────────────────────────────────────

  console.log("\n── Constraint → Invariant ──\n");

  const orderInvariants = seed.constraintsByEntity.get("Order") ?? [];
  assert(
    orderInvariants.length === 2,
    `Order has 2 invariants from constraints (PositiveOrderTotal + PaymentMatchesOrder) (got ${orderInvariants.length})`,
  );

  assert(
    orderInvariants.some((inv) => inv.predicate.includes("PositiveOrderTotal")),
    "PositiveOrderTotal constraint name appears in Order invariant predicate",
  );

  assert(
    orderInvariants.some((inv) =>
      inv.predicate.includes("PaymentMatchesOrder"),
    ),
    "PaymentMatchesOrder constraint name appears in Order invariant predicate",
  );

  assert(
    orderInvariants.every((inv) => inv.description.includes("hard")),
    "Both Order constraints have hard severity in description",
  );

  const paymentInvariants = seed.constraintsByEntity.get("Payment") ?? [];
  assert(
    paymentInvariants.length === 1,
    `Payment has 1 invariant (PaymentMatchesOrder) (got ${paymentInvariants.length})`,
  );

  const inventoryInvariants =
    seed.constraintsByEntity.get("InventoryItem") ?? [];
  assert(
    inventoryInvariants.length === 1,
    `InventoryItem has 1 invariant (InventoryNonNegative) (got ${inventoryInvariants.length})`,
  );

  const discountInvariants = seed.constraintsByEntity.get("Discount") ?? [];
  assert(
    discountInvariants.length === 1 &&
      discountInvariants[0]!.description.includes("soft"),
    "Discount has soft-severity invariant",
  );

  // Invariants are applied on the entity objects themselves
  const orderEntity = entities.find((e) => e.name === "Order");
  assert(
    (orderEntity?.invariants.length ?? 0) === 2,
    "Order entity carries 2 invariants directly",
  );

  const auditLogEntity = entities.find((e) => e.name === "AuditLog");
  assert(
    (auditLogEntity?.invariants.length ?? 0) === 0,
    "AuditLog (no constraints) has zero invariants",
  );

  // ── 4. Bounded context inference from connected components ────────────────

  console.log("\n── Bounded Context Inference ──\n");

  const contexts = seed.entitySeed.boundedContexts ?? [];

  assert(
    contexts.length === 2,
    `Two bounded contexts inferred (order cluster + fulfillment cluster) (got ${contexts.length})`,
  );

  // Cluster 1: Customer, Order, Payment, OrderPlaced, Discount (all connected)
  const orderContext = contexts.find(
    (c) => c.entities.includes("Customer") && c.entities.includes("Order"),
  );
  assert(
    orderContext !== undefined,
    "Order domain context exists with Customer + Order",
  );
  assert(
    orderContext!.entities.length === 5,
    `Order context has 5 entities (got ${orderContext?.entities.length})`,
  );
  assert(
    orderContext!.entities.includes("Payment"),
    "Order context includes Payment",
  );
  assert(
    orderContext!.entities.includes("OrderPlaced"),
    "Order context includes OrderPlaced",
  );
  assert(
    orderContext!.entities.includes("Discount"),
    "Order context includes Discount",
  );

  // Cluster 2: Warehouse, InventoryItem, ShippingCarrier
  const fulfillmentContext = contexts.find((c) =>
    c.entities.includes("Warehouse"),
  );
  assert(
    fulfillmentContext !== undefined,
    "Fulfillment context exists with Warehouse",
  );
  assert(
    fulfillmentContext!.entities.length === 3,
    `Fulfillment context has 3 entities (got ${fulfillmentContext?.entities.length})`,
  );
  assert(
    fulfillmentContext!.entities.includes("InventoryItem"),
    "Fulfillment context includes InventoryItem",
  );
  assert(
    fulfillmentContext!.entities.includes("ShippingCarrier"),
    "Fulfillment context includes ShippingCarrier",
  );

  // Isolated entity does NOT form its own context
  const isolatedCtx = contexts.find((c) => c.entities.includes("AuditLog"));
  assert(
    isolatedCtx === undefined,
    "AuditLog (isolated) does not form a bounded context",
  );

  // Context invariants aggregate from member entities
  assert(
    (orderContext?.invariants.length ?? 0) >= 2,
    `Order context aggregates invariants from members (got ${orderContext?.invariants.length})`,
  );
  assert(
    (fulfillmentContext?.invariants.length ?? 0) >= 1,
    `Fulfillment context has at least 1 invariant from InventoryItem (got ${fulfillmentContext?.invariants.length})`,
  );

  // ── 5. Process → Workflow with auto-generated Hoare triples ───────────────

  console.log("\n── Process → Workflow ──\n");

  const workflows = seed.processSeed.workflows ?? [];
  assert(
    workflows.length === 2,
    `Two processes map to two workflows (got ${workflows.length})`,
  );

  const placeOrder = workflows.find((w) => w.name === "PlaceOrder");
  assert(placeOrder !== undefined, "PlaceOrder workflow exists");
  assert(
    placeOrder!.steps.length === 5,
    `PlaceOrder has 5 steps (got ${placeOrder?.steps.length})`,
  );
  assert(
    placeOrder!.trigger === "Customer submits cart",
    "PlaceOrder trigger is preserved",
  );

  // First step precondition = process trigger
  assert(
    placeOrder!.steps[0]!.hoareTriple.precondition === "Customer submits cart",
    "First step precondition equals process trigger",
  );
  assert(
    placeOrder!.steps[0]!.hoareTriple.action === "Validate cart contents",
    "First step action is correct",
  );
  assert(
    placeOrder!.steps[0]!.hoareTriple.postcondition ===
      'Ready for "Apply discount codes"',
    "First step postcondition chains to next step",
  );

  // Middle step chains correctly
  assert(
    placeOrder!.steps[2]!.hoareTriple.precondition ===
      'Step "Apply discount codes" completed',
    "Middle step precondition references previous step",
  );

  // Last step postcondition
  assert(
    placeOrder!.steps[4]!.hoareTriple.postcondition ===
      "Process outcome achieved",
    "Last step postcondition is terminal",
  );

  const fulfillOrder = workflows.find((w) => w.name === "FulfillOrder");
  assert(fulfillOrder !== undefined, "FulfillOrder workflow exists");
  assert(
    fulfillOrder!.steps.length === 3,
    `FulfillOrder has 3 steps (got ${fulfillOrder?.steps.length})`,
  );
  assert(
    fulfillOrder!.steps[0]!.hoareTriple.precondition ===
      "OrderPlaced event received",
    "FulfillOrder first step uses its own trigger as precondition",
  );

  // ── 6. blueprintToEnrichedModel — full Blueprint round-trip ───────────────

  console.log("\n── blueprintToEnrichedModel ──\n");

  const blueprint = makeRealisticBlueprint();
  const enriched = blueprintToEnrichedModel(model, blueprint);

  // Base WorldModel fields preserved
  assert(enriched.id === model.id, "Base WorldModel id is preserved");
  assert(enriched.name === model.name, "Base WorldModel name is preserved");
  assert(enriched.entities.length === 9, "Base entities are preserved");
  assert(enriched.relations.length === 7, "Base relations are preserved");
  assert(enriched.processes.length === 2, "Base processes are preserved");
  assert(enriched.constraints.length === 4, "Base constraints are preserved");

  // Bounded contexts from blueprint
  assert(
    enriched.boundedContexts.length === 2,
    `boundedContexts from blueprint carry through (got ${enriched.boundedContexts.length})`,
  );
  assert(
    enriched.boundedContexts[0]?.name === "ordering",
    "First bounded context is 'ordering'",
  );
  assert(
    enriched.boundedContexts[1]?.name === "fulfillment",
    "Second bounded context is 'fulfillment'",
  );

  // Invariants map populated from blueprint entities
  assert(
    enriched.invariants.size === 4,
    `Invariants map has 4 entries (Customer, Order, Payment, InventoryItem) (got ${enriched.invariants.size})`,
  );

  const customerInv = enriched.invariants.get("Customer") ?? [];
  assert(
    customerInv.length === 1 &&
      customerInv[0]!.predicate === "customer.email != null",
    "Customer invariant predicate is preserved",
  );

  const orderInv = enriched.invariants.get("Order") ?? [];
  assert(
    orderInv.length === 2,
    `Order has 2 invariants from blueprint (got ${orderInv.length})`,
  );

  const paymentInv = enriched.invariants.get("Payment") ?? [];
  assert(
    paymentInv.length === 1 &&
      paymentInv[0]!.predicate === "payment.amount == order.total",
    "Payment invariant from blueprint is correct",
  );

  // Warehouse has no invariants in blueprint → should not appear in map
  assert(
    !enriched.invariants.has("Warehouse"),
    "Warehouse (no invariants) is absent from invariants map",
  );

  // Hoare triples map populated from blueprint workflows
  assert(
    enriched.hoareTriples.size === 2,
    `hoareTriples map has 2 entries (PlaceOrder, FulfillOrder) (got ${enriched.hoareTriples.size})`,
  );

  const placeOrderTriples = enriched.hoareTriples.get("PlaceOrder") ?? [];
  assert(
    placeOrderTriples.length === 5,
    `PlaceOrder has 5 Hoare triples (got ${placeOrderTriples.length})`,
  );
  assert(
    placeOrderTriples[0]!.action === "Validate cart contents",
    "First PlaceOrder triple action is correct",
  );
  assert(
    placeOrderTriples[3]!.action === "Process payment",
    "Fourth PlaceOrder triple action is correct",
  );

  const fulfillTriples = enriched.hoareTriples.get("FulfillOrder") ?? [];
  assert(
    fulfillTriples.length === 3,
    `FulfillOrder has 3 Hoare triples (got ${fulfillTriples.length})`,
  );

  // State machines carry through
  assert(
    enriched.stateMachines.length === 1,
    `stateMachines transferred (got ${enriched.stateMachines.length})`,
  );
  assert(
    enriched.stateMachines[0]?.entity === "Order",
    "State machine is for Order entity",
  );
  assert(
    enriched.stateMachines[0]?.states.length === 5,
    "Order state machine has 5 states",
  );

  // Non-functional requirements
  assert(
    enriched.nonFunctionalRequirements.length === 2,
    `NFRs preserved (got ${enriched.nonFunctionalRequirements.length})`,
  );
  assert(
    enriched.nonFunctionalRequirements[0]?.category === "reliability",
    "First NFR category is reliability",
  );
  assert(
    enriched.nonFunctionalRequirements[1]?.category === "performance",
    "Second NFR category is performance",
  );

  // Governor decision from audit
  assert(
    enriched.governorDecision !== undefined,
    "governorDecision is set from audit",
  );
  assert(
    enriched.governorDecision?.decision === "ACCEPT",
    "Governor decision is ACCEPT",
  );
  assert(
    enriched.governorDecision?.confidence === 0.93,
    "Governor confidence is 0.93",
  );

  // Compilation audit
  assert(
    enriched.compilationAudit !== undefined,
    "compilationAudit is set from blueprint audit",
  );
  assert(
    enriched.compilationAudit?.coverageScore === 91,
    "Audit coverage score is 91",
  );
  assert(
    enriched.compilationAudit?.iterationCount === 3,
    "Audit iteration count is 3",
  );

  // Postcodes map is initialized (empty)
  assert(
    enriched.postcodes instanceof Map && enriched.postcodes.size === 0,
    "Postcodes map is initialized empty",
  );

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n═══ ${passed}/${passed + failed} passed ═══\n`);
  if (failed > 0) process.exit(1);
}

run();
