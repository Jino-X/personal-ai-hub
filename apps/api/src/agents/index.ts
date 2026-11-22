import { registerSystemJobs } from "../jobs/system";

/**
 * Registers every agent's job handlers and schedules.
 * Agents are plain modules with clear responsibilities that communicate through
 * the database and the durable job queue — no heavyweight multi-agent framework.
 */
export function registerAgents() {
  registerSystemJobs();
}
