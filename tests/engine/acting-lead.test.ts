import { describe, it, expect } from "vitest";
import {
  selectActingLead,
  applyActingLeadToCards,
} from "../../src/engine/acting-lead.js";
import type { Brief } from "../../src/schemas/brief.js";
import type { DispatchCard } from "../../src/schemas/dispatch-card.js";

function makeBrief(
  specialistCount: number,
  shared: string[] = [],
): Brief {
  const specialists = Array.from({ length: specialistCount }, (_, i) => ({
    id: `specialist-${i + 1}`,
    scope: [`src/mod${i + 1}/`],
    owns: i === 0 && shared.length > 0 ? shared : [`src/mod${i + 1}/index.ts`],
  }));
  return {
    brief_id: "test-brief",
    goal: "Test",
    out_of_scope: [],
    specialists,
    shared,
    accept_checks: ["build"],
    escalate_if: [],
  };
}

function makeCard(id: string): DispatchCard {
  return {
    version: 1,
    dispatch_rev: 1,
    role: "specialist",
    id,
    tier: 2,
    task: "test",
    input_refs: [],
    entrypoint: [],
    must_read: [],
    authoritative_artifact: [],
    write_scope: [],
    completion_check: [],
    return_format: { schema: "specialist_submission_v1" },
    timeout_profile: { class: "standard", heartbeat_required: false },
  };
}

describe("selectActingLead", () => {
  it("specialist ≤2, no shared → no acting lead", () => {
    const result = selectActingLead(makeBrief(2));
    expect(result.needs_acting_lead).toBe(false);
    expect(result.acting_lead_id).toBeUndefined();
    expect(result.dispatch_owner).toBe("openclaw");
    expect(result.merge_owner).toBe("openclaw");
  });

  it("specialist ≤2, shared → shared owner is acting lead", () => {
    const result = selectActingLead(makeBrief(2, ["src/shared.ts"]), "specialist-1");
    expect(result.needs_acting_lead).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
    expect(result.dispatch_owner).toBe("acting_lead");
    expect(result.merge_owner).toBe("acting_lead");
  });

  it("specialist 3, shared → shared owner is acting lead", () => {
    const result = selectActingLead(makeBrief(3, ["src/shared.ts"]), "specialist-2");
    expect(result.needs_acting_lead).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-2");
  });

  it("specialist 3, no shared → first specialist fallback", () => {
    const result = selectActingLead(makeBrief(3));
    expect(result.needs_acting_lead).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
    expect(result.dispatch_owner).toBe("acting_lead");
  });

  it("specialist ≤2, shared, no sharedOwner → first specialist fallback", () => {
    const result = selectActingLead(makeBrief(2, ["src/shared.ts"]));
    expect(result.needs_acting_lead).toBe(true);
    expect(result.acting_lead_id).toBe("specialist-1");
  });

  it("specialist 1, no shared → no acting lead", () => {
    const result = selectActingLead(makeBrief(1));
    expect(result.needs_acting_lead).toBe(false);
  });
});

describe("applyActingLeadToCards", () => {
  it("sets is_acting_lead on matching card", () => {
    const cards = [makeCard("specialist-1-abc"), makeCard("specialist-2-abc")];
    const decision = selectActingLead(makeBrief(2, ["src/shared.ts"]), "specialist-1");
    const result = applyActingLeadToCards(cards, decision);
    expect(result[0].is_acting_lead).toBe(true);
    expect(result[1].is_acting_lead).toBeUndefined();
  });

  it("does not mutate original cards", () => {
    const cards = [makeCard("specialist-1-abc")];
    const decision = selectActingLead(makeBrief(2, ["src/shared.ts"]), "specialist-1");
    applyActingLeadToCards(cards, decision);
    expect(cards[0].is_acting_lead).toBeUndefined();
  });

  it("returns unchanged cards when no acting lead", () => {
    const cards = [makeCard("specialist-1-abc")];
    const decision = selectActingLead(makeBrief(1));
    const result = applyActingLeadToCards(cards, decision);
    expect(result[0].is_acting_lead).toBeUndefined();
  });
});
