// Reuse the actual structured queue/runtime harness without removing Obligation assertions.
process.env.NEXUS_NATIVE_RESEARCH_MODE="ENTITY_INVESTIGATION";
await import("./test-research-obligation-worker.mjs");
