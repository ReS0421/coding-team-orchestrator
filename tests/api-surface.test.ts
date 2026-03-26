import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("Public API surface", () => {
  it("exports all expected functions and types", () => {
    // Orchestrators
    expect(typeof api.runTier1).toBe("function");
    expect(typeof api.runTier2).toBe("function");
    expect(typeof api.runTier3).toBe("function");

    // Engine building blocks
    expect(typeof api.judgeTier).toBe("function");
    expect(typeof api.evaluateDispatchRule).toBe("function");
    expect(typeof api.decideCorrection).toBe("function");
    expect(typeof api.decideTier3Correction).toBe("function");
    expect(typeof api.runRollingDispatch).toBe("function");
    expect(typeof api.runDualReview).toBe("function");
    expect(typeof api.mergeReviewIssues).toBe("function");
    expect(typeof api.planLeadRecovery).toBe("function");
    expect(typeof api.createHeartbeatState).toBe("function");
    expect(typeof api.recordHeartbeat).toBe("function");
    expect(typeof api.checkHeartbeat).toBe("function");
    expect(typeof api.diagnoseLeadStatus).toBe("function");
    expect(typeof api.transitionSharedOwner).toBe("function");
    expect(typeof api.canAmendInAdvisory).toBe("function");
    expect(typeof api.terminateAllOwners).toBe("function");

    // Runners
    expect(typeof api.createSpawnAdapter).toBe("function");
    expect(typeof api.runParallel).toBe("function");
    expect(typeof api.runSharedExecution).toBe("function");

    // Store
    expect(typeof api.parseFrontmatter).toBe("function");
    expect(typeof api.serializeFrontmatter).toBe("function");
    expect(typeof api.readArtifact).toBe("function");
    expect(typeof api.writeArtifact).toBe("function");
    expect(typeof api.createEmptyManifest).toBe("function");
    expect(typeof api.loadManifest).toBe("function");
    expect(typeof api.saveManifest).toBe("function");
    expect(typeof api.createCheckpoint).toBe("function");
    expect(typeof api.restoreFromCheckpoint).toBe("function");
    expect(typeof api.findCheckpointByPhase).toBe("function");

    // Schemas (Zod objects)
    expect(api.DispatchCardSchema).toBeDefined();
    expect(api.BriefSchema).toBeDefined();
    expect(api.PlannerReturnSchema).toBeDefined();
    expect(api.SpecialistSubmissionSchema).toBeDefined();
    expect(api.ReviewerReturnSchema).toBeDefined();
    expect(api.LeadReturnSchema).toBeDefined();
    expect(api.ExecutionContractSchema).toBeDefined();
    expect(api.ManifestPatchSetSchema).toBeDefined();
    expect(api.ErrorLogSchema).toBeDefined();
    expect(api.EventLogEntrySchema).toBeDefined();

    // Domain constants
    expect(api.Tier).toBeDefined();
    expect(api.Phase).toBeDefined();
    expect(api.SharedOwnerState).toBeDefined();
    expect(api.RollingSlotState).toBeDefined();
    expect(api.LeadPhase).toBeDefined();
    expect(api.Role).toBeDefined();
    expect(api.Status).toBeDefined();
  });
});
